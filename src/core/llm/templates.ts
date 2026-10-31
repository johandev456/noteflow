export const TEMPLATE_IDS = ['meeting', 'class', 'podcast'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export interface NoteTemplate {
  label: string;
  /** Sent in the user message (not the system prompt) so the system prompt stays cacheable. */
  guidance: string;
}

export const TEMPLATES: Record<TemplateId, NoteTemplate> = {
  meeting: {
    label: 'Meeting',
    guidance:
      'A meeting. Prioritise decisions, action items (with owner and due date when stated), open questions, and the key discussion points grouped by topic.',
  },
  class: {
    label: 'Class',
    guidance:
      'A class or lecture. Organise by concept: sections are topics, bullets are definitions, explanations, examples and formulas. Use add_question for points the speaker postpones. Use decisions rarely, and action items only for homework or deadlines.',
  },
  podcast: {
    label: 'Podcast',
    guidance:
      'A podcast or interview. Sections are the themes discussed; bullets capture the main claims, short notable quotes, recommendations, and mentions of people, books or tools. Leave decisions and action items out unless they are explicit.',
  },
};
