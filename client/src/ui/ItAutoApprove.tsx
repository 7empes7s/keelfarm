// IT auto-approve (#585): Settings → The IT department's switch (on: Routine; or Everything except dangerous), and the
// Undo under a step it ran in IT's chat. The rules are the server's (server/itAuto.ts).
import { useId, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { ItAutoLevel } from '../../../shared/itDept';
import type { PhoneMessage } from '../../../shared/types';
import { Icon } from './Icon';
import './itAuto.css';

const LEVELS: { level: Exclude<ItAutoLevel, 'off'>; label: string; what: string }[] = [
  { level: 'routine', label: 'Routine', what: "reads, git fetch/pull, IT's own units, installing a unit or Caddy file, caddy reload after validate, a project's runbook in its own folders" },
  { level: 'all', label: 'Everything except dangerous', what: 'any change not on the danger list' },
];

/** The switch and its two levels; the danger list stays a card at both. */
export function ItAutoApprove() {
  const id = useId();
  const s = useStore((x) => x.settings.itDept);
  const level = s.autoApprove ?? 'off';
  const save = (autoApprove: ItAutoLevel) => void api.updateSettings({ itDept: { ...s, autoApprove } }).catch(() => undefined); // api() already toasted the error
  return (
    <div className="it-auto">
      <label className="row it-switch">
        <input type="checkbox" checked={level !== 'off'} onChange={(e) => save(e.target.checked ? 'routine' : 'off')} />
        <span>Auto-approve</span>
      </label>
      <p className="muted small">
        {level === 'off' ? 'Every change waits for your Run on its card.' : 'Steps run without a tap, at most 20 per change, each in the chat as done automatically with an Undo where there is one.'} Deleting data or
        backups, disks, the firewall, users and SSH, kills, KEEL and the live office always come to you.
      </p>
      {level !== 'off' && (
        <div className="it-auto-levels" role="radiogroup" aria-label="What IT runs without asking">
          {LEVELS.map((l) => (
            <label key={l.level} className="toggle block">
              <input type="radio" name={`${id}-auto`} checked={level === l.level} onChange={() => save(l.level)} />
              <span>
                <b>{l.label}</b> <span className="muted small">{l.what}</span>
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/** Under an auto step's card in IT's chat: Undo, or that it was undone. */
export function ItAutoUndo({ m }: { m: PhoneMessage }) {
  const [busy, setBusy] = useState(false);
  const a = m.itAuto;
  if (!a?.undo) return null;
  if (a.undone)
    return (
      <p className="it-auto-undo muted small">
        <Icon name="check" /> Undone
      </p>
    );
  return (
    <div className="it-auto-undo">
      <button
        type="button"
        className="btn btn-ghost"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void api.itUndo(a.log).catch(() => undefined).finally(() => setBusy(false)); // api() already toasted the error
        }}
      >
        <Icon name="rotate-ccw" /> {busy ? 'Undoing…' : 'Undo'}
      </button>
    </div>
  );
}
