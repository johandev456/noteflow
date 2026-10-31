import { describe, expect, it } from 'vitest';
import { parseOpsResponse } from './parse';

describe('parseOpsResponse', () => {
  it('parses a plain reply', () => {
    const r = parseOpsResponse('{"ops":[{"op":"add_decision","text":"Go"}]}');
    expect(r).toEqual({ ok: true, ops: [{ op: 'add_decision', text: 'Go' }] });
  });

  it('tolerates code fences and surrounding prose', () => {
    const r = parseOpsResponse('Sure!\n```json\n{"ops":[]}\n```');
    expect(r).toEqual({ ok: true, ops: [] });
  });

  it('accepts null optional fields', () => {
    const r = parseOpsResponse('{"ops":[{"op":"add_action","text":"x","owner":null,"due":null}]}');
    expect(r.ok).toBe(true);
  });

  it('reports invalid JSON, unknown ops and missing fields', () => {
    expect(parseOpsResponse('no json here').ok).toBe(false);
    expect(parseOpsResponse('{"ops":[').ok).toBe(false);
    expect(parseOpsResponse('{"ops":[{"op":"explode"}]}').ok).toBe(false);
    const missing = parseOpsResponse('{"ops":[{"op":"add_bullet","text":"x"}]}');
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toContain('ops.0');
  });
});
