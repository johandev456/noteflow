import { useEffect, useState } from 'react';
import { loadSettings, saveSettings } from '../../core/storage/settings';

export function Options() {
  const [deepgramApiKey, setDeepgramApiKey] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadSettings().then((s) => setDeepgramApiKey(s.deepgramApiKey));
  }, []);

  async function onSave() {
    await saveSettings({ deepgramApiKey });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 p-6 text-neutral-900 dark:text-neutral-100">
      <h1 className="text-xl font-semibold">NoteFlow settings</h1>
      <p className="rounded bg-amber-100 p-3 text-sm text-amber-900">
        Transcribed text is sent to the providers you configure. Do not use with confidential
        meetings.
      </p>
      <label className="block text-sm">
        Deepgram API key
        <input
          type="password"
          value={deepgramApiKey}
          onChange={(e) => setDeepgramApiKey(e.target.value)}
          className="mt-1 w-full rounded border border-neutral-300 bg-transparent p-2"
        />
      </label>
      <button onClick={onSave} className="rounded bg-blue-600 px-4 py-2 text-sm text-white">
        {saved ? 'Saved' : 'Save'}
      </button>
    </div>
  );
}
