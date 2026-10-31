import { describe, expect, it } from 'vitest';
import { markdownFilename, sessionToMarkdown, type MarkdownSource } from './markdown';
import { applyOps } from './reducer';
import { emptyNotes } from './types';

const notes = applyOps(emptyNotes(), [
  { op: 'set_title', text: 'Budget talk' },
  { op: 'set_tldr', lines: ['Short summary'] },
  { op: 'add_section', heading: 'Budget', id: 's' },
  { op: 'add_bullet', sectionId: 's', text: 'Q3 is 10k\nline two' },
  { op: 'add_decision', text: 'Ship Friday' },
  { op: 'add_action', text: 'Email Ana', owner: 'Luis', due: 'Mon' },
  { op: 'add_question', text: 'Who pays?' },
  { op: 'add_question', text: 'Solved?' },
]);
const solved = applyOps(notes, [{ op: 'resolve_question', id: notes.openQuestions[1]!.id }]);

const source: MarkdownSource = {
  startedAt: Date.UTC(2026, 9, 31, 14, 0),
  endedAt: Date.UTC(2026, 9, 31, 14, 12),
  tabUrl: 'https://youtube.com/watch?v=1',
  tabTitle: 'A talk',
  transcript: ['Hello everyone.', 'Let us talk about the budget.'],
  notes: solved,
};

describe('sessionToMarkdown', () => {
  const md = sessionToMarkdown(source, 'en');

  it('renders title, metadata and every block type in order', () => {
    expect(md.startsWith('# Budget talk\n')).toBe(true);
    expect(md).toContain(
      '> Date: 2026-10-31 14:00 · Source: https://youtube.com/watch?v=1 · Duration: 12 min',
    );
    const order = [
      '## TL;DR',
      '## Budget',
      '## Decisions',
      '## Action items',
      '## Open questions',
      '## Transcript',
    ];
    const positions = order.map((h) => md.indexOf(h));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('renders tasks as checkboxes, omits resolved questions and keeps bullets on one line', () => {
    expect(md).toContain('- [ ] Email Ana — Luis (Mon)');
    expect(md).not.toContain('Solved?');
    expect(md).toContain('- Q3 is 10k line two');
  });

  it('ends with the full transcript and a trailing newline', () => {
    expect(md).toContain('Hello everyone. Let us talk about the budget.');
    expect(md.endsWith('\n')).toBe(true);
  });

  it('uses Spanish headings when asked or detected', () => {
    expect(sessionToMarkdown(source, 'es')).toContain('## Decisiones');
    const es = sessionToMarkdown({
      ...source,
      transcript: ['El presupuesto de la empresa es de diez mil para el año'],
    });
    expect(es).toContain('## Decisiones');
  });

  it('handles an empty session', () => {
    const empty = sessionToMarkdown({ startedAt: 0, transcript: [], notes: emptyNotes() }, 'en');
    expect(empty).toContain('# Untitled session');
  });
});

describe('markdownFilename', () => {
  it('builds a safe slug with the date', () => {
    expect(markdownFilename(source)).toBe('2026-10-31-budget-talk.md');
    expect(
      markdownFilename({ ...source, notes: emptyNotes(), tabTitle: 'Reunión: ¡Año nuevo! / Q4' }),
    ).toBe('2026-10-31-reunion-ano-nuevo-q4.md');
    expect(markdownFilename({ ...source, notes: emptyNotes(), tabTitle: '???' })).toBe(
      '2026-10-31-session.md',
    );
  });
});
