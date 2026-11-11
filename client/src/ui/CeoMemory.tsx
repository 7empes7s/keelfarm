import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { MEMORY_MAX_NOTES, MEMORY_NOTE_MAX, MEMORY_TOTAL_MAX, type MemoryNote } from '../../../shared/ceoMemory';
import { CeoNotes } from './CeoNotes';
import { Sheet } from './ChatArtifacts';
import { confirmDialog } from './Confirm';
import { Icon } from './Icon';
import { Menu } from './Menu';

// "What the CEO remembers" (#51): the manager's pinned notes, in every CEO job (editable), and the CEO's own
// NOTES.md (read-only, in sections: CeoNotes.tsx).

function NoteRow({ n }: { n: MemoryNote }) {
  const [text, setText] = useState<string | null>(null);
  if (text !== null) {
    return (
      <li className="memory-note">
        <textarea className="memory-input" value={text} maxLength={MEMORY_NOTE_MAX} onChange={(e) => setText(e.target.value)} aria-label="Edit the note" autoFocus />
        <div className="row memory-actions">
          <button type="button" className="btn btn-small btn-good" onClick={() => void api.editMemory(n.id, text).then(() => setText(null)).catch(() => undefined)}>
            Save
          </button>
          <button type="button" className="btn btn-small" onClick={() => setText(null)}>
            Cancel
          </button>
        </div>
      </li>
    );
  }
  return (
    <li className="memory-note row">
      <span className="grow">{n.text}</span>
      <button type="button" className="btn btn-small" onClick={() => setText(n.text)} aria-label={`Edit the note “${n.text}”`}>
        <Icon name="pencil" />
      </button>
      <Menu
        label={`More for the note “${n.text}”`}
        title="Note"
        items={[
          {
            label: 'Delete…',
            danger: true,
            onSelect: () =>
              void confirmDialog({ tone: 'danger', title: 'Delete this note?', body: 'The CEO stops getting it in its jobs.', confirm: 'Delete' }).then((ok) => {
                if (ok) void api.deleteMemory(n.id).catch(() => undefined);
              }),
          },
        ]}
      />
    </li>
  );
}

export function CeoMemory({ ceoName, onClose }: { ceoName: string; onClose: () => void }) {
  const notes = useStore((s) => s.chat.memory);
  const [draft, setDraft] = useState('');
  const [file, setFile] = useState<{ text: string; truncated: boolean } | null>(null);
  useEffect(() => void api.ceoNotes().then(setFile).catch(() => setFile({ text: '', truncated: false })), []);
  const used = notes.reduce((n, x) => n + x.text.length, 0);
  const add = () => void api.addMemory(draft).then(() => setDraft('')).catch(() => undefined);
  return (
    <Sheet label={`What ${ceoName} remembers`} onClose={onClose} className="memory-sheet" surface="memory">
      <div className="artifact-body memory-body">
        <h3 className="memory-h">Your notes for {ceoName}</h3>
        <p className="muted small">
          {ceoName} gets these in every job, in every conversation. {notes.length}/{MEMORY_MAX_NOTES} notes · {used}/{MEMORY_TOTAL_MAX} characters.
        </p>
        {notes.length > 0 && (
          <ul className="memory-notes">
            {notes.map((n) => (
              <NoteRow key={n.id} n={n} />
            ))}
          </ul>
        )}
        <form
          className="memory-add"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <textarea className="memory-input" value={draft} maxLength={MEMORY_NOTE_MAX} onChange={(e) => setDraft(e.target.value)} placeholder="Remember this… (e.g. “Ship on Fridays only after QA”)" aria-label={`A note for ${ceoName} to remember`} />
          <button className="btn btn-small btn-good" disabled={!draft.trim() || notes.length >= MEMORY_MAX_NOTES}>
            <Icon name="pin" /> Remember
          </button>
        </form>
        <h3 className="memory-h">{ceoName}'s own notes</h3>
        <p className="muted small">The notes file {ceoName} keeps about the company (NOTES.md), read-only.</p>
        {file === null ? (
          <p className="muted">Loading…</p>
        ) : !file.text ? (
          <p className="muted">{ceoName} hasn't written any notes yet.</p>
        ) : (
          <CeoNotes ceoName={ceoName} text={file.text} truncated={file.truncated} />
        )}
      </div>
    </Sheet>
  );
}
