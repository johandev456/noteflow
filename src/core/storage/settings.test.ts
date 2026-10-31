import { describe, expect, it } from 'vitest';
import { settingsSchema } from './settings';

describe('settingsSchema', () => {
  it('fills defaults for empty input', () => {
    expect(settingsSchema.parse({})).toEqual({ deepgramApiKey: '', sttLanguage: 'multi' });
  });
});
