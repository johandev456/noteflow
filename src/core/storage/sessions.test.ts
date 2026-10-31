import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
  deleteSession,
  findActiveSession,
  getSession,
  listSessions,
  newSession,
  saveSession,
} from './sessions';

beforeEach(async () => {
  await db.sessions.clear();
});

describe('sessions repository', () => {
  it('saves, reads and deletes a session', async () => {
    const s = newSession({ tabTitle: 'Talk', tabUrl: 'https://x.y' });
    await saveSession(s);
    expect(await getSession(s.id)).toMatchObject({ tabTitle: 'Talk', status: 'recording' });
    await deleteSession(s.id);
    expect(await getSession(s.id)).toBeUndefined();
  });

  it('lists newest first and honours the limit', async () => {
    const a = newSession({}, 1000);
    const b = newSession({}, 3000);
    const c = newSession({}, 2000);
    await Promise.all([a, b, c].map(saveSession));
    expect((await listSessions()).map((s) => s.startedAt)).toEqual([3000, 2000, 1000]);
    expect(await listSessions(1)).toHaveLength(1);
  });

  it('finds the session that is still recording', async () => {
    const done = { ...newSession({}, 1), status: 'done' as const };
    const live = newSession({}, 2);
    await saveSession(done);
    expect(await findActiveSession()).toBeUndefined();
    await saveSession(live);
    expect((await findActiveSession())?.id).toBe(live.id);
  });

  it('updates in place on repeated saves and keeps transcript and notion link', async () => {
    const s = newSession({});
    await saveSession(s);
    await saveSession({
      ...s,
      transcript: ['hello'],
      notionPageId: 'p1',
      notionUrl: 'https://n/p1',
    });
    expect(await db.sessions.count()).toBe(1);
    expect(await getSession(s.id)).toMatchObject({ transcript: ['hello'], notionPageId: 'p1' });
  });
});
