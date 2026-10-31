import { applyOps } from '../notes/reducer';
import { hasContent, type NotesState } from '../notes/types';
import type { Op } from '../notes/ops';
import { describeLlmError, type ChatMessage, type LlmClient } from './client';
import { parseOpsResponse } from './parse';
import {
  buildFinalMessage,
  buildUserMessage,
  FINAL_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
  type NotesLanguage,
} from './prompts';
import { addUsage, type Usage } from './usage';

export interface StructurerConfig {
  /** Trigger an update once this many new final words are pending. */
  minWords: number;
  /** ...or once this long has passed since text started waiting. */
  maxWaitMs: number;
  language: NotesLanguage;
}

export interface StructurerDeps {
  llm: LlmClient;
  config: StructurerConfig;
  notes: NotesState;
  usage: Usage;
  onNotes(notes: NotesState): void;
  onUsage(usage: Usage): void;
  onBusy(busy: boolean): void;
  /** null clears the error. */
  onError(message: string | null): void;
  now?: () => number;
}

const BASE_RETRY_MS = 15_000;
const MAX_RETRY_MS = 120_000;
const MAX_CONTEXT_WORDS = 60;

export function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** Last `n` sentences, used as continuity context for the next call. */
export function tailSentences(text: string, n: number): string {
  const sentences =
    text
      .match(/[^.!?¡¿]+[.!?]*/g)
      ?.map((s) => s.trim())
      .filter(Boolean) ?? [];
  const tail = sentences.slice(-n).join(' ');
  // Unpunctuated speech would otherwise come back whole; keep the context short.
  return tail.split(/\s+/).slice(-MAX_CONTEXT_WORDS).join(' ');
}

/**
 * Accumulates final transcript text and turns it into note patches. At most one LLM call is in
 * flight; text that arrives meanwhile (or fails to process) stays queued for the next cycle.
 */
export class Structurer {
  private notes: NotesState;
  private usage: Usage;
  private pending = '';
  private context = '';
  private inFlight: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private blockedUntil = 0;
  private failures = 0;
  private finalizing = false;
  private readonly now: () => number;

  constructor(private readonly deps: StructurerDeps) {
    this.notes = deps.notes;
    this.usage = deps.usage;
    this.now = deps.now ?? Date.now;
  }

  /** Called when the user edits the notes by hand, so the next patch applies on top of the edit. */
  setNotes(notes: NotesState): void {
    this.notes = notes;
  }

  pushFinal(text: string): void {
    const t = text.trim();
    if (!t) return;
    this.pending = this.pending ? `${this.pending} ${t}` : t;
    this.evaluate();
  }

  /** Flush what is pending, then run the cheap final pass over the notes. */
  async finalize(): Promise<void> {
    this.finalizing = true;
    this.clearTimer();
    this.blockedUntil = 0;
    try {
      while (this.inFlight) await this.inFlight;
      if (this.pending) {
        this.inFlight = this.run().finally(() => (this.inFlight = null));
        await this.inFlight;
      }
      if (!hasContent(this.notes)) return;
      this.deps.onBusy(true);
      try {
        const messages: ChatMessage[] = [
          { role: 'system', content: FINAL_SYSTEM_PROMPT },
          { role: 'user', content: buildFinalMessage(this.notes, this.deps.config.language) },
        ];
        this.commit(await this.requestOps(messages));
        this.deps.onError(null);
      } catch (err) {
        this.deps.onError(describeLlmError(err));
      } finally {
        this.deps.onBusy(false);
      }
    } finally {
      this.finalizing = false;
    }
  }

  dispose(): void {
    this.clearTimer();
    this.finalizing = true;
  }

  private evaluate(): void {
    if (this.finalizing || !this.pending) return;
    if (countWords(this.pending) >= this.deps.config.minWords) {
      this.trigger();
    } else if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.trigger();
      }, this.deps.config.maxWaitMs);
    }
  }

  private trigger(): void {
    this.clearTimer();
    if (this.inFlight || this.finalizing) return; // re-evaluated when the call completes
    const wait = this.blockedUntil - this.now();
    if (wait > 0) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.trigger();
      }, wait);
      return;
    }
    this.inFlight = this.run().finally(() => {
      this.inFlight = null;
      this.evaluate();
    });
  }

  private async run(): Promise<void> {
    const text = this.pending;
    this.pending = '';
    this.deps.onBusy(true);
    try {
      const messages: ChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildUserMessage({
            notes: this.notes,
            context: this.context,
            newText: text,
            language: this.deps.config.language,
          }),
        },
      ];
      this.commit(await this.requestOps(messages));
      this.context = tailSentences(text, 2);
      this.failures = 0;
      this.deps.onError(null);
    } catch (err) {
      // Keep the text for the next cycle so no content is lost.
      this.pending = this.pending ? `${text} ${this.pending}` : text;
      this.failures++;
      this.blockedUntil =
        this.now() + Math.min(BASE_RETRY_MS * 2 ** (this.failures - 1), MAX_RETRY_MS);
      this.deps.onError(describeLlmError(err));
    } finally {
      this.deps.onBusy(false);
    }
  }

  /** One call, plus one retry that shows the model its validation error. */
  private async requestOps(messages: ChatMessage[]): Promise<Op[]> {
    const first = await this.call(messages);
    const parsed = parseOpsResponse(first);
    if (parsed.ok) return parsed.ops;
    const retry = await this.call([
      ...messages,
      { role: 'assistant', content: first },
      {
        role: 'user',
        content: `Your reply was invalid: ${parsed.error} Reply again with ONLY a valid JSON object {"ops":[...]}.`,
      },
    ]);
    const reparsed = parseOpsResponse(retry);
    if (reparsed.ok) return reparsed.ops;
    throw new Error('The model returned invalid output twice; will retry later.');
  }

  private async call(messages: ChatMessage[]): Promise<string> {
    const res = await this.deps.llm.complete(messages);
    this.usage = addUsage(this.usage, res.inputTokens, res.outputTokens);
    this.deps.onUsage(this.usage);
    return res.content;
  }

  private commit(ops: Op[]): void {
    this.notes = applyOps(this.notes, ops);
    this.deps.onNotes(this.notes);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
