import type { Op } from './ops';
import type { NotesItem, NotesState } from './types';

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

function allIds(d: NotesState): Set<string> {
  const ids = new Set<string>();
  for (const s of d.sections) {
    ids.add(s.id);
    s.bullets.forEach((b) => ids.add(b.id));
  }
  [...d.decisions, ...d.actionItems, ...d.openQuestions].forEach((i) => ids.add(i.id));
  return ids;
}

function freshId(d: NotesState, prefix: string): string {
  const used = allIds(d);
  let id = `${prefix}${d.nextId++}`;
  while (used.has(id)) id = `${prefix}${d.nextId++}`;
  return id;
}

function findBullet(d: NotesState, id: string) {
  for (const section of d.sections) {
    const index = section.bullets.findIndex((b) => b.id === id);
    if (index >= 0) return { section, index };
  }
  return null;
}

function addUnique<T extends NotesItem>(list: T[], item: T): void {
  if (list.some((i) => norm(i.text) === norm(item.text))) return;
  list.push(item);
}

function applyOp(d: NotesState, op: Op, alias: Map<string, string>): void {
  switch (op.op) {
    case 'set_title': {
      const text = op.text.trim();
      if (text) d.title = text;
      return;
    }
    case 'add_section': {
      const heading = op.heading.trim();
      if (!heading) return;
      const existing = d.sections.find((s) => norm(s.heading) === norm(heading));
      if (existing) {
        if (op.id) alias.set(op.id, existing.id);
        return;
      }
      const wanted = op.id?.trim();
      const id = wanted && !allIds(d).has(wanted) ? wanted : freshId(d, 's');
      d.sections.push({ id, heading, bullets: [] });
      if (op.id) alias.set(op.id, id);
      return;
    }
    case 'add_bullet': {
      const text = op.text.trim();
      const section = d.sections.find((s) => s.id === (alias.get(op.sectionId) ?? op.sectionId));
      if (!text || !section) return;
      if (section.bullets.some((b) => norm(b.text) === norm(text))) return;
      const bullet = { id: freshId(d, 'b'), text };
      const after = op.afterId ? section.bullets.findIndex((b) => b.id === op.afterId) : -1;
      section.bullets.splice(after >= 0 ? after + 1 : section.bullets.length, 0, bullet);
      return;
    }
    case 'update_bullet': {
      const found = findBullet(d, op.id);
      const text = op.text.trim();
      const bullet = found?.section.bullets[found.index];
      if (!bullet || bullet.userEdited || !text) return;
      bullet.text = text;
      return;
    }
    case 'remove_bullet': {
      const found = findBullet(d, op.id);
      if (!found || found.section.bullets[found.index]?.userEdited) return;
      found.section.bullets.splice(found.index, 1);
      return;
    }
    case 'add_decision': {
      const text = op.text.trim();
      if (text) addUnique(d.decisions, { id: freshId(d, 'd'), text });
      return;
    }
    case 'add_action': {
      const text = op.text.trim();
      if (!text) return;
      addUnique(d.actionItems, {
        id: freshId(d, 'a'),
        text,
        ...(op.owner ? { owner: op.owner } : {}),
        ...(op.due ? { due: op.due } : {}),
      });
      return;
    }
    case 'add_question': {
      const text = op.text.trim();
      if (text) addUnique(d.openQuestions, { id: freshId(d, 'q'), text });
      return;
    }
    case 'resolve_question': {
      const q = d.openQuestions.find((i) => i.id === op.id);
      if (q) q.resolved = true;
      return;
    }
    case 'set_tldr': {
      d.tldr = op.lines.map((l) => l.trim()).filter(Boolean);
      return;
    }
    case 'reorder_sections': {
      const byId = new Map(d.sections.map((s) => [s.id, s]));
      const ordered = op.ids.flatMap((id) => {
        const section = byId.get(id);
        byId.delete(id); // ignore unknown and repeated ids
        return section ? [section] : [];
      });
      d.sections = [...ordered, ...d.sections.filter((s) => byId.has(s.id))];
      return;
    }
  }
}

/** Pure and deterministic. Ops that reference unknown ids or userEdited items are ignored. */
export function applyOps(state: NotesState, ops: Op[]): NotesState {
  const draft = structuredClone(state);
  const alias = new Map<string, string>();
  for (const op of ops) applyOp(draft, op, alias);
  return draft;
}

function findItem(d: NotesState, id: string): NotesItem | undefined {
  return (
    d.sections.flatMap((s) => s.bullets).find((b) => b.id === id) ??
    [...d.decisions, ...d.actionItems, ...d.openQuestions].find((i) => i.id === id)
  );
}

/** Manual edit from the UI; marks the item so the model cannot overwrite it. */
export function editItem(state: NotesState, id: string, text: string): NotesState {
  const draft = structuredClone(state);
  const item = findItem(draft, id);
  const trimmed = text.trim();
  if (item && trimmed) {
    item.text = trimmed;
    item.userEdited = true;
  }
  return draft;
}

export function deleteItem(state: NotesState, id: string): NotesState {
  const draft = structuredClone(state);
  for (const s of draft.sections) s.bullets = s.bullets.filter((b) => b.id !== id);
  draft.decisions = draft.decisions.filter((i) => i.id !== id);
  draft.actionItems = draft.actionItems.filter((i) => i.id !== id);
  draft.openQuestions = draft.openQuestions.filter((i) => i.id !== id);
  return draft;
}

/** Compact JSON sent to the model: no flags beyond `locked`, resolved questions omitted. */
export function compactNotes(state: NotesState): string {
  const lock = (i: NotesItem) => ({
    id: i.id,
    text: i.text,
    ...(i.userEdited ? { locked: true } : {}),
  });
  return JSON.stringify({
    title: state.title,
    sections: state.sections.map((s) => ({
      id: s.id,
      heading: s.heading,
      bullets: s.bullets.map(lock),
    })),
    decisions: state.decisions.map(lock),
    actionItems: state.actionItems.map((a) => ({
      ...lock(a),
      ...(a.owner ? { owner: a.owner } : {}),
      ...(a.due ? { due: a.due } : {}),
    })),
    openQuestions: state.openQuestions.filter((q) => !q.resolved).map(lock),
  });
}
