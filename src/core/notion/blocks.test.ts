import { describe, expect, it } from 'vitest';
import { applyOps } from '../notes/reducer';
import { emptyNotes } from '../notes/types';
import {
  chunk,
  detectLanguage,
  LABELS,
  notesToBlocks,
  richText,
  splitText,
  transcriptBlocks,
  type NotionBlock,
} from './blocks';

const types = (blocks: NotionBlock[]) => blocks.map((b) => b.type);
const textOf = (b: NotionBlock) =>
  (b[b.type] as { rich_text: Array<{ text: { content: string } }> }).rich_text
    .map((r) => r.text.content)
    .join('');

describe('splitText / richText', () => {
  it('keeps every chunk within 2000 characters and loses nothing', () => {
    const text = 'word '.repeat(1500); // 7500 chars
    const chunks = splitText(text);
    expect(chunks.every((c) => c.length <= 2000)).toBe(true);
    expect(chunks.join('')).toBe(text);
    expect(richText(text).every((r) => r.text.content.length <= 2000)).toBe(true);
  });

  it('splits text without spaces and never breaks a surrogate pair', () => {
    const emoji = '😀'.repeat(1500); // 3000 UTF-16 units, no whitespace
    const chunks = splitText(emoji);
    expect(chunks.join('')).toBe(emoji);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(2000);
      const last = c.charCodeAt(c.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    }
  });

  it('caps a rich_text array at 100 items', () => {
    expect(richText('x'.repeat(2000 * 150))).toHaveLength(100);
  });
});

describe('notesToBlocks', () => {
  const notes = applyOps(emptyNotes(), [
    { op: 'set_tldr', lines: ['One', 'Two'] },
    { op: 'add_section', heading: 'Budget', id: 's' },
    { op: 'add_bullet', sectionId: 's', text: 'Q3 is 10k' },
    { op: 'add_section', heading: 'Empty', id: 'e' },
    { op: 'add_decision', text: 'Ship Friday' },
    { op: 'add_action', text: 'Email Ana', owner: 'Luis', due: 'Mon' },
    { op: 'add_question', text: 'Who pays?' },
    { op: 'add_question', text: 'Solved?' },
  ]);

  it('follows the order TL;DR, sections, decisions, tasks, questions', () => {
    const resolved = applyOps(notes, [{ op: 'resolve_question', id: notes.openQuestions[1]!.id }]);
    const blocks = notesToBlocks(resolved, LABELS.en);
    expect(types(blocks)).toEqual([
      'heading_2', // TL;DR
      'bulleted_list_item',
      'bulleted_list_item',
      'heading_2', // Budget (the empty section is skipped)
      'bulleted_list_item',
      'heading_2', // Decisions
      'bulleted_list_item',
      'heading_2', // Action items
      'to_do',
      'heading_2', // Open questions (resolved one omitted)
      'bulleted_list_item',
    ]);
    expect(blocks.map(textOf)).toContain('Email Ana — Luis (Mon)');
    expect(blocks.map(textOf)).not.toContain('Solved?');
  });

  it('uses Spanish headings and adds a metadata line when requested', () => {
    const blocks = notesToBlocks(notes, LABELS.es, {
      dateText: '2026-10-31',
      sourceUrl: 'https://example.com/v',
      durationText: '12 min',
    });
    expect(blocks[0]?.type).toBe('paragraph');
    expect(textOf(blocks[0]!)).toBe(
      'Fecha: 2026-10-31 · Fuente: https://example.com/v · Duración: 12 min',
    );
    expect(blocks.map(textOf)).toContain('Decisiones');
  });

  it('returns nothing for empty notes', () => {
    expect(notesToBlocks(emptyNotes(), LABELS.en)).toEqual([]);
  });
});

describe('transcriptBlocks / chunk / detectLanguage', () => {
  it('turns the transcript into short paragraphs', () => {
    const finals = Array.from({ length: 400 }, (_, i) => `Sentence number ${i} here.`);
    const blocks = transcriptBlocks(finals);
    expect(blocks.length).toBeGreaterThan(1);
    expect(blocks.every((b) => textOf(b).length <= 1800)).toBe(true);
    expect(blocks.map(textOf).join(' ').replace(/\s+/g, ' ')).toBe(finals.join(' '));
  });

  it('chunks into groups of 100', () => {
    expect(chunk(Array.from({ length: 250 }, (_, i) => i)).map((c) => c.length)).toEqual([
      100, 100, 50,
    ]);
  });

  it('guesses Spanish vs English', () => {
    expect(detectLanguage('El presupuesto de la empresa es de diez mil para el año')).toBe('es');
    expect(detectLanguage('The budget of the company is ten thousand for the year')).toBe('en');
  });
});
