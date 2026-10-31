import { z } from 'zod';
import { LLM_PRESETS } from '../llm/presets';

export const settingsSchema = z.object({
  deepgramApiKey: z.string().default(''),
  sttLanguage: z.string().default('multi'),

  llmBaseUrl: z.string().default(LLM_PRESETS.qwen.baseUrl),
  llmModel: z.string().default(LLM_PRESETS.qwen.model),
  llmApiKey: z.string().default(''),
  /** Price per million tokens; 0 means unknown, so the UI shows tokens only. */
  priceInputPerM: z.number().min(0).default(0.15),
  priceOutputPerM: z.number().min(0).default(0.47),

  notesLanguage: z.enum(['auto', 'es', 'en']).default('auto'),
  triggerWords: z.number().int().min(10).default(120),
  triggerSeconds: z.number().int().min(5).default(45),

  notionToken: z.string().default(''),
  notionDestinationType: z.enum(['page', 'database']).default('database'),
  /** A Notion URL or id; parsed when exporting. */
  notionDestination: z.string().default(''),
  notionAutoExport: z.boolean().default(true),
  /** Comma-separated; applied only if the database has a multi-select "Tags" property. */
  notionTags: z.string().default(''),
});

export type Settings = z.infer<typeof settingsSchema>;

const KEY = 'settings';

export async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(KEY);
  return settingsSchema.parse(stored[KEY] ?? {});
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [KEY]: settingsSchema.parse(settings) });
}

export function isNotionConfigured(s: Settings): boolean {
  return Boolean(s.notionToken && s.notionDestination);
}
