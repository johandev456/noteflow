import { describe, expect, it } from 'vitest';
import { applyOps } from '../notes/reducer';
import { emptyNotes, type NotesState } from '../notes/types';
import type { NotionApi, NotionDataSource, NotionPage } from './client';
import { NotionError } from './client';
import {
  buildProperties,
  exportToNotion,
  parseNotionId,
  resolveDestination,
  type ExportSession,
  type ResolvedDestination,
} from './exporter';

/** In-memory Notion: records every call and keeps block children per parent. */
class FakeNotion implements NotionApi {
  calls: string[] = [];
  children = new Map<string, string[]>();
  pages = new Map<string, NotionPage>();
  createBodies: Array<Record<string, unknown>> = [];
  appended: Array<{ parent: string; count: number }> = [];
  private n = 0;
  dataSource: NotionDataSource | null = null;
  databaseSources: Array<{ id: string; name: string }> = [];

  private id(prefix: string) {
    return `${prefix}${++this.n}`;
  }
  async getMe() {
    return {};
  }
  async getPage(id: string) {
    this.calls.push(`getPage:${id}`);
    const p = this.pages.get(id);
    if (!p) throw new NotionError(404, 'object_not_found', 'nope');
    return p;
  }
  async createPage(body: Record<string, unknown>) {
    this.calls.push('createPage');
    this.createBodies.push(body);
    const id = this.id('page');
    const page = { id, url: `https://notion.so/${id}` };
    this.pages.set(id, page);
    const kids = (body.children as unknown[]).map(() => this.id('blk'));
    this.children.set(id, kids);
    return page;
  }
  async updatePage(id: string) {
    this.calls.push(`updatePage:${id}`);
    return this.pages.get(id)!;
  }
  async listChildren(id: string) {
    this.calls.push(`listChildren:${id}`);
    return {
      results: (this.children.get(id) ?? []).map((x) => ({ id: x })),
      has_more: false,
      next_cursor: null,
    };
  }
  async appendChildren(id: string, children: unknown[]) {
    this.calls.push(`append:${id}`);
    if (children.length > 100) throw new Error('more than 100 children');
    this.appended.push({ parent: id, count: children.length });
    const ids = children.map(() => this.id('blk'));
    this.children.set(id, [...(this.children.get(id) ?? []), ...ids]);
    return { results: ids.map((x) => ({ id: x })), has_more: false, next_cursor: null };
  }
  async deleteBlock(id: string) {
    this.calls.push(`delete:${id}`);
    for (const [k, v] of this.children)
      this.children.set(
        k,
        v.filter((x) => x !== id),
      );
  }
  async getDataSource(id: string) {
    this.calls.push(`getDataSource:${id}`);
    if (!this.dataSource || this.dataSource.id !== id)
      throw new NotionError(404, 'object_not_found', 'x');
    return this.dataSource;
  }
  async getDatabase() {
    this.calls.push('getDatabase');
    return { data_sources: this.databaseSources };
  }
}

const session = (over: Partial<ExportSession> = {}): ExportSession => ({
  startedAt: Date.UTC(2026, 9, 31, 14, 0),
  endedAt: Date.UTC(2026, 9, 31, 14, 12),
  tabUrl: 'https://youtube.com/watch?v=1',
  tabTitle: 'A talk',
  transcript: ['Hola a todos.', 'Hablemos del presupuesto.'],
  ...over,
});

const notesWith = (bullets: number): NotesState =>
  applyOps(emptyNotes(), [
    { op: 'set_title', text: 'Budget talk' },
    { op: 'add_section', heading: 'Budget', id: 's' },
    ...Array.from({ length: bullets }, (_, i) => ({
      op: 'add_bullet' as const,
      sectionId: 's',
      text: `Point ${i}`,
    })),
  ]);

const pageDest: ResolvedDestination = { kind: 'page', id: 'parent', name: 'Page' };
const dbDest: ResolvedDestination = {
  kind: 'data_source',
  id: 'ds1',
  name: 'Meetings',
  titleProperty: 'Name',
  properties: {
    Name: { id: 't', name: 'Name', type: 'title' },
    Date: { id: 'd', name: 'Date', type: 'date' },
    URL: { id: 'u', name: 'URL', type: 'url' },
    Duration: { id: 'n', name: 'Duration', type: 'number' },
    Tags: { id: 'g', name: 'Tags', type: 'multi_select' },
    Status: { id: 's', name: 'Status', type: 'select' },
  },
};
const opts = { language: 'en' as const, tags: [] as string[] };

describe('parseNotionId', () => {
  const id = '0123456789abcdef0123456789abcdef';
  const dashed = '01234567-89ab-cdef-0123-456789abcdef';
  it('parses bare ids, dashed ids and URLs', () => {
    expect(parseNotionId(id)).toBe(dashed);
    expect(parseNotionId(dashed)).toBe(dashed);
    expect(parseNotionId(`https://www.notion.so/My-Page-Title-${id}`)).toBe(dashed);
    expect(
      parseNotionId(`https://www.notion.so/team/${id}?v=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&pvs=4`),
    ).toBe(dashed);
    expect(parseNotionId(`https://www.notion.so/abc-def-${id}/`)).toBe(dashed);
  });
  it('rejects text without an id', () => {
    expect(parseNotionId('hello')).toBeNull();
    expect(parseNotionId('')).toBeNull();
  });
});

describe('buildProperties', () => {
  const input = {
    title: 'T',
    startedAt: Date.UTC(2026, 9, 31, 14, 0),
    durationMs: 12 * 60_000,
    url: 'https://x.y',
    tags: ['work'],
  };

  it('uses only a title for a page parent', () => {
    const r = buildProperties(pageDest, input);
    expect(Object.keys(r.properties)).toEqual(['title']);
    expect(r.covered.size).toBe(0);
  });

  it('fills matching database properties by name and type', () => {
    const r = buildProperties(dbDest, input);
    expect(r.properties.Date).toEqual({ date: { start: '2026-10-31T14:00:00.000Z' } });
    expect(r.properties.URL).toEqual({ url: 'https://x.y' });
    expect(r.properties.Duration).toEqual({ number: 12 });
    expect(r.properties.Tags).toEqual({ multi_select: [{ name: 'work' }] });
    expect(r.properties.Status).toBeUndefined();
    expect([...r.covered].sort()).toEqual(['date', 'duration', 'url']);
  });

  it('skips properties with the wrong type and uses text for a text duration', () => {
    const dest: ResolvedDestination = {
      ...dbDest,
      properties: {
        Name: { id: 't', name: 'Name', type: 'title' },
        Date: { id: 'd', name: 'Date', type: 'rich_text' },
        Duración: { id: 'n', name: 'Duración', type: 'rich_text' },
      },
    };
    const r = buildProperties(dest, input);
    expect(r.properties.Date).toBeUndefined();
    expect(r.properties['Duración']).toEqual({
      rich_text: [{ type: 'text', text: { content: '12 min' } }],
    });
  });
});

describe('resolveDestination', () => {
  it('verifies page access', async () => {
    const api = new FakeNotion();
    api.pages.set('p', { id: 'p' });
    await expect(resolveDestination(api, { type: 'page', id: 'p' })).resolves.toMatchObject({
      kind: 'page',
    });
    await expect(resolveDestination(api, { type: 'page', id: 'missing' })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('accepts a data source id directly', async () => {
    const api = new FakeNotion();
    api.dataSource = {
      id: 'ds',
      properties: dbDest.kind === 'data_source' ? dbDest.properties : {},
    };
    const r = await resolveDestination(api, { type: 'database', id: 'ds' });
    expect(r).toMatchObject({ kind: 'data_source', titleProperty: 'Name' });
  });

  it('falls back to a database id and uses its first data source', async () => {
    const api = new FakeNotion();
    api.dataSource = { id: 'ds', properties: { Title: { id: 't', name: 'Title', type: 'title' } } };
    api.databaseSources = [{ id: 'ds', name: 'Main' }];
    const r = await resolveDestination(api, { type: 'database', id: 'db' });
    expect(r).toMatchObject({ id: 'ds', titleProperty: 'Title' });
    expect(api.calls).toContain('getDatabase');
  });
});

describe('exportToNotion', () => {
  it('creates a page with notes first and the transcript in a toggle', async () => {
    const api = new FakeNotion();
    let saved: string | undefined;
    const res = await exportToNotion(api, dbDest, session(), notesWith(3), {
      ...opts,
      onPage: (p) => (saved = p.id),
    });
    expect(res.updated).toBe(false);
    expect(saved).toBe(res.pageId);
    const body = api.createBodies[0]!;
    expect(body.parent).toEqual({ type: 'data_source_id', data_source_id: 'ds1' });
    expect((body.children as unknown[]).length).toBe(4); // heading + 3 bullets, metadata is in properties
    // transcript toggle appended afterwards, then its paragraphs inside the toggle
    expect(api.appended.at(0)?.count).toBe(1);
    expect(api.appended.at(1)?.parent).not.toBe(res.pageId);
  });

  it('puts metadata in the body for a page parent', async () => {
    const api = new FakeNotion();
    await exportToNotion(api, pageDest, session(), notesWith(1), opts);
    const first = (api.createBodies[0]!.children as Array<{ type: string }>)[0];
    expect(first?.type).toBe('paragraph');
    expect(api.createBodies[0]!.parent).toEqual({ type: 'page_id', page_id: 'parent' });
  });

  it('respects the 100 block limit for long notes', async () => {
    const api = new FakeNotion();
    await exportToNotion(api, pageDest, session(), notesWith(250), opts);
    expect((api.createBodies[0]!.children as unknown[]).length).toBeLessThanOrEqual(100);
    expect(api.appended.every((a) => a.count <= 100)).toBe(true);
    const total =
      (api.createBodies[0]!.children as unknown[]).length +
      api.appended.filter((a) => a.parent.startsWith('page')).reduce((n, a) => n + a.count, 0);
    expect(total).toBe(1 + 1 + 250 + 1); // metadata + heading + bullets + transcript toggle
  });

  it('updates the existing page instead of creating a duplicate', async () => {
    const api = new FakeNotion();
    const first = await exportToNotion(api, dbDest, session(), notesWith(2), opts);
    api.calls = [];
    api.createBodies = [];
    const second = await exportToNotion(
      api,
      dbDest,
      session({ notionPageId: first.pageId }),
      notesWith(5),
      opts,
    );
    expect(second.updated).toBe(true);
    expect(second.pageId).toBe(first.pageId);
    expect(api.createBodies).toHaveLength(0);
    expect(api.calls.filter((c) => c.startsWith('delete:')).length).toBeGreaterThan(0);
    expect(api.calls).toContain(`updatePage:${first.pageId}`);
  });

  it('creates a new page when the old one was deleted or trashed', async () => {
    const api = new FakeNotion();
    const gone = await exportToNotion(api, dbDest, session(), notesWith(1), opts);
    api.pages.delete(gone.pageId);
    const a = await exportToNotion(
      api,
      dbDest,
      session({ notionPageId: gone.pageId }),
      notesWith(1),
      opts,
    );
    expect(a.updated).toBe(false);

    api.pages.set(a.pageId, { id: a.pageId, in_trash: true });
    const b = await exportToNotion(
      api,
      dbDest,
      session({ notionPageId: a.pageId }),
      notesWith(1),
      opts,
    );
    expect(b.updated).toBe(false);
    expect(b.pageId).not.toBe(a.pageId);
  });

  it('uses Spanish headings for Spanish content in auto mode', async () => {
    const api = new FakeNotion();
    const notes = applyOps(notesWith(1), [{ op: 'add_decision', text: 'Aprobar' }]);
    await exportToNotion(api, pageDest, session(), notes, { language: 'auto', tags: [] });
    const text = JSON.stringify(api.createBodies[0]);
    expect(text).toContain('Decisiones');
  });
});
