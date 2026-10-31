import { create } from 'zustand';
import { emptyUsage, type Prices, type Usage } from '../../core/llm/usage';
import { emptyNotes, type NotesState } from '../../core/notes/types';
import { loadSettings } from '../../core/storage/settings';
import {
  send,
  type ConnectionState,
  type ExportState,
  type Message,
  type NotesSnapshot,
  type SessionSnapshot,
  type SessionStatus,
} from '../../shared/messages';

interface SessionState {
  status: SessionStatus;
  connection: ConnectionState;
  error?: string;
  level: number;
  finals: string[];
  interim: string;
  startedAt: number | null;
  notes: NotesState;
  usage: Usage;
  notesBusy: boolean;
  notesError?: string;
  prices: Prices;
  hasSession: boolean;
  notion: ExportState;
}

export const useSession = create<SessionState>(() => ({
  status: 'idle',
  connection: 'closed',
  level: 0,
  finals: [],
  interim: '',
  startedAt: null,
  notes: emptyNotes(),
  usage: emptyUsage(),
  notesBusy: false,
  prices: { inputPerM: 0, outputPerM: 0 },
  hasSession: false,
  notion: { status: 'idle' },
}));

function applyStatus(status: SessionStatus, error?: string): void {
  useSession.setState((s) => {
    const starting = status === 'starting';
    const active = status === 'recording' || status === 'paused' || status === 'stopping';
    return {
      status,
      error,
      level: status === 'recording' ? s.level : 0,
      interim: status === 'idle' || status === 'error' ? '' : s.interim,
      // A new session clears the previous transcript.
      finals: starting ? [] : s.finals,
      startedAt: starting ? Date.now() : active ? s.startedAt : null,
      hasSession: s.hasSession || active,
    };
  });
}

function applyNotes(snap: NotesSnapshot): void {
  useSession.setState({
    notes: snap.notes,
    usage: snap.usage,
    notesBusy: snap.busy,
    notesError: snap.error,
  });
}

function handleMessage(message: Message): void {
  switch (message.type) {
    case 'session/status':
      applyStatus(message.status, message.error);
      break;
    case 'stt/connection':
      useSession.setState({ connection: message.state });
      break;
    case 'audio/level':
      useSession.setState({ level: message.level });
      break;
    case 'stt/transcript':
      useSession.setState((s) =>
        message.isFinal
          ? { finals: [...s.finals, message.text], interim: '' }
          : { interim: message.text },
      );
      break;
    case 'notes/state':
      applyNotes(message);
      break;
    case 'export/state':
      useSession.setState({
        notion: { status: message.status, url: message.url, error: message.error },
      });
      break;
  }
}

/** Subscribes to session events and syncs the initial state. Returns an unsubscribe function. */
export function connectSession(): () => void {
  const listener = (message: Message) => handleMessage(message);
  browser.runtime.onMessage.addListener(listener);
  browser.runtime
    .sendMessage({ type: 'session/getState' })
    .then((snapshot: SessionSnapshot | undefined) => {
      if (!snapshot) return;
      useSession.setState({
        connection: snapshot.connection,
        hasSession: snapshot.hasSession,
        notion: snapshot.export,
      });
      if (snapshot.status !== 'idle') {
        useSession.setState({ startedAt: Date.now() }); // exact start time is not persisted yet (Phase 4)
      }
      applyStatus(snapshot.status, snapshot.error);
      applyNotes(snapshot.notes);
    })
    .catch(() => {});
  loadSettings()
    .then((s) =>
      useSession.setState({
        prices: { inputPerM: s.priceInputPerM, outputPerM: s.priceOutputPerM },
      }),
    )
    .catch(() => {});
  return () => browser.runtime.onMessage.removeListener(listener);
}

export const sessionActions = {
  start: () => send({ type: 'session/start' }),
  stop: () => send({ type: 'session/stop' }),
  pause: () => send({ type: 'session/pause' }),
  resume: () => send({ type: 'session/resume' }),
};

export const notesActions = {
  edit: (id: string, text: string) => send({ type: 'notes/edit', id, text }),
  remove: (id: string) => send({ type: 'notes/delete', id }),
};

export const exportActions = {
  sync: () => send({ type: 'export/sync' }),
};
