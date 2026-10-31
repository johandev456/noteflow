import { useEffect, useState } from 'react';
import { OpenAiCompatClient } from '../../core/llm/client';
import { LLM_PRESETS, type LlmPresetId } from '../../core/llm/presets';
import { describeNotionError, NotionClient } from '../../core/notion/client';
import { buildProperties, parseNotionId, resolveDestination } from '../../core/notion/exporter';
import {
  loadSettings,
  saveSettings,
  settingsSchema,
  type Settings,
} from '../../core/storage/settings';

const inputClass =
  'mt-1 w-full rounded border border-neutral-300 bg-white p-2 text-neutral-900 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      {label}
      {children}
    </label>
  );
}

function presetOf(s: Settings): LlmPresetId {
  return s.llmBaseUrl === LLM_PRESETS.qwen.baseUrl ? 'qwen' : 'custom';
}

/** Custom endpoints need the user's explicit grant for that origin (must run inside a click). */
async function ensureHostPermission(baseUrl: string): Promise<boolean> {
  let origin: string;
  try {
    origin = `${new URL(baseUrl).origin}/*`;
  } catch {
    return false;
  }
  const origins = [origin];
  if (await browser.permissions.contains({ origins })) return true;
  return browser.permissions.request({ origins });
}

export function Options() {
  const [s, setS] = useState<Settings>(() => settingsSchema.parse({}));
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadSettings().then(setS);
  }, []);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setS((prev) => ({ ...prev, [key]: value }));

  function flash(text: string) {
    setMessage(text);
    setTimeout(() => setMessage(''), 8000);
  }

  function onPreset(id: LlmPresetId) {
    const preset = LLM_PRESETS[id];
    setS((prev) => ({
      ...prev,
      llmBaseUrl: preset.baseUrl || prev.llmBaseUrl,
      llmModel: preset.model || prev.llmModel,
    }));
  }

  async function onSave() {
    const cleaned: Settings = {
      ...s,
      deepgramApiKey: s.deepgramApiKey.trim(),
      llmApiKey: s.llmApiKey.trim(),
      llmBaseUrl: s.llmBaseUrl.trim(),
      llmModel: s.llmModel.trim(),
      notionToken: s.notionToken.trim(),
      notionDestination: s.notionDestination.trim(),
    };
    if (cleaned.llmBaseUrl && !(await ensureHostPermission(cleaned.llmBaseUrl))) {
      flash('Permission for the LLM endpoint was not granted, or the URL is invalid.');
      return;
    }
    await saveSettings(cleaned);
    setS(cleaned);
    flash('Saved');
  }

  async function onTestLlm() {
    if (!s.llmApiKey.trim()) return flash('Enter the LLM API key first.');
    if (!(await ensureHostPermission(s.llmBaseUrl.trim()))) {
      return flash('Permission for the LLM endpoint was not granted, or the URL is invalid.');
    }
    flash('Testing…');
    try {
      const client = new OpenAiCompatClient({
        baseUrl: s.llmBaseUrl.trim(),
        apiKey: s.llmApiKey.trim(),
        model: s.llmModel.trim(),
      });
      const res = await client.complete([
        { role: 'user', content: 'Reply with the JSON object {"ok":true}.' },
      ]);
      flash(res.content ? 'LLM connection works.' : 'The LLM answered with an empty reply.');
    } catch (err) {
      const status = (err as { status?: number }).status;
      flash(
        status === 401 || status === 403
          ? 'The LLM rejected the API key.'
          : `LLM test failed${status ? ` (${status})` : ''}: check URL, model and balance.`,
      );
    }
  }

  async function onTestNotion() {
    const id = parseNotionId(s.notionDestination);
    if (!s.notionToken.trim()) return flash('Enter the Notion token first.');
    if (!id) return flash('The destination must be a Notion URL or id.');
    flash('Testing Notion…');
    try {
      const api = new NotionClient({ token: s.notionToken.trim() });
      const me = await api.getMe();
      const dest = await resolveDestination(api, { type: s.notionDestinationType, id });
      let found = ' Page found.';
      if (dest.kind === 'data_source') {
        const { properties } = buildProperties(dest, {
          title: '',
          startedAt: 0,
          durationMs: 0,
          url: 'x',
          tags: ['x'],
        });
        const filled = Object.keys(properties).filter((k) => k !== dest.titleProperty);
        found = ` Database "${dest.name}" found; properties filled: ${filled.join(', ') || 'title only'}.`;
      }
      flash(`Connected${me.name ? ` as ${me.name}` : ''}.${found}`);
    } catch (err) {
      flash(describeNotionError(err));
    }
  }

  const num = (v: string) => (v === '' ? 0 : Number(v));

  return (
    <div className="mx-auto max-w-xl space-y-4 p-6 text-neutral-900 dark:text-neutral-100">
      <h1 className="text-xl font-semibold">NoteFlow settings</h1>
      <p className="rounded bg-amber-100 p-3 text-sm text-amber-900">
        Transcribed text is sent to the providers you configure. Providers such as Qwen, DeepSeek
        and Kimi operate outside the US. Do not use with confidential meetings.
      </p>

      <h2 className="pt-2 font-semibold">Transcription</h2>
      <Field label="Deepgram API key">
        <input
          type="password"
          value={s.deepgramApiKey}
          onChange={(e) => update('deepgramApiKey', e.target.value)}
          className={inputClass}
        />
      </Field>

      <h2 className="pt-2 font-semibold">Notes (LLM)</h2>
      <Field label="Provider preset">
        <select
          value={presetOf(s)}
          onChange={(e) => onPreset(e.target.value as LlmPresetId)}
          className={inputClass}
        >
          {Object.entries(LLM_PRESETS).map(([id, p]) => (
            <option key={id} value={id}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Base URL">
        <input
          value={s.llmBaseUrl}
          onChange={(e) => update('llmBaseUrl', e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Model">
        <input
          value={s.llmModel}
          onChange={(e) => update('llmModel', e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="LLM API key">
        <input
          type="password"
          value={s.llmApiKey}
          onChange={(e) => update('llmApiKey', e.target.value)}
          className={inputClass}
        />
      </Field>
      <p className="text-xs text-neutral-500">
        For Qwen, create the key in the same region as the endpoint (Singapore for the international
        URL), or requests fail with 401.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Input price (USD per 1M tokens)">
          <input
            type="number"
            min={0}
            step="any"
            value={s.priceInputPerM}
            onChange={(e) => update('priceInputPerM', num(e.target.value))}
            className={inputClass}
          />
        </Field>
        <Field label="Output price (USD per 1M tokens)">
          <input
            type="number"
            min={0}
            step="any"
            value={s.priceOutputPerM}
            onChange={(e) => update('priceOutputPerM', num(e.target.value))}
            className={inputClass}
          />
        </Field>
      </div>
      <p className="text-xs text-neutral-500">Leave prices at 0 to show token counts only.</p>

      <Field label="Notes language">
        <select
          value={s.notesLanguage}
          onChange={(e) => update('notesLanguage', e.target.value as Settings['notesLanguage'])}
          className={inputClass}
        >
          <option value="auto">Auto (dominant language of the audio)</option>
          <option value="es">Spanish</option>
          <option value="en">English</option>
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Update after N new words">
          <input
            type="number"
            min={10}
            value={s.triggerWords}
            onChange={(e) => update('triggerWords', Math.max(10, Math.round(num(e.target.value))))}
            className={inputClass}
          />
        </Field>
        <Field label="...or after N seconds">
          <input
            type="number"
            min={5}
            value={s.triggerSeconds}
            onChange={(e) => update('triggerSeconds', Math.max(5, Math.round(num(e.target.value))))}
            className={inputClass}
          />
        </Field>
      </div>

      <h2 className="pt-2 font-semibold">Notion</h2>
      <Field label="Integration token">
        <input
          type="password"
          value={s.notionToken}
          onChange={(e) => update('notionToken', e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Destination type">
        <select
          value={s.notionDestinationType}
          onChange={(e) =>
            update('notionDestinationType', e.target.value as Settings['notionDestinationType'])
          }
          className={inputClass}
        >
          <option value="database">Database (one page per recording)</option>
          <option value="page">Parent page (sub-pages under it)</option>
        </select>
      </Field>
      <Field label="Destination URL or id">
        <input
          value={s.notionDestination}
          onChange={(e) => update('notionDestination', e.target.value)}
          placeholder="https://www.notion.so/..."
          className={inputClass}
        />
      </Field>
      <p className="text-xs text-neutral-500">
        Share the page or database with your integration first (⋯ → Connections). A database can
        have optional Date, URL, Duration (number or text) and Tags (multi-select) properties; they
        are filled when present.
      </p>
      <Field label="Tags (comma separated, optional)">
        <input
          value={s.notionTags}
          onChange={(e) => update('notionTags', e.target.value)}
          className={inputClass}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={s.notionAutoExport}
          onChange={(e) => update('notionAutoExport', e.target.checked)}
        />
        Export to Notion automatically when I stop recording
      </label>

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <button onClick={onSave} className="rounded bg-blue-600 px-4 py-2 text-sm text-white">
          Save
        </button>
        <button
          onClick={onTestLlm}
          className="rounded border border-neutral-300 px-4 py-2 text-sm dark:border-neutral-600"
        >
          Test LLM
        </button>
        <button
          onClick={onTestNotion}
          className="rounded border border-neutral-300 px-4 py-2 text-sm dark:border-neutral-600"
        >
          Test Notion
        </button>
        <span className="text-sm text-neutral-500" role="status">
          {message}
        </span>
      </div>
    </div>
  );
}
