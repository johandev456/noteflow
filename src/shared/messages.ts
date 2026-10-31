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
  export: ExportState;
  /** A finished session exists that can be exported. */
  hasSession: boolean;
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
  | { type: 'export/sync' };

/** Background -> offscreen document. */
export type OffscreenCommand =
  | { type: 'offscreen/start'; streamId: string; apiKey: string; language: string }
  | { type: 'offscreen/stop' }
  | { type: 'offscreen/pause' }
  | { type: 'offscreen/resume' };

/** Events broadcast to every extension page (offscreen and background emit them). */
export type SessionEvent =
  | { type: 'session/status'; status: SessionStatus; error?: string }
  | { type: 'stt/transcript'; text: string; isFinal: boolean }
  | { type: 'stt/connection'; state: ConnectionState }
  | { type: 'audio/level'; level: number }
  | ({ type: 'notes/state' } & NotesSnapshot)
  | ({ type: 'export/state' } & ExportState);

export type Message = PanelCommand | OffscreenCommand | SessionEvent;

/** Broadcast a message to all other extension contexts, ignoring "no receiver" errors. */
export function send(message: Message): void {
  browser.runtime.sendMessage(message).catch(() => {});
}
