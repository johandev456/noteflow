/** Messages exchanged between sidepanel, background and offscreen document. */
import type { ConnectionState } from '../core/stt/types';

export type { ConnectionState };

export type SessionStatus = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping' | 'error';

export interface SessionSnapshot {
  status: SessionStatus;
  connection: ConnectionState;
  error?: string;
}

/** Sidepanel / keyboard command -> background. */
export type PanelCommand =
  | { type: 'session/start' }
  | { type: 'session/stop' }
  | { type: 'session/pause' }
  | { type: 'session/resume' }
  | { type: 'session/getState' };

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
  | { type: 'audio/level'; level: number };

export type Message = PanelCommand | OffscreenCommand | SessionEvent;

/** Broadcast a message to all other extension contexts, ignoring "no receiver" errors. */
export function send(message: Message): void {
  browser.runtime.sendMessage(message).catch(() => {});
}
