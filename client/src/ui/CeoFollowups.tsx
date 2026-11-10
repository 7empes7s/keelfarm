// The CEO's follow-ups (#27): which office events wake the CEO (Settings → The CEO), and on the CEO tab the events
// waiting for a follow-up and the manager's standing mandates, each with a ⋯ menu to remove it. Also its kept session,
// waits and consults (#28): their settings, and on the CEO tab what its session holds and waits on.
import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { confirmDialog } from './Confirm';
import { Icon } from './Icon';
import { Menu } from './Menu';
import { DEFAULT_FOLLOWUPS, FOLLOWUP_KINDS, MANDATE_MAX_CHARS, mandateWhere } from '../../../shared/followups';
import type { CeoMandate, FollowupSettings as Followups } from '../../../shared/followups';
import { DEFAULT_CEO_AWAKE, type CeoAwakeSettings } from '../../../shared/ceoAwake';

const save = (patch: Parameters<typeof api.updateSettings>[0]) => void api.updateSettings(patch).catch(() => undefined);
const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function FollowupSettings() {
  const f = useStore((s) => s.settings.ceoFollowups) ?? DEFAULT_FOLLOWUPS;
  const set = (patch: Partial<Followups>) => save({ ceoFollowups: { ...f, ...patch } });
  return (
    <>
      <div className="small" style={{ marginTop: 8 }}>
        <b>Follow-ups: wake the CEO when…</b>
      </div>
      {FOLLOWUP_KINDS.map((k) => (
        <label key={k.id} className="toggle block">
          <input type="checkbox" checked={f.kinds[k.id]} onChange={(e) => set({ kinds: { ...f.kinds, [k.id]: e.target.checked } })} />
          <span>{k.label}</span>
        </label>
      ))}
      <label className="field">
        <span>Gather events for (minutes) into one follow-up</span>
        <input key={`w${f.windowMin}`} type="number" min={0} max={120} defaultValue={f.windowMin} onBlur={(e) => Number(e.target.value) !== f.windowMin && set({ windowMin: Number(e.target.value) })} />
      </label>
      <label className="field">
        <span>Most follow-ups an hour (0 = off)</span>
        <input key={`h${f.perHour}`} type="number" min={0} max={30} defaultValue={f.perHour} onBlur={(e) => Number(e.target.value) !== f.perHour && set({ perHour: Number(e.target.value) })} />
      </label>
      <p className="muted small">
        A follow-up is a short CEO job: it checks a merged PR against its issue, looks at an agent's terminal or a QA report, and messages you only when something needs you. None start while
        Claude's usage is pacing or paused; they wait and merge. They file issues only on floors a standing mandate covers (the CEO tab).
      </p>
    </>
  );
}

function MandateRow({ m, all }: { m: CeoMandate; all: CeoMandate[] }) {
  const expired = m.expiresAt !== null && m.expiresAt <= Date.now();
  return (
    <div className="card small" style={{ padding: 8, marginBottom: 6, opacity: expired ? 0.6 : 1 }}>
      <div className="row">
        <span style={{ flex: 1 }}>“{m.text}”</span>
        <Menu
          label={`More for the mandate “${m.text}”`}
          title="Mandate"
          items={[
            {
              label: 'Remove…',
              danger: true,
              onSelect: () =>
                void confirmDialog({ tone: 'danger', title: 'Remove this mandate?', body: 'The CEO stops acting on it.', confirm: 'Remove' }).then((ok) => {
                  if (ok) save({ ceoMandates: all.filter((x) => x.id !== m.id) });
                }),
            },
          ]}
        />
      </div>
      <div className="muted">
        {mandateWhere(m)}
        {m.expiresAt ? ` · ${expired ? 'ended' : 'until'} ${new Date(m.expiresAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}` : ' · no end'}
      </div>
    </div>
  );
}

export function CeoMandates() {
  const mandates = useStore((s) => s.settings.ceoMandates) ?? [];
  const followups = useStore((s) => s.ceo.followups);
  const [text, setText] = useState('');
  const [floors, setFloors] = useState('');
  const add = () => {
    const t = text.trim();
    if (!t) return;
    const list = floors
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
    save({ ceoMandates: [...mandates, { id: `m-${Date.now().toString(36)}`, text: t, floors: list, expiresAt: null, at: Date.now() }] });
    setText('');
    setFloors('');
  };
  return (
    <>
      <h3 className="section">
        <Icon name="pin" /> Standing mandates {mandates.length > 0 && <span className="badge">{mandates.length}</span>}
      </h3>
      {mandates.length === 0 && <p className="muted small">None. Tell the CEO "keep working on floor 3 until it's perfected" and they record one; follow-ups then file issues there.</p>}
      {mandates.map((m) => (
        <MandateRow key={m.id} m={m} all={mandates} />
      ))}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input value={text} maxLength={MANDATE_MAX_CHARS} onChange={(e) => setText(e.target.value)} placeholder="Add a mandate, e.g. Keep polishing the lobby" aria-label="New mandate" />
        <input value={floors} onChange={(e) => setFloors(e.target.value)} placeholder="Floors (all)" aria-label="Floors it covers" style={{ maxWidth: 110 }} />
        <button className="btn btn-small" disabled={!text.trim()}>
          Add
        </button>
      </form>
      {followups && followups.pending.length > 0 && (
        <p className="small">
          <b>Follow-up waiting:</b> {followups.pending.join(', ')}
          <span className="muted">
            {' '}
            · {followups.held === 'usage' ? "held while Claude's usage is pacing or paused" : followups.startsAt ? `starts around ${time(followups.startsAt)}${followups.held === 'cap' ? ' (hourly limit)' : ''}` : 'starting'}
          </span>
        </p>
      )}
    </>
  );
}

type AwakeNumber = Exclude<keyof CeoAwakeSettings, 'keepAlive' | 'freshJobs' | 'models' | 'automatedOnCeo'>;
const AWAKE_FIELDS: [AwakeNumber, string, number, number][] = [
  ['restartTurns', 'Fresh session after (turns)', 20, 5000],
  ['idleHours', '… or after idle for (hours)', 1, 168],
  ['maxWaitMin', 'Longest wait for a PR, issue or agent (minutes)', 1, 30],
  ['consultMin', "A consult's time cap (minutes)", 2, 30],
  ['consultMax', 'Consults at once', 1, 10],
];

export function AwakeSettings() {
  const w = useStore((s) => s.settings.ceoAwake) ?? DEFAULT_CEO_AWAKE;
  const set = (patch: Partial<CeoAwakeSettings>) => save({ ceoAwake: { ...w, ...patch } });
  return (
    <>
      <div className="small" style={{ marginTop: 8 }}>
        <b>Staying awake, waits and consults</b>
      </div>
      <label className="toggle block">
        <input type="checkbox" checked={w.keepAlive} onChange={(e) => set({ keepAlive: e.target.checked })} />
        <span>Keep the CEO's session between jobs, so follow-ups and chat reuse its context</span>
      </label>
      <label className="toggle block">
        <input type="checkbox" checked={w.freshJobs} onChange={(e) => set({ freshJobs: e.target.checked })} />
        <span>Start reviews, follow-ups, triage, research and plans fresh, with a short digest of the chat: only chat carries on</span>
      </label>
      {AWAKE_FIELDS.map(([k, label, min, max]) => (
        <label key={k} className="field">
          <span>{label}</span>
          <input key={`${k}${w[k]}`} type="number" min={min} max={max} defaultValue={w[k]} onBlur={(e) => Number(e.target.value) !== w[k] && set({ [k]: Number(e.target.value) })} />
        </label>
      ))}
      <p className="muted small">
        The CEO can wait for a PR's QA or merge, an issue, an agent or a preview, ask you a question and wait up to 2 hours for your reply, and consult an agent on a floor in a short
        read-only session (no edits, commits or PRs). A waiting CEO holds no session slot, and every wait ends when the office updates itself.
      </p>
    </>
  );
}

/** The CEO tab's line on its session: turns and cost since it started, and what it waits on. */
export function CeoSession() {
  const s = useStore((x) => x.ceo.session);
  if (!s?.startedAt) return null;
  return (
    <p className="small">
      <b>Session:</b> {s.turns} turns · ${s.costUsd.toFixed(2)} since {time(s.startedAt)}
      {s.consults > 0 && ` · ${s.consults} consult${s.consults === 1 ? '' : 's'}`}
      {s.waiting && <span className="muted"> · waiting for {s.waiting}</span>}
    </p>
  );
}
