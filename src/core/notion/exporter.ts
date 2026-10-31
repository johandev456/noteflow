import type { NotesLanguage } from '../llm/prompts';
import type { NotesState } from '../notes/types';
import {
  chunk,
  detectLanguage,
  LABELS,
  notesToBlocks,
  richText,
  toggle,
  transcriptBlocks,
  type BodyMeta,
  type Language,
  type NotionBlock,
} from './blocks';
import { NotionError, type NotionApi, type NotionDataSource } from './client';

export interface ExportSession {
  startedAt: number;
  endedAt?: number;
  tabUrl?: string;
  tabTitle?: string;
  transcript: string[];
  /** Saved after the first export so later syncs update the same page. */
  notionPageId?: string;
}

export interface ExportTarget {
  type: 'page' | 'database';
  id: string;
}

export type ResolvedDestination =
  | { kind: 'page'; id: string; name: string }
  | {
      kind: 'data_source';
      id: string;
      name: string;
      titleProperty: string;
      properties: NotionDataSource['properties'];
    };

/** Accepts a Notion URL or a bare id (with or without dashes) and returns a dashed UUID. */
export function parseNotionId(input: string): string | null {
  const path = (input.trim().split(/[?#]/)[0] ?? '').replace(/\/+$/, '').replace(/-/g, '');
  const raw = path.match(/[0-9a-f]{32}$/i)?.[0];
  if (!raw) return null;
  const h = raw.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function sourceName(ds: NotionDataSource): string {
  return ds.title?.map((t) => t.plain_text ?? '').join('') || 'Untitled database';
}

async function loadDataSource(api: NotionApi, id: string): Promise<ResolvedDestination> {
  const ds = await api.getDataSource(id);
  const title = Object.entries(ds.properties).find(([, p]) => p.type === 'title');
  if (!title) throw new Error('The selected database has no title property.');
  return {
    kind: 'data_source',
    id: ds.id,
    name: sourceName(ds),
    titleProperty: title[0],
    properties: ds.properties,
  };
}

/** Verifies the integration can see the destination and finds what is needed to create pages in it. */
export async function resolveDestination(
  api: NotionApi,
  target: ExportTarget,
): Promise<ResolvedDestination> {
  if (target.type === 'page') {
    await api.getPage(target.id);
    return { kind: 'page', id: target.id, name: 'Page' };
  }
  try {
    return await loadDataSource(api, target.id);
  } catch (err) {
    // The id may be a database id rather than a data source id.
    if (!(err instanceof NotionError) || (err.status !== 404 && err.status !== 400)) throw err;
  }
  const db = await api.getDatabase(target.id);
  const first = db.data_sources?.[0];
  if (!first) throw new NotionError(404, 'object_not_found', 'Database not found');
  return loadDataSource(api, first.id);
}

const NAMES = {
  date: ['date', 'fecha'],
  url: ['url', 'link', 'source', 'fuente', 'enlace'],
  duration: ['duration', 'duración', 'duracion'],
  tags: ['tags', 'etiquetas'],
};

function findProperty(
  properties: NotionDataSource['properties'],
  names: string[],
  types: string[],
): string | undefined {
  return Object.keys(properties).find(
    (key) => types.includes(properties[key]!.type) && names.includes(key.trim().toLowerCase()),
  );
}

export interface PropertyInput {
  title: string;
  startedAt: number;
  durationMs: number;
  url?: string;
  tags: string[];
}

export interface BuiltProperties {
  properties: Record<string, unknown>;
  /** Metadata already stored as properties, so it need not be repeated in the page body. */
  covered: Set<'date' | 'url' | 'duration'>;
}

export function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return `${minutes} min`;
}

/** Only fills properties that exist in the database with a matching type; it never edits the schema. */
export function buildProperties(dest: ResolvedDestination, input: PropertyInput): BuiltProperties {
  const covered = new Set<'date' | 'url' | 'duration'>();
  const title = { title: richText(input.title) };
  if (dest.kind === 'page') return { properties: { title }, covered };

  const properties: Record<string, unknown> = { [dest.titleProperty]: title };
  const date = findProperty(dest.properties, NAMES.date, ['date']);
  if (date) {
    properties[date] = { date: { start: new Date(input.startedAt).toISOString() } };
    covered.add('date');
  }
  const url = findProperty(dest.properties, NAMES.url, ['url']);
  if (url && input.url) {
    properties[url] = { url: input.url };
    covered.add('url');
  }
  const duration = findProperty(dest.properties, NAMES.duration, ['number', 'rich_text']);
  if (duration) {
    const type = dest.properties[duration]!.type;
    const minutes = Math.max(1, Math.round(input.durationMs / 60_000));
    properties[duration] =
      type === 'number'
        ? { number: minutes }
        : { rich_text: richText(formatDuration(input.durationMs)) };
    covered.add('duration');
  }
  const tags = findProperty(dest.properties, NAMES.tags, ['multi_select']);
  if (tags && input.tags.length) {
    properties[tags] = { multi_select: input.tags.map((name) => ({ name })) };
  }
  return { properties, covered };
}

export interface ExportOptions {
  language: NotesLanguage;
  tags: string[];
  /** Called as soon as the page exists, so a failed export can be retried without duplicating it. */
  onPage?: (page: { id: string; url?: string }) => void;
}

export interface ExportResult {
  pageId: string;
  url?: string;
  /** True when a previously exported page was updated in place. */
  updated: boolean;
}

async function clearChildren(api: NotionApi, pageId: string): Promise<void> {
  let cursor: string | undefined;
  const ids: string[] = [];
  do {
    const list = await api.listChildren(pageId, cursor);
    ids.push(...list.results.map((b) => b.id));
    cursor = list.has_more && list.next_cursor ? list.next_cursor : undefined;
  } while (cursor);
  for (const id of ids) await api.deleteBlock(id); // deleting a block also removes its children
}

async function appendBlocks(api: NotionApi, pageId: string, blocks: NotionBlock[]): Promise<void> {
  for (const batch of chunk(blocks)) await api.appendChildren(pageId, batch);
}

async function appendTranscript(
  api: NotionApi,
  pageId: string,
  label: string,
  paragraphs: NotionBlock[],
): Promise<void> {
  if (!paragraphs.length) return;
  const created = await api.appendChildren(pageId, [toggle(label)]);
  const toggleId = created.results[0]?.id;
  if (!toggleId) throw new Error('Notion did not return the transcript toggle.');
  for (const batch of chunk(paragraphs)) await api.appendChildren(toggleId, batch);
}

async function existingPage(api: NotionApi, id: string | undefined): Promise<string | null> {
  if (!id) return null;
  try {
    const page = await api.getPage(id);
    return page.in_trash || page.archived ? null : page.id;
  } catch (err) {
    if (err instanceof NotionError && err.status === 404) return null; // deleted or unshared: start over
    throw err;
  }
}

/**
 * Creates the page, or updates the one from a previous export (replacing its content),
 * so syncing again never creates duplicates.
 */
export async function exportToNotion(
  api: NotionApi,
  dest: ResolvedDestination,
  session: ExportSession,
  notes: NotesState,
  opts: ExportOptions,
): Promise<ExportResult> {
  const title = (notes.title || session.tabTitle || 'NoteFlow session').slice(0, 200);
  const durationMs = (session.endedAt ?? Date.now()) - session.startedAt;
  const language: Language =
    opts.language === 'auto'
      ? detectLanguage([notes.title, ...notes.tldr, ...session.transcript.slice(0, 20)].join(' '))
      : opts.language;
  const labels = LABELS[language];

  const { properties, covered } = buildProperties(dest, {
    title,
    startedAt: session.startedAt,
    durationMs,
    url: session.tabUrl,
    tags: opts.tags,
  });
  const meta: BodyMeta = {
    ...(covered.has('date')
      ? {}
      : { dateText: new Date(session.startedAt).toISOString().slice(0, 16).replace('T', ' ') }),
    ...(covered.has('url') || !session.tabUrl ? {} : { sourceUrl: session.tabUrl }),
    ...(covered.has('duration') ? {} : { durationText: formatDuration(durationMs) }),
  };
  const blocks = notesToBlocks(notes, labels, meta);
  const transcript = transcriptBlocks(session.transcript);

  const pageId = await existingPage(api, session.notionPageId);
  if (pageId) {
    const page = await api.updatePage(pageId, { properties });
    opts.onPage?.({ id: pageId, url: page.url });
    await clearChildren(api, pageId);
    await appendBlocks(api, pageId, blocks);
    await appendTranscript(api, pageId, labels.transcript, transcript);
    return { pageId, url: page.url, updated: true };
  }

  const [first = [], ...rest] = chunk(blocks);
  const created = await api.createPage({
    parent:
      dest.kind === 'page'
        ? { type: 'page_id', page_id: dest.id }
        : { type: 'data_source_id', data_source_id: dest.id },
    properties,
    children: first,
  });
  opts.onPage?.({ id: created.id, url: created.url });
  await appendBlocks(api, created.id, rest.flat());
  await appendTranscript(api, created.id, labels.transcript, transcript);
  return { pageId: created.id, url: created.url, updated: false };
}
