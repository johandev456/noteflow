import { useEffect, useState } from 'react';
import { markdownFilename, sessionTitle, sessionToMarkdown } from '../../core/notes/markdown';
import { listSessions, type SessionRow } from '../../core/storage/sessions';
import type { Message } from '../../shared/messages';
import { NotesView } from './NotesView';
import { exportActions, useSession } from './store';

/** Loads the stored sessions and reloads whenever the background reports a change. */
function useSessions(): SessionRow[] | null {
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      listSessions()
        .then((r) => alive && setRows(r))
        .catch(console.error);
    load();
    const listener = (m: Message) => {
      if (m.type === 'history/changed') load();
    };
    browser.runtime.onMessage.addListener(listener);
    return () => {
      alive = false;
      browser.runtime.onMessage.removeListener(listener);
    };
  }, []);
  return rows;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatDuration(row: SessionRow): string {
  if (!row.endedAt) return '';
  return `${Math.max(1, Math.round((row.endedAt - row.startedAt) / 60_000))} min`;
}

function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Detail({ row, onBack }: { row: SessionRow; onBack: () => void }) {
  const exportState = useSession((s) => s.exports[row.id]);
  const live = row.status === 'recording';
  const syncing = exportState?.status === 'syncing';
  const url = exportState?.url ?? row.notionUrl;

  function onDelete() {
    if (!window.confirm(`Delete "${sessionTitle(row)}"? This cannot be undone.`)) return;
    exportActions.remove(row.id);
    onBack();
  }

  const button =
    'rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-neutral-600';
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="text-sm text-blue-600 underline">
        ← History
      </button>
      <div className="flex flex-wrap gap-2">
        <button
          className={button}
          disabled={live || syncing}
          onClick={() => exportActions.sync(row.id)}
        >
          {syncing ? 'Syncing…' : url ? 'Sync again to Notion' : 'Send to Notion'}
        </button>
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className={`${button} text-blue-600`}>
            Open in Notion ↗
          </a>
        )}
        <button
          className={button}
          onClick={() => download(markdownFilename(row), sessionToMarkdown(row))}
        >
          Export Markdown
        </button>
        <button className={`${button} text-red-600`} disabled={live} onClick={onDelete}>
          Delete
        </button>
      </div>
      {exportState?.status === 'error' && exportState.error && (
        <p className="rounded bg-red-100 p-2 text-xs text-red-900">{exportState.error}</p>
      )}
      <p className="text-xs text-neutral-500">
        {formatDate(row.startedAt)} {formatDuration(row) && `· ${formatDuration(row)}`}
        {row.tabUrl && (
          <>
            {' · '}
            <a href={row.tabUrl} target="_blank" rel="noreferrer" className="underline">
              source
            </a>
          </>
        )}
      </p>
      <NotesView notes={row.notes} readOnly />
      <details className="text-sm">
        <summary className="cursor-pointer">Transcript</summary>
        <p className="mt-2 whitespace-pre-wrap">{row.transcript.join(' ') || 'No transcript.'}</p>
      </details>
    </div>
  );
}

export function HistoryView() {
  const rows = useSessions();
  const exports = useSession((s) => s.exports);
  const [openId, setOpenId] = useState<string | null>(null);

  if (!rows) return <p className="text-sm text-neutral-500">Loading…</p>;
  const open = rows.find((r) => r.id === openId);
  if (open) return <Detail row={open} onBack={() => setOpenId(null)} />;
  if (!rows.length) {
    return <p className="text-sm text-neutral-500">No sessions yet. Record something first.</p>;
  }

  return (
    <ul className="divide-y divide-neutral-200 dark:divide-neutral-700">
      {rows.map((row) => {
        const synced = exports[row.id]?.status === 'done' || row.notionUrl;
        return (
          <li key={row.id}>
            <button
              onClick={() => setOpenId(row.id)}
              className="w-full py-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800"
            >
              <div className="text-sm font-medium">{sessionTitle(row)}</div>
              <div className="flex gap-2 text-xs text-neutral-500">
                <span>{formatDate(row.startedAt)}</span>
                {row.status === 'recording' ? (
                  <span className="text-red-600">Recording…</span>
                ) : (
                  <span>{formatDuration(row)}</span>
                )}
                {synced && <span className="ml-auto">Notion ✓</span>}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
