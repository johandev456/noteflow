import { z } from 'zod';

export const settingsSchema = z.object({
  deepgramApiKey: z.string().default(''),
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
