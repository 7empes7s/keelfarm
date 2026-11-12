import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type TextareaHTMLAttributes } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { changedParts, charterOf, charterText, CHARTER_PROMPT_MAX, cleanCharter, OBJECTIVES_MAX, OUTCOME_MAX, FOCUS_MAX, isEmptyCharter } from '../../../shared/charter';
import type { Charter, CharterProposal, DriftGroup } from '../../../shared/charter';
import { focusIds, STATS_WINDOWS, type StatsWindow } from '../../../shared/charterStats';
import type { RepoView } from '../../../shared/types';
import { jumpFor } from './chatRefs';
import { chipRow } from './chipRow';
import { confirmDialog } from './Confirm';
import { Menu } from './Menu';
import { reduceMotion } from './a11y';
import { InsightStrip, ObjectiveCard } from './CharterStats';
import { EmptyState } from './EmptyState';
import { Icon } from './Icon';
import './charter.css';

// The manager's console → Charter (#48), also in pocket mode: each floor's charter as a page to read (#105), the
// numbers behind it (the insight strip and a card per objective, over 7 or 30 days), the CEO's proposal waiting for a
// yes, who changed what, and the drift view (merged PRs of the last 7 days by the objective they served). Edit opens
// the editor; Export (under ⋯) puts the full charter on a pull request as docs/CHARTER.md.

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
        <Icon name="brain" /> {proposal.by} proposes a change{onEdit ? '' : ` · floor ${repo.floor}`}
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

/** A textarea as tall as its text. */
function AutoText(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const el = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const t = el.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight + 2}px`;
  }, [props.value]);
  return <textarea ref={el} rows={1} {...props} />;
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
  const remove = async (i: number) => {
    const o = draft.objectives[i];
    const ok = await confirmDialog({ tone: 'danger', icon: 'trash-2', title: `Remove ${o.id}?`, body: `"${o.outcome || 'This objective'}" leaves the charter when you save it. Issues that name ${o.id} keep their tag.`, confirm: `Remove ${o.id}` });
    if (ok) setDraft((d) => ({ ...d, objectives: d.objectives.filter((x) => x !== o) }));
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
        <AutoText value={draft.mission} onChange={(e) => set({ mission: e.target.value })} placeholder="One or two lines: what this project is for and who it serves." />
      </label>
      <label className="charter-field">
        <span>Current focus</span>
        <AutoText value={draft.focus} maxLength={FOCUS_MAX} onChange={(e) => set({ focus: e.target.value.replace(/\n/g, ' ') })} placeholder="The milestone, or the objectives worked on now, e.g. O2, O3" />
      </label>
      <fieldset className="charter-field">
        <legend>Objectives</legend>
        {draft.objectives.map((o, i) => (
          <div key={i} className="charter-objective">
            <div className="charter-objective-head">
              <span className="charter-id" aria-label={`Objective ${o.id}`}>
                {o.id}
              </span>
              <span className="grow" />
              <Menu label={`More for ${o.id}`} title={o.id} items={[{ label: `Remove ${o.id}…`, danger: true, hint: 'Saved when you save the charter', onSelect: () => void remove(i) }]} />
            </div>
            <label className="charter-field">
              <span>Outcome</span>
              <AutoText aria-label={`${o.id} outcome`} value={o.outcome} maxLength={OUTCOME_MAX} onChange={(e) => setObjective(i, { outcome: e.target.value.replace(/\n/g, ' ') })} placeholder="The outcome" />
            </label>
            <label className="charter-field">
              <span>Met when</span>
              <AutoText aria-label={`${o.id}: how we know it's met`} value={o.measure} maxLength={OUTCOME_MAX} onChange={(e) => setObjective(i, { measure: e.target.value.replace(/\n/g, ' ') })} placeholder="How we know it's met" />
            </label>
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
        <AutoText value={standards} onChange={(e) => setStandards(e.target.value)} placeholder={'Quality bars, safety rules, style, "never" lists.\nNew logic comes with tests'} />
      </label>
      <label className="charter-field">
        <span>Non-goals: one per line</span>
        <AutoText value={nonGoals} onChange={(e) => setNonGoals(e.target.value)} placeholder="What this project will not do." />
      </label>
      <p className={`small charter-meter ${size > CHARTER_PROMPT_MAX ? 'charter-meter-over' : ''}`} role="status">
        {size.toLocaleString()} / {CHARTER_PROMPT_MAX.toLocaleString()} characters in every agent's prompt
        {size > CHARTER_PROMPT_MAX && '. Agents get only the first part: shorten it.'}
      </p>
      <div className="row wrap">
        <button type="button" className="btn btn-small btn-ghost" disabled={busy} onClick={onDone}>
          {fromProposal ? 'Back to the proposal' : 'Cancel'}
        </button>
        <span className="spacer" />
        <button className="btn btn-small btn-good" disabled={busy || !dirty}>
          {fromProposal ? 'Approve with my edits' : 'Save charter'}
        </button>
      </div>
    </form>
  );
}

/** A drift group's PRs, newest first: chips that wrap in the card, the first few then "+N more" (#240). A tap opens the PR's card; GitHub when the office no longer has it. */
function DriftPrs({ repo, label, prs }: { repo: RepoView; label: string; prs: DriftGroup['prs'] }) {
  const [open, setOpen] = useState(false);
  const row = chipRow(prs, open);
  const openCard = (e: MouseEvent, number: number) => {
    const s = useStore.getState();
    const j = jumpFor({ kind: 'issue', repoId: repo.id, number, start: 0, end: 0 }, 'pocket', s); // 'pocket': no elevator ride, the card opens over this tab
    if (j?.kind !== 'overlay') return; // a link to GitHub
    e.preventDefault();
    // closing the card comes back here, as the Kanban's does
    const back = s.overlay;
    s.openOverlay(j.overlay);
    useStore.setState({ back });
  };
  return (
    <div className="charter-chips" role="group" aria-label={`${label}: ${prs.length} merged PRs`}>
      {row.shown.map((p) => (
        <a key={p.number} className="charter-chip" href={`${repo.url}/pull/${p.number}`} target="_blank" rel="noreferrer" title={p.title} onClick={(e) => openCard(e, p.number)}>
          <span>#{p.number}</span>
        </a>
      ))}
      {(row.more > 0 || open) && (
        <button className="btn btn-small btn-ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Show fewer' : `+${row.more} more`}
        </button>
      )}
    </div>
  );
}

function Drift({ repo }: { repo: RepoView }) {
  const groups = repo.charter.drift;
  const merged = groups.reduce((n, g) => n + g.prs.length, 0);
  return (
    <div className="card">
      <h3><Icon name="compass" /> Where the last 7 days went</h3>
      {merged === 0 ? (
        <EmptyState kind="drift" compact target={{ kind: 'ceo', text: `Plan floor ${repo.floor}'s next issues against its charter objectives.` }} />
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
              {g.prs.length > 0 && <DriftPrs repo={repo} label={g.objective ?? 'No objective'} prs={g.prs} />}
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
      <h3><Icon name="clock" /> Changes</h3>
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

/** The charter as a page to read: mission as the headline, the focus and its objectives, a card per objective with its numbers, standards and non-goals. */
function ReadView({ repo, days }: { repo: RepoView; days: StatsWindow }) {
  const c = repo.charter;
  const insights = c.insights;
  const focus = new Set(focusIds(c));
  if (isEmptyCharter(charterOf(repo.mission, c))) return <p className="muted">No charter yet. Edit it to give every agent on this floor the same mission, objectives and standards.</p>;
  return (
    <div className="charter-read">
      {repo.mission && <p className="charter-mission">{repo.mission}</p>}
      {c.focus && (
        <div className="charter-focus">
          <span className="small muted">Current focus</span>
          <span className="charter-focus-text">{c.focus}</span>
          {[...focus].map((id) => (
            <button key={id} type="button" className="chip charter-focus-chip" onClick={() => document.getElementById(`charter-${repo.id}-${id}`)?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' })}>
              {id}: {c.objectives.find((o) => o.id === id)?.outcome}
            </button>
          ))}
        </div>
      )}
      {c.objectives.length > 0 && (
        <>
          <h4>Objectives</h4>
          <ul className="cs-objectives">
            {c.objectives.map((o) => (
              <ObjectiveCard key={o.id} repo={repo} objective={o} insight={insights?.objectives.find((x) => x.id === o.id)} days={days} inFocus={focus.has(o.id)} />
            ))}
          </ul>
        </>
      )}
      <div className="charter-lists">
        <div>
          <h4>Standards</h4>
          {c.standards.length ? (
            <ul className="charter-list">
              {c.standards.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : (
            <p className="muted small">None yet.</p>
          )}
        </div>
        <div>
          <h4>Non-goals</h4>
          {c.nonGoals.length ? (
            <ul className="charter-list">
              {c.nonGoals.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : (
            <p className="muted small">None yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function CharterTab({ initialRepo }: { initialRepo?: string }) {
  const repos = useStore((s) => s.repos);
  const [repoId, setRepoId] = useState(initialRepo ?? repos.find((r) => r.charter.proposal)?.id ?? repos[0]?.id ?? '');
  const [editing, setEditing] = useState<'charter' | 'proposal' | null>(null);
  const [days, setDays] = useState<StatsWindow>(7);
  const [exported, setExported] = useState<string | null>(null);
  const repo = repos.find((r) => r.id === repoId) ?? repos[0];
  useEffect(() => {
    setEditing(null);
    setExported(null);
  }, [repo?.id]);
  if (!repo) return <p className="muted">Connect a repo first.</p>;
  const proposal = repo.charter.proposal;
  const fromProposal = editing === 'proposal' && !!proposal;
  const start = fromProposal ? proposal.charter : charterOf(repo.mission, repo.charter);
  const exportIt = async () => {
    const ok = await confirmDialog({
      icon: 'file-text',
      title: 'Export the charter?',
      body: `The office commits docs/CHARTER.md to the cubefarm/charter branch of ${repo.fullName} and opens a pull request for you to merge. QA leaves it alone.`,
      confirm: 'Export',
    });
    if (!ok) return;
    const res = await attempt(() => api.exportCharter(repo.id));
    if (res) setExported(res.url);
  };
  return (
    <div className="tab-grid charter-tab" data-tour="charter">
      <div>
        <div className="charter-bar">
          <select value={repo.id} onChange={(e) => setRepoId(e.target.value)} aria-label="Floor">
            {repos.map((r) => (
              <option key={r.id} value={r.id}>
                Floor {r.floor} · {r.fullName}
                {r.charter.proposal ? ' · proposal waiting' : ''}
              </option>
            ))}
          </select>
          {!editing && (
            <div className="charter-window" role="group" aria-label="Numbers over">
              {STATS_WINDOWS.map((d) => (
                <button key={d} type="button" className={`btn btn-small ${days === d ? '' : 'btn-ghost'}`} aria-pressed={days === d} onClick={() => setDays(d)}>
                  {d} days
                </button>
              ))}
            </div>
          )}
        </div>
        {proposal && !fromProposal && <ProposalCard repo={repo} proposal={proposal} onEdit={() => setEditing('proposal')} />}
        {!editing && repo.charter.insights && <InsightStrip repo={repo} insights={repo.charter.insights} days={days} />}
        <div className="card floor-card" style={{ ['--accent' as string]: repo.color }}>
          <div className="ds-card-head">
            <div className="ds-row-main">
              <h3 className="ds-row-title">
                <Icon name="target" /> {fromProposal ? `${proposal.by}'s proposal, your edits` : editing ? 'Editing the charter' : 'Charter'}
              </h3>
            </div>
            {!editing && (
              <button className="btn btn-small" data-tour="charter-edit" onClick={() => setEditing('charter')}>
                <Icon name="pencil" /> Edit
              </button>
            )}
            <Menu label="More for the charter" title="Charter" items={[{ label: 'Export to docs/CHARTER.md…', hint: 'Opens a pull request for you to merge', onSelect: () => void exportIt() }]} />
          </div>
          <p className="muted small">Every build, fix and QA prompt on this floor starts with it, and QA fails a PR that breaks a standard.</p>
          {exported && (
            <a className="small" href={exported} target="_blank" rel="noreferrer">
              Open the export pull request
            </a>
          )}
          {editing ? (
            <Editor key={`${repo.id}:${fromProposal}:${JSON.stringify(start)}`} repo={repo} start={start} fromProposal={fromProposal} onDone={() => setEditing(null)} />
          ) : (
            <ReadView repo={repo} days={days} />
          )}
        </div>
      </div>
      <div>
        <Drift repo={repo} />
        <History repo={repo} />
      </div>
    </div>
  );
}
