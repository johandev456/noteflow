import { describe, expect, it } from 'vitest';
import { emptyNotes } from '../notes/types';
import { buildFinalMessage, buildUserMessage, SYSTEM_PROMPT } from './prompts';
import { TEMPLATE_IDS, TEMPLATES } from './templates';

describe('templates in prompts', () => {
  const base = { notes: emptyNotes(), context: '', newText: 'hello', language: 'auto' as const };

  it('adds the template guidance to the user message only', () => {
    for (const id of TEMPLATE_IDS) {
      const message = buildUserMessage({ ...base, template: id });
      expect(message).toContain(`TEMPLATE: ${TEMPLATES[id].guidance}`);
      expect(SYSTEM_PROMPT).not.toContain(TEMPLATES[id].guidance);
    }
  });

  it('keeps the system prompt identical across templates (prefix caching)', () => {
    expect(SYSTEM_PROMPT).toContain('TEMPLATE:');
  });

  it('differs between templates and reaches the final pass too', () => {
    const a = buildUserMessage({ ...base, template: 'meeting' });
    const b = buildUserMessage({ ...base, template: 'class' });
    expect(a).not.toBe(b);
    expect(buildFinalMessage(emptyNotes(), 'es', 'podcast')).toContain(TEMPLATES.podcast.guidance);
  });
});
