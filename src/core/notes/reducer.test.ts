import { describe, expect, it } from 'vitest';
import type { Op } from './ops';
import { applyOps, compactNotes, deleteItem, editItem } from './reducer';
import { emptyNotes } from './types';

const seed = (ops: Op[]) => applyOps(emptyNotes(), ops);

describe('applyOps', () => {
  it('does not mutate the input state', () => {
    const before = emptyNotes();
    applyOps(before, [{ op: 'set_title', text: 'Hola' }]);
    expect(before).toEqual(emptyNotes());
  });

  it('is deterministic', () => {
    const ops: Op[] = [
      { op: 'add_section', heading: 'Intro' },
      { op: 'add_decision', text: 'Ship it' },
    ];
    expect(seed(ops)).toEqual(seed(ops));
  });

  it('lets later ops reference a section id chosen in the same batch', () => {
    const state = seed([
      { op: 'add_section', heading: 'Budget', id: 'new1' },
      { op: 'add_bullet', sectionId: 'new1', text: 'Q3 budget is 10k' },
    ]);
    expect(state.sections).toHaveLength(1);
    expect(state.sections[0]?.bullets.map((b) => b.text)).toEqual(['Q3 budget is 10k']);
  });

  it('merges a section with the same heading and keeps aliases working', () => {
    const state = seed([
      { op: 'add_section', heading: 'Budget' },
      { op: 'add_section', heading: ' budget ', id: 'x' },
      { op: 'add_bullet', sectionId: 'x', text: 'one' },
    ]);
    expect(state.sections).toHaveLength(1);
    expect(state.sections[0]?.bullets).toHaveLength(1);
  });

  it('skips duplicate bullets, decisions, actions and questions', () => {
    const state = seed([
      { op: 'add_section', heading: 'A', id: 's' },
      { op: 'add_bullet', sectionId: 's', text: 'Same thing' },
      { op: 'add_bullet', sectionId: 's', text: 'same   thing' },
      { op: 'add_decision', text: 'Go' },
      { op: 'add_decision', text: 'go' },
      { op: 'add_action', text: 'Email Ana', owner: null },
      { op: 'add_action', text: 'email ana' },
      { op: 'add_question', text: 'Why?' },
      { op: 'add_question', text: 'why?' },
    ]);
    expect(state.sections[0]?.bullets).toHaveLength(1);
    expect(state.decisions).toHaveLength(1);
    expect(state.actionItems).toHaveLength(1);
    expect(state.openQuestions).toHaveLength(1);
  });

  it('inserts after afterId', () => {
    const state = seed([
      { op: 'add_section', heading: 'A', id: 's' },
      { op: 'add_bullet', sectionId: 's', text: 'first' },
      { op: 'add_bullet', sectionId: 's', text: 'third' },
    ]);
    const first = state.sections[0]!.bullets[0]!.id;
    const next = applyOps(state, [
      { op: 'add_bullet', sectionId: 's', text: 'second', afterId: first },
    ]);
    expect(next.sections[0]?.bullets.map((b) => b.text)).toEqual(['first', 'second', 'third']);
  });

  it('ignores ops with unknown ids', () => {
    const state = seed([
      { op: 'add_bullet', sectionId: 'nope', text: 'x' },
      { op: 'update_bullet', id: 'nope', text: 'x' },
      { op: 'remove_bullet', id: 'nope' },
      { op: 'resolve_question', id: 'nope' },
    ]);
    expect(state).toEqual(emptyNotes());
  });

  it('updates, removes and resolves', () => {
    let state = seed([
      { op: 'add_section', heading: 'A', id: 's' },
      { op: 'add_bullet', sectionId: 's', text: 'old' },
      { op: 'add_question', text: 'Who?' },
    ]);
    const bulletId = state.sections[0]!.bullets[0]!.id;
    const questionId = state.openQuestions[0]!.id;
    state = applyOps(state, [
      { op: 'update_bullet', id: bulletId, text: 'new' },
      { op: 'resolve_question', id: questionId },
    ]);
    expect(state.sections[0]?.bullets[0]?.text).toBe('new');
    expect(state.openQuestions[0]?.resolved).toBe(true);
    state = applyOps(state, [{ op: 'remove_bullet', id: bulletId }]);
    expect(state.sections[0]?.bullets).toHaveLength(0);
  });

  it('never overwrites or removes user-edited bullets', () => {
    let state = seed([
      { op: 'add_section', heading: 'A', id: 's' },
      { op: 'add_bullet', sectionId: 's', text: 'model text' },
    ]);
    const id = state.sections[0]!.bullets[0]!.id;
    state = editItem(state, id, 'my text');
    state = applyOps(state, [
      { op: 'update_bullet', id, text: 'model again' },
      { op: 'remove_bullet', id },
    ]);
    expect(state.sections[0]?.bullets[0]).toMatchObject({ text: 'my text', userEdited: true });
  });

  it('sets the tl;dr and reorders sections, keeping unlisted ones', () => {
    const state = seed([
      { op: 'add_section', heading: 'A', id: 'a' },
      { op: 'add_section', heading: 'B', id: 'b' },
      { op: 'add_section', heading: 'C', id: 'c' },
      { op: 'set_tldr', lines: [' one ', '', 'two'] },
      { op: 'reorder_sections', ids: ['c', 'zzz', 'c', 'a'] },
    ]);
    expect(state.tldr).toEqual(['one', 'two']);
    expect(state.sections.map((s) => s.heading)).toEqual(['C', 'A', 'B']);
  });
});

describe('manual edits', () => {
  it('deletes any item by id', () => {
    let state = seed([
      { op: 'add_section', heading: 'A', id: 's' },
      { op: 'add_bullet', sectionId: 's', text: 'x' },
      { op: 'add_decision', text: 'd' },
    ]);
    state = deleteItem(state, state.sections[0]!.bullets[0]!.id);
    state = deleteItem(state, state.decisions[0]!.id);
    expect(state.sections[0]?.bullets).toHaveLength(0);
    expect(state.decisions).toHaveLength(0);
  });
});

describe('compactNotes', () => {
  it('marks locked items and omits resolved questions', () => {
    let state = seed([
      { op: 'add_section', heading: 'A', id: 's' },
      { op: 'add_bullet', sectionId: 's', text: 'x' },
      { op: 'add_question', text: 'done?' },
      { op: 'add_question', text: 'open?' },
    ]);
    state = editItem(state, state.sections[0]!.bullets[0]!.id, 'mine');
    state = applyOps(state, [{ op: 'resolve_question', id: state.openQuestions[0]!.id }]);
    const compact = JSON.parse(compactNotes(state));
    expect(compact.sections[0].bullets[0]).toMatchObject({ text: 'mine', locked: true });
    expect(compact.openQuestions.map((q: { text: string }) => q.text)).toEqual(['open?']);
    expect(compactNotes(state)).not.toContain('\n');
  });
});
