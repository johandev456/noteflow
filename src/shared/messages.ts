/** Messages exchanged between sidepanel, background and offscreen document. */
import type { Usage } from '../core/llm/usage';
import type { NotesState } from '../core/notes/types';
import type { ConnectionState } from '../core/stt/types';

export type { ConnectionState };

export type SessionStatus = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping' | 'error';

export interface NotesSnapshot {
  notes: NotesState;
  usage: Usage;
  /** An LLM call (or the final pass) is running. */
  busy: boolean;
  error?: string;
}

export interface ExportState {
  status: 'idle' | 'syncing' | 'done' | 'error';
  /** Link to the Notion page once exported. */
  url?: string;
  error?: string;
}

export interface SessionSnapshot {
  status: SessionStatus;
  connection: ConnectionState;
  error?: string;
  notes: NotesSnapshot;
  /** The session shown in the "current" tab: the active recording, or the latest finished one. */
  sessionId: string | null;
  startedAt: number | null;
  transcript: string[];
  /** Notion sync state per session id. */
  exports: Record<string, ExportState>;
}

/** Sidepanel / keyboard command -> background. */
export type PanelCommand =
  | { type: 'session/start' }
  | { type: 'session/stop' }
  | { type: 'session/pause' }
  | { type: 'session/resume' }
  | { type: 'session/getState' }
  | { type: 'notes/edit'; id: string; text: string }
  | { type: 'notes/delete'; id: string }
  /** Defaults to the current session. */
  | { type: 'export/sync'; sessionId?: string }
  | { type: 'session/delete'; sessionId: string };

/** Background -> offscreen document. */
export type OffscreenCommand =
  | { type: 'offscreen/start'; streamId: string; apiKey: string; language: string }
  | { type: 'offscreen/stop' }
  | { type: 'offscreen/pause' }
  | { type: 'offscreen/resume' }
  /** Answered with `{ status: 'recording' | 'paused' | 'idle' }`. */
  | { type: 'offscreen/getStatus' };

/** Events broadcast to every extension page (offscreen and background emit them). */
export type SessionEvent =
  | { type: 'session/status'; status: SessionStatus; error?: string }
  | { type: 'stt/transcript'; text: string; isFinal: boolean }
  | { type: 'stt/connection'; state: ConnectionState }
  | { type: 'audio/level'; level: number }
  | ({ type: 'notes/state' } & NotesSnapshot)
  | ({ type: 'export/state'; sessionId: string } & ExportState)
  /** The stored sessions changed; history views should reload. */
  | { type: 'history/changed' }
  /** The "current" session changed (for example it was deleted). */
  | {
      type: 'session/current';
      sessionId: string | null;
      startedAt: number | null;
      transcript: string[];
    };

export type Message = PanelCommand | OffscreenCommand | SessionEvent;

/** Broadcast a message to all other extension contexts, ignoring "no receiver" errors. */
export function send(message: Message): void {
  browser.runtime.sendMessage(message).catch(() => {});
}
