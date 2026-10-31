export function App() {
  return (
    <div className="flex h-screen flex-col bg-white text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100">
      <header className="flex items-center justify-between border-b border-neutral-200 p-3 dark:border-neutral-700">
        <span className="font-semibold">NoteFlow</span>
        <button
          disabled
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
        >
          Start
        </button>
      </header>
      <main className="flex-1 overflow-auto p-3 text-sm text-neutral-500">
        Live notes will appear here.
      </main>
      <details className="border-t border-neutral-200 p-3 text-sm dark:border-neutral-700">
        <summary className="cursor-pointer">Transcript</summary>
        <p className="mt-2 text-neutral-500">Nothing yet.</p>
      </details>
    </div>
  );
}
