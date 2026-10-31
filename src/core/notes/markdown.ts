import { detectLanguage, LABELS, type Language } from '../notion/blocks';
import type { NotesState } from './types';

export interface MarkdownSource {
  startedAt: number;
  endedAt?: number;
  tabUrl?: string;
  tabTitle?: string;
  transcript: string[];
  notes: NotesState;
}

export function sessionTitle(s: Pick<MarkdownSource, 'tabTitle' | 'notes'>): string {
  return s.notes.title || s.tabTitle || 'Untitled session';
}

/** Collapses newlines so model-written text cannot break the list structure. */
const line = (text: string): string => text.replace(/\s*\n\s*/g, ' ').trim();

export function sessionToMarkdown(s: MarkdownSource, language?: Language): string {
  const { notes } = s;
  const lang =
    language ??
    detectLanguage([notes.title, ...notes.tldr, ...s.transcript.slice(0, 20)].join(' '));
  const L = LABELS[lang];
  const out: string[] = [`# ${line(sessionTitle(s))}`, ''];

  const minutes = Math.max(1, Math.round(((s.endedAt ?? s.startedAt) - s.startedAt) / 60_000));
  const meta = [
    `${L.date}: ${new Date(s.startedAt).toISOString().slice(0, 16).replace('T', ' ')}`,
    s.tabUrl && `${L.source}: ${s.tabUrl}`,
    s.endedAt && `${L.duration}: ${minutes} min`,
  ].filter(Boolean);
  out.push(`> ${meta.join(' · ')}`, '');

  const block = (heading: string, items: string[]) => {
    if (items.length) out.push(`## ${line(heading)}`, '', ...items, '');
  };
  block(
    L.tldr,
    notes.tldr.map((t) => `- ${line(t)}`),
  );
  for (const section of notes.sections) {
    block(
      section.heading,
      section.bullets.map((b) => `- ${line(b.text)}`),
    );
  }
  block(
    L.decisions,
    notes.decisions.map((d) => `- ${line(d.text)}`),
  );
  block(
    L.actions,
    notes.actionItems.map(
      (a) =>
        `- [ ] ${line([a.text, a.owner && `— ${a.owner}`, a.due && `(${a.due})`].filter(Boolean).join(' '))}`,
    ),
  );
  block(
    L.questions,
    notes.openQuestions.filter((q) => !q.resolved).map((q) => `- ${line(q.text)}`),
  );
  if (s.transcript.length) out.push(`## ${L.transcript}`, '', s.transcript.join(' ').trim(), '');
  return `${out.join('\n').trimEnd()}\n`;
}

/** A filesystem-safe name such as `2026-10-31-budget-talk.md`. */
export function markdownFilename(s: MarkdownSource): string {
  const slug = sessionTitle(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const date = new Date(s.startedAt).toISOString().slice(0, 10);
  return `${date}-${slug || 'session'}.md`;
}
