import { useEffect, useState } from 'react';
import { connectSession, sessionActions, useSession } from './store';

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function Timer() {
  const startedAt = useSession((s) => s.startedAt);
  const status = useSession((s) => s.status);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (status !== 'recording') return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [status]);

  return (
    <span className="tabular-nums text-sm text-neutral-500">
      {formatElapsed(startedAt ? now - startedAt : 0)}
    </span>
  );
}

const CONNECTION_LABEL = {
  connecting: 'Connecting…',
  open: 'Connected',
  reconnecting: 'Reconnecting…',
  closed: 'Disconnected',
} as const;

export function App() {
  const { status, connection, error, level, finals, interim } = useSession();

  useEffect(() => connectSession(), []);

  const busy = status === 'starting' || status === 'stopping';
  const live = status === 'recording' || status === 'paused';

  return (
    <div className="flex h-screen flex-col bg-white text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100">
      <header className="space-y-2 border-b border-neutral-200 p-3 dark:border-neutral-700">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold">NoteFlow</span>
          <div className="flex items-center gap-2">
            <Timer />
            {live && (
              <button
                onClick={status === 'paused' ? sessionActions.resume : sessionActions.pause}
                className="rounded border border-neutral-300 px-3 py-1 text-sm dark:border-neutral-600"
              >
                {status === 'paused' ? 'Resume' : 'Pause'}
              </button>
            )}
            {live ? (
              <button
                onClick={sessionActions.stop}
                className="rounded bg-red-600 px-3 py-1 text-sm text-white"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={sessionActions.start}
                disabled={busy}
                className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
              >
                {busy ? '…' : 'Start'}
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <span
            className={`h-2 w-2 rounded-full ${connection === 'open' ? 'bg-green-500' : 'bg-neutral-400'}`}
          />
          <span>{CONNECTION_LABEL[connection]}</span>
          <div className="ml-auto h-1.5 w-24 overflow-hidden rounded bg-neutral-200 dark:bg-neutral-700">
            <div
              className="h-full bg-green-500 transition-[width] duration-100"
              style={{ width: `${Math.round(level * 100)}%` }}
            />
          </div>
        </div>
        {error && (
          <p className="rounded bg-red-100 p-2 text-xs text-red-900">
            {error}{' '}
            <button className="underline" onClick={() => browser.runtime.openOptionsPage()}>
              Open options
            </button>
          </p>
        )}
      </header>
      <main className="flex-1 overflow-auto p-3 text-sm text-neutral-500">
        Live notes will appear here.
      </main>
      <details
        open
        className="max-h-1/2 overflow-auto border-t border-neutral-200 p-3 text-sm dark:border-neutral-700"
      >
        <summary className="cursor-pointer">Transcript</summary>
        <p className="mt-2 whitespace-pre-wrap">
          {finals.join(' ')}
          {interim && <span className="text-neutral-400"> {interim}</span>}
          {!finals.length && !interim && <span className="text-neutral-500">Nothing yet.</span>}
        </p>
      </details>
    </div>
  );
}
