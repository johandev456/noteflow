import { opsResponseSchema, type Op } from '../notes/ops';

export type ParseResult = { ok: true; ops: Op[] } | { ok: false; error: string };

/** Extracts and validates the {"ops":[...]} object from a model reply (tolerates code fences and prose). */
export function parseOpsResponse(raw: string): ParseResult {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return { ok: false, error: 'No JSON object found in the reply.' };
  let json: unknown;
  try {
    json = JSON.parse(raw.slice(start, end + 1));
  } catch (err) {
    return {
      ok: false,
      error: `Invalid JSON: ${err instanceof Error ? err.message : 'parse error'}`,
    };
  }
  const parsed = opsResponseSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join('.') || 'root';
    return { ok: false, error: `Schema error at ${where}: ${issue?.message ?? 'invalid'}` };
  }
  return { ok: true, ops: parsed.data.ops };
}
