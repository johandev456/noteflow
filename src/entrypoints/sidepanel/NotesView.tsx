import { useState } from 'react';
import { hasContent } from '../../core/notes/types';
import { notesActions, useSession } from './store';

function EditableText({ id, text, edited }: { id: string; text: string; edited?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);

  function commit() {
    setEditing(false);
    if (draft.trim() && draft.trim() !== text) notesActions.edit(id, draft);
    else setDraft(text);
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setDraft(text);
            setEditing(false);
          }
        }}
        className="w-full rounded border border-blue-400 bg-transparent px-1"
      />
    );
  }
  return (
    <span className="flex-1 cursor-text" onClick={() => (setDraft(text), setEditing(true))}>
      {text}
      {edited && <span className="ml-1 text-xs text-neutral-400">(edited)</span>}
    </span>
  );
}

function Row({
  id,
  text,
  edited,
  marker,
  muted,
}: {
  id: string;
  text: string;
  edited?: boolean;
  marker: string;
  muted?: boolean;
}) {
  return (
    <li
      className={`note-in group flex gap-2 py-0.5 ${muted ? 'text-neutral-400 line-through' : ''}`}
    >
      <span className="select-none text-neutral-400">{marker}</span>
      <EditableText key={text} id={id} text={text} edited={edited} />
      <button
        aria-label="Delete"
        onClick={() => notesActions.remove(id)}
        className="invisible text-neutral-400 hover:text-red-600 group-hover:visible"
      >
        ×
      </button>
    </li>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="note-in mt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</h3>
      {children}
    </section>
  );
}

export function NotesView() {
  const notes = useSession((s) => s.notes);
  const busy = useSession((s) => s.notesBusy);

  if (!hasContent(notes) && !notes.title) {
    return (
      <p className="text-sm text-neutral-500">
        {busy
          ? 'Structuring the first notes…'
          : 'Live notes will appear here as the conversation goes.'}
      </p>
    );
  }

  return (
    <div className="text-sm">
      {notes.title && <h2 className="note-in text-lg font-semibold">{notes.title}</h2>}
      {notes.tldr.length > 0 && (
        <Block title="TL;DR">
          <ul>
            {notes.tldr.map((line, i) => (
              <li key={i} className="py-0.5">
                {line}
              </li>
            ))}
          </ul>
        </Block>
      )}
      {notes.sections.map((section) => (
        <Block key={section.id} title={section.heading}>
          <ul>
            {section.bullets.map((b) => (
              <Row key={b.id} id={b.id} text={b.text} edited={b.userEdited} marker="•" />
            ))}
          </ul>
        </Block>
      ))}
      {notes.decisions.length > 0 && (
        <Block title="Decisions">
          <ul>
            {notes.decisions.map((d) => (
              <Row key={d.id} id={d.id} text={d.text} edited={d.userEdited} marker="✓" />
            ))}
          </ul>
        </Block>
      )}
      {notes.actionItems.length > 0 && (
        <Block title="Action items">
          <ul>
            {notes.actionItems.map((a) => (
              <Row
                key={a.id}
                id={a.id}
                text={[a.text, a.owner && `— ${a.owner}`, a.due && `(${a.due})`]
                  .filter(Boolean)
                  .join(' ')}
                edited={a.userEdited}
                marker="☐"
              />
            ))}
          </ul>
        </Block>
      )}
      {notes.openQuestions.length > 0 && (
        <Block title="Open questions">
          <ul>
            {notes.openQuestions.map((q) => (
              <Row
                key={q.id}
                id={q.id}
                text={q.text}
                edited={q.userEdited}
                marker="?"
                muted={q.resolved}
              />
            ))}
          </ul>
        </Block>
      )}
    </div>
  );
}
