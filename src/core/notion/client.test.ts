import { describe, expect, it } from 'vitest';
import { describeNotionError, NotionClient, NotionError } from './client';

function setup(responses: Array<Response | Error>) {
  let clock = 10_000;
  const sleeps: number[] = [];
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const queue = [...responses];
  const client = new NotionClient({
    token: 'secret_x',
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const next = queue.shift();
      if (!next) throw new Error('no more responses');
      if (next instanceof Error) throw next;
      return next;
    }) as typeof fetch,
  });
  return { client, sleeps, calls };
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, ...init });

describe('NotionClient', () => {
  it('sends the token and version headers', async () => {
    const { client, calls } = setup([json({ id: 'p1' })]);
    await client.getPage('p1');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer secret_x');
    expect(headers['Notion-Version']).toBe('2026-03-11');
    expect(calls[0]?.url).toBe('https://api.notion.com/v1/pages/p1');
  });

  it('uses the older version only to look up a database', async () => {
    const { client, calls } = setup([json({ data_sources: [] })]);
    await client.getDatabase('db1');
    expect((calls[0]?.init.headers as Record<string, string>)['Notion-Version']).toBe('2025-09-03');
  });

  it('spaces requests to about three per second', async () => {
    const { client, sleeps } = setup([json({}), json({}), json({})]);
    await client.getPage('a');
    await client.getPage('b');
    await client.getPage('c');
    expect(sleeps.filter((ms) => ms > 0)).toHaveLength(2);
    expect(Math.min(...sleeps)).toBeGreaterThanOrEqual(300);
  });

  it('waits for Retry-After on 429 and retries', async () => {
    const { client, sleeps, calls } = setup([
      new Response('{"code":"rate_limited"}', { status: 429, headers: { 'Retry-After': '2' } }),
      json({ id: 'ok' }),
    ]);
    await expect(client.createPage({})).resolves.toMatchObject({ id: 'ok' });
    expect(calls).toHaveLength(2);
    expect(sleeps).toContain(2000);
  });

  it('retries 5xx for GET but not for writes', async () => {
    const get = setup([new Response('{}', { status: 503 }), json({ id: 'x' })]);
    await expect(get.client.getPage('x')).resolves.toMatchObject({ id: 'x' });
    expect(get.calls).toHaveLength(2);

    const post = setup([new Response('{"code":"service_unavailable"}', { status: 503 }), json({})]);
    await expect(post.client.createPage({})).rejects.toMatchObject({ status: 503 });
    expect(post.calls).toHaveLength(1);
  });

  it('does not retry a write after a network error', async () => {
    const { client, calls } = setup([new TypeError('offline')]);
    await expect(client.appendChildren('b', [])).rejects.toMatchObject({ code: 'network_error' });
    expect(calls).toHaveLength(1);
  });

  it('gives up after repeated 429s', async () => {
    const { client, calls } = setup(
      Array.from({ length: 10 }, () => new Response('{"code":"rate_limited"}', { status: 429 })),
    );
    await expect(client.getPage('x')).rejects.toMatchObject({ status: 429 });
    expect(calls.length).toBe(6);
  });

  it('maps errors to readable messages without leaking the token', () => {
    expect(describeNotionError(new NotionError(401, 'unauthorized', 'x'))).toContain('token');
    expect(describeNotionError(new NotionError(404, 'object_not_found', 'x'))).toContain(
      'Connections',
    );
    expect(describeNotionError(new NotionError(401, 'unauthorized', 'secret_x'))).not.toContain(
      'secret_x',
    );
  });
});
