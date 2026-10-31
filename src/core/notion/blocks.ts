import type { NotesState } from '../notes/types';

export const MAX_RICH_TEXT = 2000;
export const MAX_BLOCKS_PER_REQUEST = 100;
/** Transcript paragraphs stay well below the 2000 character limit. */
const TRANSCRIPT_PARAGRAPH = 1800;

export type Language = 'es' | 'en';

export interface RichText {
  type: 'text';
  text: { content: string };
}

export interface NotionBlock {
  object: 'block';
  type: string;
  [key: string]: unknown;
}

export interface Labels {
  tldr: string;
  decisions: string;
  actions: string;
  questions: string;
  transcript: string;
  date: string;
  source: string;
  duration: string;
}

export const LABELS: Record<Language, Labels> = {
  en: {
    tldr: 'TL;DR',
    decisions: 'Decisions',
    actions: 'Action items',
    questions: 'Open questions',
    transcript: 'Transcript',
    date: 'Date',
    source: 'Source',
    duration: 'Duration',
  },
  es: {
    tldr: 'TL;DR',
    decisions: 'Decisiones',
    actions: 'Tareas',
    questions: 'Preguntas abiertas',
    transcript: 'Transcripción',
    date: 'Fecha',
    source: 'Fuente',
    duration: 'Duración',
  },
};

const ES_WORDS = /\b(el|la|los|las|de|que|y|en|un|una|es|por|con|para|se|no|del|al)\b/gi;
const EN_WORDS = /\b(the|and|of|to|is|in|that|it|for|with|as|was|on|are|this)\b/gi;

/** Cheap language guess used to pick block headings when the notes language is "auto". */
export function detectLanguage(text: string): Language {
  const es = text.match(ES_WORDS)?.length ?? 0;
  const en = text.match(EN_WORDS)?.length ?? 0;
  return es > en ? 'es' : 'en';
}

/** Splits text into chunks of at most `max` characters, preferring whitespace and never splitting a surrogate pair. */
export function splitText(text: string, max = MAX_RICH_TEXT): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = max;
    const space = rest.lastIndexOf(' ', max);
    if (space > max * 0.8) cut = space + 1;
    const code = rest.charCodeAt(cut - 1);
    if (code >= 0xd800 && code <= 0xdbff) cut -= 1; // high surrogate: keep the pair together
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/** A rich_text array (max 100 items of 2000 characters each; longer text is truncated). */
export function richText(text: string): RichText[] {
  return splitText(text)
    .slice(0, 100)
    .map((content) => ({ type: 'text' as const, text: { content } }));
}

const block = (type: string, payload: Record<string, unknown>): NotionBlock => ({
  object: 'block',
  type,
  [type]: payload,
});

export const paragraph = (text: string) => block('paragraph', { rich_text: richText(text) });
export const heading2 = (text: string) => block('heading_2', { rich_text: richText(text) });
export const bullet = (text: string) => block('bulleted_list_item', { rich_text: richText(text) });
export const todo = (text: string) => block('to_do', { rich_text: richText(text), checked: false });
/** An empty toggle; its children are appended afterwards so large transcripts fit the request limits. */
export const toggle = (text: string) => block('toggle', { rich_text: richText(text) });

export interface BodyMeta {
  dateText?: string;
  sourceUrl?: string;
  durationText?: string;
}

export function notesToBlocks(
  notes: NotesState,
  labels: Labels,
  meta: BodyMeta = {},
): NotionBlock[] {
  const blocks: NotionBlock[] = [];

  const metaParts = [
    meta.dateText && `${labels.date}: ${meta.dateText}`,
    meta.sourceUrl && `${labels.source}: ${meta.sourceUrl}`,
    meta.durationText && `${labels.duration}: ${meta.durationText}`,
  ].filter((p): p is string => Boolean(p));
  if (metaParts.length) blocks.push(paragraph(metaParts.join(' · ')));

  if (notes.tldr.length) {
    blocks.push(heading2(labels.tldr), ...notes.tldr.map(bullet));
  }
  for (const section of notes.sections) {
    if (!section.bullets.length) continue;
    blocks.push(heading2(section.heading), ...section.bullets.map((b) => bullet(b.text)));
  }
  if (notes.decisions.length) {
    blocks.push(heading2(labels.decisions), ...notes.decisions.map((d) => bullet(d.text)));
  }
  if (notes.actionItems.length) {
    blocks.push(
      heading2(labels.actions),
      ...notes.actionItems.map((a) =>
        todo([a.text, a.owner && `— ${a.owner}`, a.due && `(${a.due})`].filter(Boolean).join(' ')),
      ),
    );
  }
  const open = notes.openQuestions.filter((q) => !q.resolved);
  if (open.length) {
    blocks.push(heading2(labels.questions), ...open.map((q) => bullet(q.text)));
  }
  return blocks;
}

/** The full transcript as paragraphs short enough for one rich_text item each. */
export function transcriptBlocks(finals: string[]): NotionBlock[] {
  const text = finals.join(' ').trim();
  return splitText(text, TRANSCRIPT_PARAGRAPH).map((chunk) => paragraph(chunk.trim()));
}

export function chunk<T>(items: T[], size = MAX_BLOCKS_PER_REQUEST): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
