import { emptyUsage } from '../llm/usage';
import { emptyNotes } from '../notes/types';
import { db, type SessionRow } from './db';

export type { SessionRow };

export function newSession(
  init: { tabUrl?: string; tabTitle?: string },
  now = Date.now(),
): SessionRow {
  return {
    id: crypto.randomUUID(),
    startedAt: now,
    updatedAt: now,
    status: 'recording',
    tabUrl: init.tabUrl,
    tabTitle: init.tabTitle,
    transcript: [],
    notes: emptyNotes(),
    usage: emptyUsage(),
  };
}

export async function saveSession(row: SessionRow): Promise<void> {
  await db.sessions.put({ ...row, updatedAt: Date.now() });
}

export function getSession(id: string): Promise<SessionRow | undefined> {
  return db.sessions.get(id);
}

/** Newest first. */
export function listSessions(limit?: number): Promise<SessionRow[]> {
  const query = db.sessions.orderBy('startedAt').reverse();
  return (limit ? query.limit(limit) : query).toArray();
}

export async function deleteSession(id: string): Promise<void> {
  await db.sessions.delete(id);
}

/** The session that was still recording when the service worker last stopped, if any. */
export async function findActiveSession(): Promise<SessionRow | undefined> {
  return db.sessions.where('status').equals('recording').first();
}

/** One-time import of the single "last session" kept before the history existed. */
export async function migrateLegacySession(): Promise<void> {
  const KEY = 'lastSession';
  const stored = await browser.storage.local.get(KEY);
  const legacy = stored[KEY] as
    | {
        record: Omit<SessionRow, 'id' | 'status' | 'updatedAt' | 'notes' | 'usage'> | null;
        notes: { notes: SessionRow['notes']; usage: SessionRow['usage'] };
      }
    | undefined;
  if (!legacy) return;
  if (legacy.record && (await db.sessions.count()) === 0) {
    await saveSession({
      ...legacy.record,
      id: crypto.randomUUID(),
      status: 'done',
      updatedAt: Date.now(),
      notes: legacy.notes.notes,
      usage: legacy.notes.usage,
    });
  }
  await browser.storage.local.remove(KEY);
}
