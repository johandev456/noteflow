import { describe, expect, it } from 'vitest';
import { settingsSchema } from './settings';

describe('settingsSchema', () => {
  it('fills defaults for empty input', () => {
    expect(settingsSchema.parse({})).toMatchObject({
      deepgramApiKey: '',
      sttLanguage: 'multi',
      llmModel: 'qwen3.8-flash',
      llmBaseUrl: 'https://ap-southeast-1.maas.qwencloudapi.com/compatible-mode/v1',
      notesLanguage: 'auto',
      triggerWords: 120,
      triggerSeconds: 45,
      priceInputPerM: 0.15,
      priceOutputPerM: 0.47,
    });
  });
});
