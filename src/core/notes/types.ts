import { z } from 'zod';

const itemSchema = z.object({
  id: z.string(),
  text: z.string(),
  /** Set when the user edited the item; the model must not overwrite it. */
  userEdited: z.boolean().optional(),
});

const actionItemSchema = itemSchema.extend({
  owner: z.string().optional(),
  due: z.string().optional(),
});

const questionSchema = itemSchema.extend({
  resolved: z.boolean().optional(),
});

const sectionSchema = z.object({
  id: z.string(),
  heading: z.string(),
  bullets: z.array(itemSchema),
});

export const notesStateSchema = z.object({
  title: z.string(),
  tldr: z.array(z.string()),
  sections: z.array(sectionSchema),
  decisions: z.array(itemSchema),
  actionItems: z.array(actionItemSchema),
  openQuestions: z.array(questionSchema),
  /** Counter used to mint ids deterministically. */
  nextId: z.number().int(),
});

export type NotesItem = z.infer<typeof itemSchema>;
export type ActionItem = z.infer<typeof actionItemSchema>;
export type OpenQuestion = z.infer<typeof questionSchema>;
export type NotesSection = z.infer<typeof sectionSchema>;
export type NotesState = z.infer<typeof notesStateSchema>;

export function emptyNotes(): NotesState {
  return {
    title: '',
    tldr: [],
    sections: [],
    decisions: [],
    actionItems: [],
    openQuestions: [],
    nextId: 1,
  };
}

export function hasContent(notes: NotesState): boolean {
  return (
    notes.sections.some((s) => s.bullets.length > 0) ||
    notes.decisions.length > 0 ||
    notes.actionItems.length > 0 ||
    notes.openQuestions.length > 0
  );
}
