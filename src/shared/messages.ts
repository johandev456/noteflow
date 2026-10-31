/** Messages exchanged between sidepanel, background and offscreen document. */

export type SessionStatus = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping' | 'error';

export type PanelToBackground =
  | { type: 'session/start' }
  | { type: 'session/stop' }
  | { type: 'session/pause' }
  | { type: 'session/resume' };

export type BackgroundToPanel =
  | { type: 'session/status'; status: SessionStatus; error?: string }
  | { type: 'stt/transcript'; text: string; isFinal: boolean }
  | { type: 'audio/level'; level: number };

export type Message = PanelToBackground | BackgroundToPanel;
