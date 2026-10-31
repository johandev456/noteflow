const API_BASE = 'https://api.notion.com';
const API_VERSION = '2026-03-11';
/** Retrieving a database (to find its data source) is only available up to this version. */
const DATABASE_API_VERSION = '2025-09-03';
/** ~3 requests per second, as recommended for a single connection. */
const MIN_INTERVAL_MS = 340;
const MAX_RETRIES = 5;

export class NotionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'NotionError';
  }
}

export interface NotionPage {
  id: string;
  url?: string;
  archived?: boolean;
  in_trash?: boolean;
}

export interface NotionDataSource {
  id: string;
  title?: Array<{ plain_text?: string }>;
  properties: Record<string, { id: string; name: string; type: string }>;
}

export interface NotionBlockRef {
  id: string;
}

export interface NotionList<T> {
  results: T[];
  has_more: boolean;
  next_cursor: string | null;
}

/** The subset of the Notion API this app uses; the exporter depends on this, not on fetch. */
export interface NotionApi {
  getMe(): Promise<{ name?: string; bot?: { workspace_name?: string | null } }>;
  getPage(id: string): Promise<NotionPage>;
  createPage(body: Record<string, unknown>): Promise<NotionPage>;
  updatePage(id: string, body: Record<string, unknown>): Promise<NotionPage>;
  listChildren(id: string, cursor?: string): Promise<NotionList<NotionBlockRef>>;
  appendChildren(id: string, children: unknown[]): Promise<NotionList<NotionBlockRef>>;
  deleteBlock(id: string): Promise<void>;
  getDataSource(id: string): Promise<NotionDataSource>;
  getDatabase(id: string): Promise<{ data_sources?: Array<{ id: string; name: string }> }>;
}

export interface NotionClientOptions {
  token: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export class NotionClient implements NotionApi {
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private lastStart = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: NotionClientOptions) {
    this.fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
  }

  getMe() {
    return this.request<{ name?: string; bot?: { workspace_name?: string | null } }>(
      'GET',
      '/v1/users/me',
    );
  }
  getPage(id: string) {
    return this.request<NotionPage>('GET', `/v1/pages/${id}`);
  }
  createPage(body: Record<string, unknown>) {
    return this.request<NotionPage>('POST', '/v1/pages', body);
  }
  updatePage(id: string, body: Record<string, unknown>) {
    return this.request<NotionPage>('PATCH', `/v1/pages/${id}`, body);
  }
  listChildren(id: string, cursor?: string) {
    const query = cursor
      ? `?page_size=100&start_cursor=${encodeURIComponent(cursor)}`
      : '?page_size=100';
    return this.request<NotionList<NotionBlockRef>>('GET', `/v1/blocks/${id}/children${query}`);
  }
  appendChildren(id: string, children: unknown[]) {
    return this.request<NotionList<NotionBlockRef>>('PATCH', `/v1/blocks/${id}/children`, {
      children,
    });
  }
  async deleteBlock(id: string) {
    await this.request('DELETE', `/v1/blocks/${id}`);
  }
  getDataSource(id: string) {
    return this.request<NotionDataSource>('GET', `/v1/data_sources/${id}`);
  }
  getDatabase(id: string) {
    return this.request<{ data_sources?: Array<{ id: string; name: string }> }>(
      'GET',
      `/v1/databases/${id}`,
      undefined,
      DATABASE_API_VERSION,
    );
  }

  /** All requests go through one queue so the ~3 req/s pace holds across callers. */
  private request<T>(
    method: Method,
    path: string,
    body?: unknown,
    version = API_VERSION,
  ): Promise<T> {
    const run = () => this.execute<T>(method, path, body, version);
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  private async execute<T>(
    method: Method,
    path: string,
    body: unknown,
    version: string,
  ): Promise<T> {
    const idempotent = method === 'GET' || method === 'DELETE';
    for (let attempt = 0; ; attempt++) {
      const wait = this.lastStart + MIN_INTERVAL_MS - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastStart = this.now();

      let res: Response;
      try {
        res = await this.fetchFn(`${API_BASE}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${this.opts.token}`,
            'Notion-Version': version,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (err) {
        // A network error on a write may still have been applied, so only reads are retried.
        if (idempotent && attempt < MAX_RETRIES) {
          await this.sleep(backoff(attempt));
          continue;
        }
        throw new NotionError(
          0,
          'network_error',
          err instanceof Error ? err.message : 'Network error',
        );
      }

      if (res.ok) return (await res.json().catch(() => ({}))) as T;

      const retryable =
        res.status === 429 ||
        res.status === 529 ||
        (idempotent && res.status >= 500 && res.status < 600);
      if (retryable && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get('Retry-After'));
        await this.sleep(retryAfter > 0 ? retryAfter * 1000 : backoff(attempt));
        continue;
      }
      const err = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
      throw new NotionError(res.status, err.code ?? 'unknown', err.message ?? `HTTP ${res.status}`);
    }
  }
}

function backoff(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 15_000);
}

/** User-facing description of a Notion failure (never includes the token). */
export function describeNotionError(err: unknown): string {
  if (err instanceof NotionError) {
    if (err.status === 401) return 'Notion rejected the token. Check it in Settings.';
    if (err.status === 404 || err.code === 'object_not_found') {
      return 'Notion cannot see the destination. Open it in Notion, use ⋯ → Connections and add your integration.';
    }
    if (err.status === 403) return 'The Notion integration lacks permission for this action.';
    if (err.status === 429 || err.status === 529)
      return 'Notion rate limit reached; try again shortly.';
    if (err.status === 0) return 'Could not reach Notion. Check your connection.';
    return `Notion error (${err.status}): ${err.message}`;
  }
  return err instanceof Error ? err.message : 'Notion export failed.';
}
