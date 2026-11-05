import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { changedParts, charterOf, charterText, CHARTER_PROMPT_MAX, cleanCharter, OBJECTIVES_MAX, OUTCOME_MAX, FOCUS_MAX } from '../../../shared/charter';
import type { Charter, CharterProposal } from '../../../shared/charter';
import type { RepoView } from '../../../shared/types';
import { confirmDialog } from './Confirm';
import './charter.css';

// The manager's console → Charter (#48), also in pocket mode: each floor's mission, current focus, objectives,
// standards and non-goals, the CEO's proposal waiting for a yes, who changed what, and the drift view (merged PRs of
// the last 7 days by the objective they served). Export puts the full charter on a pull request as docs/CHARTER.md.

async function attempt<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch {
    return undefined; // api() already toasted the error
  }
}

const ago = (at: number) => {
  const m = Math.round((Date.now() - at) / 60_000);
  return m < 60 ? `${Math.max(1, m)} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

const toLines = (items: string[]) => items.join('\n');
const fromLines = (text: string) => text.split('\n');

/** The parts of a proposal that differ from the charter now, each with its proposed value. Also in pocket mode's Approvals. */
export function ProposalCard({ repo, proposal, onEdit }: { repo: RepoView; proposal: CharterProposal; onEdit?: () => void }) {
  const [busy, setBusy] = useState(false);
  const now = charterOf(repo.mission, repo.charter);
  const p = proposal.charter;
  const parts = changedParts(now, p);
  const decide = async (approve: boolean) => {
    setBusy(true);
    await attempt(() => api.decideCharter(repo.id, approve));
    setBusy(false);
  };
  const value: Record<string, string> = {
    mission: p.mission,
    focus: p.focus,
    objectives: p.objectives.map((o) => `${o.id}: ${o.outcome}${o.measure ? ` (met when: ${o.measure})` : ''}`).join('\n'),
    standards: toLines(p.standards),
    'non-goals': toLines(p.nonGoals),
  };
  return (
    <div className="card charter-proposal" role="group" aria-label={`Charter proposal from ${proposal.by}`}>
      <h3>
        🧠 {proposal.by} proposes a change{onEdit ? '' : ` · floor ${repo.floor}`}
      </h3>
      <p className="small">
        {proposal.reason} <span className="muted">({ago(proposal.at)})</span>
      </p>
      <dl className="charter-diff">
        {parts.map((k) => (
          <div key={k}>
            <dt>{k[0].toUpperCase() + k.slice(1)}</dt>
            <dd>{value[k] || <span className="muted">(cleared)</span>}</dd>
          </div>
        ))}
      </dl>
      <div className="ds-decision">
        <button className="btn btn-small btn-ghost" data-decision disabled={busy} onClick={() => void decide(false)}>
          Dismiss
        </button>
        {onEdit && (
          <button className="btn btn-small btn-ghost" disabled={busy} onClick={onEdit}>
            Edit first
          </button>
        )}
        <button className="btn btn-small btn-good" data-decision disabled={busy} onClick={() => void decide(true)}>
          Approve
        </button>
      </div>
    </div>
  );
}

function Editor({ repo, start, fromProposal, onDone }: { repo: RepoView; start: Charter; fromProposal: boolean; onDone: () => void }) {
  const [draft, setDraft] = useState(start);
  const [standards, setStandards] = useState(toLines(start.standards));
  const [nonGoals, setNonGoals] = useState(toLines(start.nonGoals));
  const [busy, setBusy] = useState(false);
  const charter = cleanCharter({ ...draft, standards: fromLines(standards), nonGoals: fromLines(nonGoals) });
  const size = charterText(charter).length;
  const saved = charterOf(repo.mission, repo.charter);
  const dirty = fromProposal || JSON.stringify(charter) !== JSON.stringify(saved);
  const set = (patch: Partial<Charter>) => setDraft({ ...draft, ...patch });
  const setObjective = (i: number, patch: Partial<Charter['objectives'][number]>) => set({ objectives: draft.objectives.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  const nextId = () => {
    const used = new Set(draft.objectives.map((o) => o.id));
    let n = 1;
    while (used.has(`O${n}`)) n++;
    return `O${n}`;
  };
  const save = async () => {
    setBusy(true);
    const ok = await attempt(() => (fromProposal ? api.decideCharter(repo.id, true, charter) : api.setCharter(repo.id, charter)));
    setBusy(false);
    if (ok) onDone();
  };
  return (
    <form
      className="charter-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="charter-field">
        <span>Mission</span>
        <textarea rows={2} value={draft.mission} onChange={(e) => set({ mission: e.target.value })} placeholder="One or two lines: what this project is for and who it serves." />
      </label>
      <label className="charter-field">
        <span>Current focus</span>
        <input value={draft.focus} maxLength={FOCUS_MAX} onChange={(e) => set({ focus: e.target.value })} placeholder="The milestone, or the objectives worked on now, e.g. O2, O3" />
      </label>
      <fieldset className="charter-field">
        <legend>Objectives</legend>
        {draft.objectives.map((o, i) => (
          <div key={i} className="charter-objective">
            <span className="charter-id" aria-label={`Objective ${o.id}`}>
              {o.id}
            </span>
            <input aria-label={`${o.id} outcome`} value={o.outcome} maxLength={OUTCOME_MAX} onChange={(e) => setObjective(i, { outcome: e.target.value })} placeholder="The outcome" />
            <input aria-label={`${o.id}: how we know it's met`} value={o.measure} maxLength={OUTCOME_MAX} onChange={(e) => setObjective(i, { measure: e.target.value })} placeholder="How we know it's met" />
            <button type="button" className="btn btn-small btn-ghost" aria-label={`Remove ${o.id}`} onClick={() => set({ objectives: draft.objectives.filter((_, j) => j !== i) })}>
              ✕
            </button>
          </div>
        ))}
        {draft.objectives.length < OBJECTIVES_MAX && (
          <button type="button" className="btn btn-small btn-ghost" onClick={() => set({ objectives: [...draft.objectives, { id: nextId(), outcome: '', measure: '' }] })}>
            ＋ Add an objective
          </button>
        )}
      </fieldset>
      <label className="charter-field">
        <span>Standards: one per line; breaking one fails QA</span>
        <textarea rows={4} value={standards} onChange={(e) => setStandards(e.target.value)} placeholder={'Quality bars, safety rules, style, "never" lists.\nNew logic comes with tests'} />
      </label>
      <label className="charter-field">
        <span>Non-goals: one per line</span>
        <textarea rows={2} value={nonGoals} onChange={(e) => setNonGoals(e.target.value)} placeholder="What this project will not do." />
      </label>
      <p className={`small charter-meter ${size > CHARTER_PROMPT_MAX ? 'charter-meter-over' : ''}`} role="status">
        {size.toLocaleString()} / {CHARTER_PROMPT_MAX.toLocaleString()} characters in every agent's prompt
        {size > CHARTER_PROMPT_MAX && '. Agents get only the first part: shorten it.'}
      </p>
      <div className="row wrap">
        {fromProposal && (
          <button type="button" className="btn btn-small btn-ghost" disabled={busy} onClick={onDone}>
            Back to the proposal
          </button>
        )}
        <span className="spacer" />
        <button className="btn btn-small btn-good" disabled={busy || !dirty}>
          {fromProposal ? 'Approve with my edits' : 'Save charter'}
        </button>
      </div>
    </form>
  );
}

function Drift({ repo }: { repo: RepoView }) {
  const groups = repo.charter.drift;
  const merged = groups.reduce((n, g) => n + g.prs.length, 0);
  return (
    <div className="card">
      <h3>🧭 Where the last 7 days went</h3>
      {merged === 0 ? (
        <p className="muted small">No merges in the last 7 days. Merged pull requests show up here under the objective their issue named.</p>
      ) : (
        <ul className="charter-drift">
          {groups.map((g) => (
            <li key={g.objective ?? 'none'} className={g.objective ? '' : 'charter-drift-none'}>
              <div className="charter-drift-head">
                <b>{g.objective ?? 'No objective'}</b>
                <span className="grow small">{g.objective ? g.outcome : 'merged without naming an objective'}</span>
                <span className="small">{g.prs.length}</span>
              </div>
              <div className="charter-drift-bar" style={{ ['--share' as string]: `${(g.prs.length / merged) * 100}%` }} aria-hidden />
              {g.prs.length > 0 && (
                <div className="muted small">
                  {g.prs.map((p) => (
                    <a key={p.number} href={`${repo.url}/pull/${p.number}`} target="_blank" rel="noreferrer" title={p.title}>
                      #{p.number}
                    </a>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function History({ repo }: { repo: RepoView }) {
  return (
    <div className="card">
      <h3>🕓 Changes</h3>
      {repo.charter.history.length === 0 ? (
        <p className="muted small">No changes yet.</p>
      ) : (
        <ul className="charter-history">
          {repo.charter.history.map((h, i) => (
            <li key={i} className="small">
              <b>{h.by}</b> changed {h.parts.join(', ')} <span className="muted">{ago(h.at)}</span>
              {h.note && h.note !== 'edited' && <div className="muted">{h.note}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CharterTab({ initialRepo }: { initialRepo?: string }) {
  const repos = useStore((s) => s.repos);
  const [repoId, setRepoId] = useState(initialRepo ?? repos.find((r) => r.charter.proposal)?.id ?? repos[0]?.id ?? '');
  const [editProposal, setEditProposal] = useState(false);
  const [exported, setExported] = useState<string | null>(null);
  const repo = repos.find((r) => r.id === repoId) ?? repos[0];
  useEffect(() => {
    setEditProposal(false);
    setExported(null);
  }, [repo?.id]);
  if (!repo) return <p className="muted">Connect a repo first.</p>;
  const proposal = repo.charter.proposal;
  const fromProposal = editProposal && !!proposal;
  const start = fromProposal ? proposal.charter : charterOf(repo.mission, repo.charter);
  const exportIt = async () => {
    const ok = await confirmDialog({
      icon: '📄',
      title: 'Export the charter?',
      body: `The office commits docs/CHARTER.md to the cubefarm/charter branch of ${repo.fullName} and opens a pull request for you to merge. QA leaves it alone.`,
      confirm: 'Export',
    });
    if (!ok) return;
    const res = await attempt(() => api.exportCharter(repo.id));
    if (res) setExported(res.url);
  };
  return (
    <div className="tab-grid">
      <div>
        <select value={repo.id} onChange={(e) => setRepoId(e.target.value)} aria-label="Floor">
          {repos.map((r) => (
            <option key={r.id} value={r.id}>
              Floor {r.floor} · {r.fullName}
              {r.charter.proposal ? ' · proposal waiting' : ''}
            </option>
          ))}
        </select>
        {proposal && !fromProposal && <ProposalCard repo={repo} proposal={proposal} onEdit={() => setEditProposal(true)} />}
        <div className="card floor-card" style={{ ['--accent' as string]: repo.color }}>
          <h3>{fromProposal ? `🎯 ${proposal.by}'s proposal, your edits` : '🎯 Charter'}</h3>
          <p className="muted small">Every build, fix and QA prompt on this floor starts with it, and QA fails a PR that breaks a standard.</p>
          <Editor key={`${repo.id}:${fromProposal}:${JSON.stringify(start)}`} repo={repo} start={start} fromProposal={fromProposal} onDone={() => setEditProposal(false)} />
          <div className="row wrap charter-export">
            <button className="btn btn-small btn-ghost" onClick={() => void exportIt()}>
              📄 Export to docs/CHARTER.md
            </button>
            {exported && (
              <a className="small" href={exported} target="_blank" rel="noreferrer">
                Open the pull request
              </a>
            )}
          </div>
        </div>
      </div>
      <div>
        <Drift repo={repo} />
        <History repo={repo} />
      </div>
    </div>
  );
}
