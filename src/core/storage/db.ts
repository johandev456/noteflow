import Dexie, { type EntityTable } from 'dexie';
import type { Usage } from '../llm/usage';
import type { NotesState } from '../notes/types';

export interface SessionRow {
  id: string;
  startedAt: number;
  endedAt?: number;
  updatedAt: number;
  /** `recording` until the session ends; a stale one means the browser closed mid-recording. */
  status: 'recording' | 'done';
  tabUrl?: string;
  tabTitle?: string;
  /** Final transcript segments, in order. */
  transcript: string[];
  notes: NotesState;
  usage: Usage;
  notionPageId?: string;
  notionUrl?: string;
}

class NoteflowDb extends Dexie {
  sessions!: EntityTable<SessionRow, 'id'>;

  constructor() {
    super('noteflow');
    this.version(1).stores({ sessions: 'id, startedAt, status' });
  }
}

export const db = new NoteflowDb();
