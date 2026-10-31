import { z } from 'zod';

// Models often emit `null` for absent optional fields, so those are nullish.
export const opSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set_title'), text: z.string() }),
  z.object({ op: z.literal('add_section'), heading: z.string(), id: z.string().nullish() }),
  z.object({
    op: z.literal('add_bullet'),
    sectionId: z.string(),
    text: z.string(),
    afterId: z.string().nullish(),
  }),
  z.object({ op: z.literal('update_bullet'), id: z.string(), text: z.string() }),
  z.object({ op: z.literal('remove_bullet'), id: z.string() }),
  z.object({ op: z.literal('add_decision'), text: z.string() }),
  z.object({
    op: z.literal('add_action'),
    text: z.string(),
    owner: z.string().nullish(),
    due: z.string().nullish(),
  }),
  z.object({ op: z.literal('add_question'), text: z.string() }),
  z.object({ op: z.literal('resolve_question'), id: z.string() }),
  // Used by the final pass only.
  z.object({ op: z.literal('set_tldr'), lines: z.array(z.string()) }),
  z.object({ op: z.literal('reorder_sections'), ids: z.array(z.string()) }),
]);

export type Op = z.infer<typeof opSchema>;

export const opsResponseSchema = z.object({ ops: z.array(opSchema) });
