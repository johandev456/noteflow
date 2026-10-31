import { useEffect, useState } from 'react';
import { estimateCost, formatTokens } from '../../core/llm/usage';
import { hasContent } from '../../core/notes/types';
import { HistoryView } from './HistoryView';
import { NotesView } from './NotesView';
import { TEMPLATE_IDS, TEMPLATES, type TemplateId } from '../../core/llm/templates';
import { connectSession, exportActions, sessionActions, setTemplate, useSession } from './store';

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
      {formatElapsed(startedAt ? Math.max(0, now - startedAt) : 0)}
    </span>
  );
}

function UsageLine() {
  const usage = useSession((s) => s.usage);
  const prices = useSession((s) => s.prices);
  const busy = useSession((s) => s.notesBusy);
  const cost = estimateCost(usage, prices);
  if (usage.calls === 0 && !busy) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-neutral-500">
      <span>
        {formatTokens(usage.inputTokens)} in · {formatTokens(usage.outputTokens)} out
        {cost !== null && ` · ~$${cost.toFixed(cost < 0.01 ? 4 : 3)}`}
      </span>
      {busy && <span className="animate-pulse">Updating notes…</span>}
    </div>
  );
}

function NotionLine() {
  const { currentId, exports, status, notes, finals } = useSession();
  const idle = status === 'idle' || status === 'error';
  const hasData = currentId !== null && (finals.length > 0 || hasContent(notes));
  const notion = (currentId && exports[currentId]) || { status: 'idle' as const };
  if (!hasData && notion.status === 'idle') return null;

  const syncing = notion.status === 'syncing';
  return (
    <div className="flex items-center gap-2 text-xs text-neutral-500">
      <span>Notion:</span>
      {syncing && <span className="animate-pulse">Syncing…</span>}
      {notion.status === 'done' &&
        (notion.url ? (
          <a href={notion.url} target="_blank" rel="noreferrer" className="text-blue-600 underline">
            Synced ↗
          </a>
        ) : (
          <span>Synced</span>
        ))}
      {notion.status === 'idle' && <span>Not synced</span>}
      {notion.status === 'error' && <span className="text-red-600">Failed</span>}
      <button
        onClick={() => exportActions.sync()}
        disabled={!idle || syncing || !hasData}
        className="ml-auto rounded border border-neutral-300 px-2 py-0.5 disabled:opacity-50 dark:border-neutral-600"
      >
        {notion.status === 'done' ? 'Sync again' : 'Sync now'}
      </button>
    </div>
  );
}

const CONNECTION_LABEL = {
  connecting: 'Connecting…',
  open: 'Connected',
  reconnecting: 'Reconnecting…',
  closed: 'Disconnected',
} as const;

type Tab = 'current' | 'history';

function Tabs({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  const item = (id: Tab, label: string) => (
    <button
      role="tab"
      aria-selected={tab === id}
      onClick={() => onChange(id)}
      className={`px-3 py-2 text-sm ${
        tab === id
          ? 'border-b-2 border-blue-600 font-medium'
          : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div role="tablist" className="flex border-b border-neutral-200 dark:border-neutral-700">
      {item('current', 'Current session')}
      {item('history', 'History')}
    </div>
  );
}

export function App() {
  const { status, connection, error, level, finals, interim, notesError, currentId, exports } =
    useSession();
  const notes = useSession((s) => s.notes);
  const notesBusy = useSession((s) => s.notesBusy);
  const template = useSession((s) => s.template);
  const [tab, setTab] = useState<Tab>('current');

  useEffect(() => connectSession(), []);

  const busy = status === 'starting' || status === 'stopping';
  const live = status === 'recording' || status === 'paused';
  const notionError = currentId ? exports[currentId] : undefined;

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
        <label className="flex items-center gap-2 text-xs text-neutral-500">
          Template
          <select
            value={template}
            disabled={live || busy}
            onChange={(e) => void setTemplate(e.target.value as TemplateId)}
            className="rounded border border-neutral-300 bg-white px-1 py-0.5 text-neutral-900 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
          >
            {TEMPLATE_IDS.map((id) => (
              <option key={id} value={id}>
                {TEMPLATES[id].label}
              </option>
            ))}
          </select>
        </label>
        <UsageLine />
        <NotionLine />
        {notionError?.status === 'error' && notionError.error && (
          <p className="rounded bg-red-100 p-2 text-xs text-red-900">
            {notionError.error}{' '}
            <button className="underline" onClick={() => browser.runtime.openOptionsPage()}>
              Open options
            </button>
          </p>
        )}
        {notesError && (
          <p className="rounded bg-amber-100 p-2 text-xs text-amber-900">
            Notes: {notesError}{' '}
            <button className="underline" onClick={() => browser.runtime.openOptionsPage()}>
              Open options
            </button>
          </p>
        )}
        {error && (
          <p className="rounded bg-red-100 p-2 text-xs text-red-900">
            {error}{' '}
            <button className="underline" onClick={() => browser.runtime.openOptionsPage()}>
              Open options
            </button>
          </p>
        )}
      </header>
      <Tabs tab={tab} onChange={setTab} />
      {tab === 'history' ? (
        <main className="flex-1 overflow-auto p-3">
          <HistoryView />
        </main>
      ) : (
        <>
          <main className="flex-1 overflow-auto p-3">
            <NotesView notes={notes} busy={notesBusy} />
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
        </>
      )}
    </div>
  );
}
