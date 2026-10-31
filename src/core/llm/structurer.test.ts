import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyNotes, type NotesState } from '../notes/types';
import type { ChatMessage, LlmClient, LlmResult } from './client';
import { countWords, Structurer, tailSentences } from './structurer';
import { emptyUsage } from './usage';

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
const reply = (content: string): LlmResult => ({ content, inputTokens: 10, outputTokens: 5 });
const OK = '{"ops":[{"op":"add_decision","text":"Go"}]}';

function setup(handler: (messages: ChatMessage[], call: number) => Promise<LlmResult>) {
  let call = 0;
  const calls: ChatMessage[][] = [];
  const llm: LlmClient = {
    complete: (messages) => {
      calls.push(messages);
      return handler(messages, call++);
    },
  };
  let notes: NotesState = emptyNotes();
  const errors: Array<string | null> = [];
  const structurer = new Structurer({
    llm,
    config: { minWords: 120, maxWaitMs: 45_000, language: 'auto' },
    notes,
    usage: emptyUsage(),
    onNotes: (n) => (notes = n),
    onUsage: () => {},
    onBusy: () => {},
    onError: (e) => errors.push(e),
  });
  return { structurer, calls, errors, getNotes: () => notes };
}

describe('helpers', () => {
  it('counts words and takes the last sentences', () => {
    expect(countWords('  a b  c ')).toBe(3);
    expect(countWords('')).toBe(0);
    expect(tailSentences('One. Two! Three? Four.', 2)).toBe('Three? Four.');
  });
});

describe('Structurer triggers', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires once enough words are pending', async () => {
    const t = setup(async () => reply(OK));
    t.structurer.pushFinal(words(119));
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.calls).toHaveLength(0);
    t.structurer.pushFinal('one more');
    await vi.advanceTimersByTimeAsync(0);
    expect(t.calls).toHaveLength(1);
    expect(t.getNotes().decisions).toHaveLength(1);
  });

  it('fires after the wait time when there is little text', async () => {
    const t = setup(async () => reply(OK));
    t.structurer.pushFinal('just a few words');
    await vi.advanceTimersByTimeAsync(44_000);
    expect(t.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(t.calls).toHaveLength(1);
  });

  it('never overlaps calls and sends the queued text afterwards', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const t = setup(async (_m, call) => {
      if (call === 0) await gate;
      return reply('{"ops":[]}');
    });
    t.structurer.pushFinal(words(130));
    await vi.advanceTimersByTimeAsync(0);
    t.structurer.pushFinal(words(130).replace(/w/g, 'x'));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.calls).toHaveLength(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.calls).toHaveLength(2);
    expect(t.calls[1]?.[1]?.content).toContain('x0');
    expect(t.calls[1]?.[1]?.content).not.toContain('w0');
  });

  it('sends only new text, not the whole transcript', async () => {
    const t = setup(async () => reply('{"ops":[]}'));
    t.structurer.pushFinal(`First chunk. ${words(130)}.`);
    await vi.advanceTimersByTimeAsync(0);
    t.structurer.pushFinal(`Second chunk. ${words(130).replace(/w/g, 'y')}.`);
    await vi.advanceTimersByTimeAsync(0);
    const second = t.calls[1]?.[1]?.content ?? '';
    expect(second).toContain('NEW_TRANSCRIPT: Second chunk.');
    expect(second).not.toContain('NEW_TRANSCRIPT: First chunk');
    expect(second).toContain('CONTEXT:');
  });
});

describe('Structurer validation and failures', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('retries once with the validation error', async () => {
    const t = setup(async (_m, call) => reply(call === 0 ? '{"ops":[{"op":"nope"}]}' : OK));
    t.structurer.pushFinal(words(130));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.calls).toHaveLength(2);
    expect(t.calls[1]?.at(-1)?.content).toContain('Your reply was invalid');
    expect(t.getNotes().decisions).toHaveLength(1);
  });

  it('keeps the text and retries later when the model keeps failing', async () => {
    const t = setup(async (_m, call) => (call < 2 ? reply('garbage') : reply(OK)));
    t.structurer.pushFinal(words(130));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.calls).toHaveLength(2);
    expect(t.getNotes().decisions).toHaveLength(0);
    expect(t.errors.at(-1)).toBeTruthy();
    await vi.advanceTimersByTimeAsync(16_000);
    expect(t.calls).toHaveLength(3);
    expect(t.calls[2]?.[1]?.content).toContain('w0');
    expect(t.getNotes().decisions).toHaveLength(1);
    expect(t.errors.at(-1)).toBeNull();
  });

  it('keeps the text when the request throws', async () => {
    const t = setup(async (_m, call) => {
      if (call === 0) throw new Error('network down');
      return reply(OK);
    });
    t.structurer.pushFinal(words(130));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.errors.at(-1)).toBe('network down');
    await vi.advanceTimersByTimeAsync(16_000);
    expect(t.getNotes().decisions).toHaveLength(1);
  });
});

describe('Structurer.finalize', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('flushes pending text then runs the final pass on the notes only', async () => {
    const t = setup(async (messages, call) =>
      reply(
        call === 0
          ? OK
          : messages[0]?.content.includes('finishing')
            ? '{"ops":[{"op":"set_title","text":"Final"},{"op":"set_tldr","lines":["a","b"]}]}'
            : '{"ops":[]}',
      ),
    );
    t.structurer.pushFinal('a short remark');
    const done = t.structurer.finalize();
    await vi.runAllTimersAsync();
    await done;
    expect(t.calls).toHaveLength(2);
    expect(t.calls[1]?.[1]?.content).not.toContain('NEW_TRANSCRIPT:');
    expect(t.getNotes().title).toBe('Final');
    expect(t.getNotes().tldr).toEqual(['a', 'b']);
  });

  it('skips the final pass when there are no notes', async () => {
    const t = setup(async () => reply('{"ops":[]}'));
    await t.structurer.finalize();
    expect(t.calls).toHaveLength(0);
  });
});
