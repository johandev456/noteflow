import type { NotesState } from '../notes/types';
import { TEMPLATES, type TemplateId } from './templates';
import { compactNotes } from '../notes/reducer';

export type NotesLanguage = 'auto' | 'es' | 'en';

/** Stable across calls so providers can cache the prefix. Anything variable goes in the user message. */
export const SYSTEM_PROMPT = `You are a live note-taking engine. A conversation is being transcribed in real time and you maintain structured notes incrementally.

Each request contains:
- LANGUAGE: the language to write the notes in.
- TEMPLATE: the kind of session and what the notes should prioritise.
- CURRENT_NOTES: the notes so far, as compact JSON. Items with "locked": true were edited by the user: never update or remove them.
- CONTEXT: the last sentences already processed (for continuity only; do not take notes from it).
- NEW_TRANSCRIPT: new text to incorporate.

Reply with ONLY a JSON object: {"ops":[...]}. Never rewrite the whole document. Allowed operations:
{"op":"set_title","text":"..."}
{"op":"add_section","heading":"...","id":"<short temp id you choose, e.g. n1>"}
{"op":"add_bullet","sectionId":"<existing section id or the temp id from add_section in this reply>","text":"...","afterId":"<optional bullet id>"}
{"op":"update_bullet","id":"<bullet id>","text":"..."}
{"op":"remove_bullet","id":"<bullet id>"}
{"op":"add_decision","text":"..."}
{"op":"add_action","text":"...","owner":"<optional>","due":"<optional>"}
{"op":"add_question","text":"..."}
{"op":"resolve_question","id":"<question id>"}

Rules:
- Do not invent facts. Only use what NEW_TRANSCRIPT says.
- Ignore filler words, greetings and irrelevant chatter.
- Bullets are concise (one idea, under about 25 words).
- Merge into existing bullets with update_bullet instead of adding duplicates. Reuse existing sections when the topic fits.
- Use add_decision only for decisions that were actually made, add_action for tasks someone must do, add_question for questions left unanswered, and resolve_question when a listed question gets answered.
- Set a title once the topic is clear; update it only if it becomes clearly wrong.
- If nothing relevant was said, reply {"ops":[]}.`;

export const FINAL_SYSTEM_PROMPT = `You are finishing a set of live notes after the recording ended. You receive the notes as compact JSON (items with "locked": true were edited by the user: never update or remove them).

Reply with ONLY a JSON object: {"ops":[...]}. Allowed operations:
{"op":"set_title","text":"..."}  (a definitive, specific title)
{"op":"set_tldr","lines":["...","..."]}  (3 to 5 short lines summarising the whole session)
{"op":"reorder_sections","ids":["<section id>", ...]}  (a logical order for the sections)
{"op":"update_bullet","id":"...","text":"..."}, {"op":"remove_bullet","id":"..."}  (only to merge duplicates or fix clearly redundant bullets)

Do not invent facts. Always include set_title and set_tldr.`;

function languageInstruction(language: NotesLanguage): string {
  switch (language) {
    case 'es':
      return 'Write the notes in Spanish.';
    case 'en':
      return 'Write the notes in English.';
    default:
      return 'Write the notes in the dominant language of NEW_TRANSCRIPT.';
  }
}

export function buildUserMessage(args: {
  notes: NotesState;
  context: string;
  newText: string;
  language: NotesLanguage;
  template: TemplateId;
}): string {
  return [
    `LANGUAGE: ${languageInstruction(args.language)}`,
    `TEMPLATE: ${TEMPLATES[args.template].guidance}`,
    `CURRENT_NOTES: ${compactNotes(args.notes)}`,
    `CONTEXT: ${args.context || '(none)'}`,
    `NEW_TRANSCRIPT: ${args.newText}`,
  ].join('\n');
}

export function buildFinalMessage(
  notes: NotesState,
  language: NotesLanguage,
  template: TemplateId,
): string {
  return [
    `LANGUAGE: ${languageInstruction(language)}`,
    `TEMPLATE: ${TEMPLATES[template].guidance}`,
    `CURRENT_NOTES: ${compactNotes(notes)}`,
  ].join('\n');
}
