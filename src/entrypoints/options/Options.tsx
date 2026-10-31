import { useEffect, useState } from 'react';
import { OpenAiCompatClient } from '../../core/llm/client';
import { LLM_PRESETS, type LlmPresetId } from '../../core/llm/presets';
import { TEMPLATE_IDS, TEMPLATES } from '../../core/llm/templates';
import { describeNotionError, NotionClient } from '../../core/notion/client';
import { buildProperties, parseNotionId, resolveDestination } from '../../core/notion/exporter';
import {
  loadSettings,
  saveSettings,
  settingsSchema,
  type Settings,
} from '../../core/storage/settings';
import { checkDeepgramKey } from '../../core/stt/deepgram';

const inputClass =
  'mt-1 w-full rounded border border-neutral-300 bg-white p-2 text-neutral-900 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100';
const buttonClass =
  'rounded border border-neutral-300 px-4 py-2 text-sm disabled:opacity-50 dark:border-neutral-600';

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

interface CheckState {
  status: 'idle' | 'checking' | 'ok' | 'fail';
  message?: string;
}

/** Runs a check that returns a success message or throws an Error with the failure message. */
function useCheck() {
  const [state, setState] = useState<CheckState>({ status: 'idle' });
  const run = async (check: () => Promise<string>) => {
    setState({ status: 'checking' });
    try {
      setState({ status: 'ok', message: await check() });
    } catch (err) {
      setState({ status: 'fail', message: err instanceof Error ? err.message : 'Check failed.' });
    }
  };
  return [state, run] as const;
}

function Step({
  n,
  title,
  optional,
  check,
  onCheck,
  children,
}: {
  n: number;
  title: string;
  optional?: boolean;
  check: CheckState;
  onCheck: () => void;
  children: React.ReactNode;
}) {
  const badge =
    check.status === 'ok'
      ? 'bg-green-600 text-white'
      : check.status === 'fail'
        ? 'bg-red-600 text-white'
        : 'bg-neutral-300 text-neutral-800 dark:bg-neutral-600 dark:text-neutral-100';
  return (
    <section className="space-y-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-700">
      <h2 className="flex items-center gap-2 font-semibold">
        <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${badge}`}>
          {check.status === 'ok' ? '✓' : n}
        </span>
        {title}
        {optional && <span className="text-xs font-normal text-neutral-500">(optional)</span>}
      </h2>
      {children}
      <div className="flex items-center gap-3">
        <button onClick={onCheck} disabled={check.status === 'checking'} className={buttonClass}>
          {check.status === 'checking' ? 'Checking…' : 'Save & check'}
        </button>
        {check.message && (
          <span
            role="status"
            className={`text-sm ${check.status === 'fail' ? 'text-red-600' : 'text-green-600'}`}
          >
            {check.message}
          </span>
        )}
      </div>
    </section>
  );
}

export function Options() {
  const [s, setS] = useState<Settings>(() => settingsSchema.parse({}));
  const [message, setMessage] = useState('');
  const [deepgram, runDeepgram] = useCheck();
  const [llm, runLlm] = useCheck();
  const [notion, runNotion] = useCheck();

  useEffect(() => {
    loadSettings().then(setS);
  }, []);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setS((prev) => ({ ...prev, [key]: value }));

  function flash(text: string) {
    setMessage(text);
    setTimeout(() => setMessage(''), 6000);
  }

  function onPreset(id: LlmPresetId) {
    const preset = LLM_PRESETS[id];
    setS((prev) => ({
      ...prev,
      llmBaseUrl: preset.baseUrl || prev.llmBaseUrl,
      llmModel: preset.model || prev.llmModel,
    }));
  }

  function cleaned(): Settings {
    return {
      ...s,
      deepgramApiKey: s.deepgramApiKey.trim(),
      llmApiKey: s.llmApiKey.trim(),
      llmBaseUrl: s.llmBaseUrl.trim(),
      llmModel: s.llmModel.trim(),
      notionToken: s.notionToken.trim(),
      notionDestination: s.notionDestination.trim(),
    };
  }

  async function persist(): Promise<Settings> {
    const next = cleaned();
    await saveSettings(next);
    setS(next);
    return next;
  }

  async function onSave() {
    const next = cleaned();
    if (next.llmBaseUrl && !(await ensureHostPermission(next.llmBaseUrl))) {
      return flash('Permission for the LLM endpoint was not granted, or the URL is invalid.');
    }
    await persist();
    flash('Saved');
  }

  const checkDeepgram = () =>
    runDeepgram(async () => {
      const next = await persist();
      if (!next.deepgramApiKey) throw new Error('Enter the Deepgram API key.');
      const result = await checkDeepgramKey(next.deepgramApiKey);
      if (result.status === 'invalid') throw new Error('Deepgram rejected this key.');
      if (result.status === 'unknown')
        throw new Error(`Saved, but could not verify: ${result.message}`);
      return 'Key works.';
    });

  const checkLlm = () =>
    runLlm(async () => {
      const next = await persist();
      if (!next.llmApiKey) throw new Error('Enter the LLM API key.');
      if (!(await ensureHostPermission(next.llmBaseUrl))) {
        throw new Error('Permission for the LLM endpoint was not granted, or the URL is invalid.');
      }
      try {
        const client = new OpenAiCompatClient({
          baseUrl: next.llmBaseUrl,
          apiKey: next.llmApiKey,
          model: next.llmModel,
        });
        const res = await client.complete([
          { role: 'user', content: 'Reply with the JSON object {"ok":true}.' },
        ]);
        if (!res.content) throw new Error('The model answered with an empty reply.');
        return 'Connection works.';
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 401 || status === 403)
          throw new Error('The LLM rejected the API key.', { cause: err });
        if (err instanceof Error && !status) throw err;
        throw new Error(
          `Request failed${status ? ` (${status})` : ''}: check URL, model and balance.`,
          { cause: err },
        );
      }
    });

  const checkNotion = () =>
    runNotion(async () => {
      const next = await persist();
      const id = parseNotionId(next.notionDestination);
      if (!next.notionToken) throw new Error('Enter the Notion token.');
      if (!id) throw new Error('The destination must be a Notion URL or id.');
      try {
        const api = new NotionClient({ token: next.notionToken });
        const me = await api.getMe();
        const dest = await resolveDestination(api, { type: next.notionDestinationType, id });
        let found = 'Page found.';
        if (dest.kind === 'data_source') {
          const { properties } = buildProperties(dest, {
            title: '',
            startedAt: 0,
            durationMs: 0,
            url: 'x',
            tags: ['x'],
          });
          const filled = Object.keys(properties).filter((k) => k !== dest.titleProperty);
          found = `Database "${dest.name}" found; properties filled: ${filled.join(', ') || 'title only'}.`;
        }
        return `Connected${me.name ? ` as ${me.name}` : ''}. ${found}`;
      } catch (err) {
        throw new Error(describeNotionError(err), { cause: err });
      }
    });

  const done = [deepgram, llm, notion].filter((c) => c.status === 'ok').length;
  const num = (v: string) => (v === '' ? 0 : Number(v));

  return (
    <div className="mx-auto max-w-xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">NoteFlow setup</h1>
      <p className="text-sm text-neutral-500">
        {done} of 3 steps verified. Each step saves what you typed and checks it against the
        service. Notion is optional: without it, sessions stay in the History tab and can be
        exported as Markdown.
      </p>
      <p className="rounded bg-amber-100 p-3 text-sm text-amber-900">
        Transcribed text is sent to the providers you configure. Providers such as Qwen, DeepSeek
        and Kimi operate outside the US. Do not use with confidential meetings.
      </p>

      <Step n={1} title="Transcription (Deepgram)" check={deepgram} onCheck={checkDeepgram}>
        <Field label="Deepgram API key">
          <input
            type="password"
            value={s.deepgramApiKey}
            onChange={(e) => update('deepgramApiKey', e.target.value)}
            className={inputClass}
          />
        </Field>
      </Step>

      <Step n={2} title="Notes (LLM)" check={llm} onCheck={checkLlm}>
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
          For Qwen, create the key in the same region as the endpoint (Singapore for the
          international URL), or requests fail with 401.
        </p>
      </Step>

      <Step n={3} title="Notion" optional check={notion} onCheck={checkNotion}>
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
          have optional Date, URL, Duration (number or text) and Tags (multi-select) properties;
          they are filled when present.
        </p>
      </Step>

      <h2 className="pt-2 font-semibold">Preferences</h2>
      <Field label="Default note template">
        <select
          value={s.noteTemplate}
          onChange={(e) => update('noteTemplate', e.target.value as Settings['noteTemplate'])}
          className={inputClass}
        >
          {TEMPLATE_IDS.map((id) => (
            <option key={id} value={id}>
              {TEMPLATES[id].label}
            </option>
          ))}
        </select>
      </Field>
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
      <Field label="Notion tags (comma separated, optional)">
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

      <h2 className="pt-2 font-semibold">Shortcuts</h2>
      <p className="text-sm text-neutral-500">
        Alt+Shift+N starts or stops recording; Alt+Shift+P pauses or resumes. Pressing a shortcut
        also grants NoteFlow access to the current tab.
      </p>
      <button
        onClick={() => browser.tabs.create({ url: 'chrome://extensions/shortcuts' })}
        className={buttonClass}
      >
        Change shortcuts
      </button>

      <div className="flex items-center gap-3 pt-2">
        <button onClick={onSave} className="rounded bg-blue-600 px-4 py-2 text-sm text-white">
          Save
        </button>
        <span className="text-sm text-neutral-500" role="status">
          {message}
        </span>
      </div>
    </div>
  );
}
