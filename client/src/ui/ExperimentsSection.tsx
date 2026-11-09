import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { TASK_KIND_LABELS, type TaskKind } from '../../../shared/costs';
import { fmtMetric, LAB_KINDS, METRICS, type ExperimentInput, type ExperimentView, type LabTag, type MeanCi, type Metric, type PracticeSettings } from '../../../shared/experiments';
import type { AgentCli, EffortLevel, RepoView } from '../../../shared/types';
import { EFFORTS } from './AgentSettings';
import { confirmDialog } from './Confirm';
import { describePractices } from '../../../shared/practices';
import { EmptyState } from './EmptyState';
import { Icon } from './Icon';
import './experiments.css';

// Mission control → Experiments (#23): A/B tests of harness practices on real issues. Each experiment's numbers per
// variant with their 95% intervals (drawn on one scale per metric, so overlap is visible at a glance), the plain
// verdict, and the manager's start, stop and promote. The state comes from the snapshot and `experiments` events.

const STATUS: Record<ExperimentView['status'], string> = { draft: 'Draft', running: 'Running', stopped: 'Stopped' };

/** What a variant changes, in a few words. */
function describe(s: PracticeSettings): string {
  const parts: string[] = [];
  if (s.prompt) parts.push(`adds “${s.prompt}”`);
  if (s.qaLens) parts.push(`QA lens “${s.qaLens}”`);
  const eff = [...new Set(Object.values(s.effort ?? {}))];
  if (eff.length) parts.push(`${eff.join('/')} effort`);
  const model = [...new Set(Object.values(s.model ?? {}))];
  if (model.length) parts.push(`model ${model.join('/')}`);
  if (s.qaCli) parts.push(`QA by ${s.qaCli} agents`);
  if (s.toolsOff?.length) parts.push(`${s.toolsOff.join(', ')} off`);
  if (s.practices) parts.push(describePractices(s.practices));
  return parts.join(' · ') || 'the office as it is';
}

/** Each variant's interval on one shared scale: a line from low to high, a dot at the mean. */
function Intervals({ cells, colors }: { cells: MeanCi[]; colors: string[] }) {
  const xs = cells.flatMap((c) => [c.lo, c.hi, c.mean]).filter((x): x is number => x !== null);
  if (!xs.length) return null;
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  const span = max - min || 1;
  const x = (v: number) => 4 + ((v - min) / span) * 92;
  return (
    <svg className="lab-ci" viewBox={`0 0 100 ${cells.length * 7 + 2}`} preserveAspectRatio="none" aria-hidden>
      {cells.map((c, i) =>
        c.mean === null ? null : (
          <g key={i} style={{ color: colors[i] }}>
            {c.lo !== null && c.hi !== null && <line x1={x(c.lo)} x2={x(c.hi)} y1={i * 7 + 4.5} y2={i * 7 + 4.5} stroke="currentColor" strokeWidth="2.2" vectorEffect="non-scaling-stroke" />}
            <rect x={x(c.mean) - 1.2} y={i * 7 + 1.5} width="2.4" height="6" fill="currentColor" />
          </g>
        ),
      )}
    </svg>
  );
}

const COLORS = ['#6b6880', '#2a9d8f', '#e76f51', '#7b5ea7'];

function cell(c: MeanCi, m: Metric) {
  if (c.mean === null) return <span className="muted">—</span>;
  return (
    <>
      <b>{fmtMetric(c.mean, m.unit)}</b>
      {c.lo !== null && c.hi !== null && (
        <span className="muted small lab-range">
          {fmtMetric(c.lo, m.unit)}…{fmtMetric(c.hi, m.unit)}
        </span>
      )}
      <span className="muted small"> n={c.n}</span>
    </>
  );
}

function Results({ e }: { e: ExperimentView }) {
  const r = e.result;
  return (
    <div className="ops-table-wrap">
      <table className="ops-table lab-table">
        <thead>
          <tr>
            <th>Metric</th>
            {r.variants.map((v, i) => (
              <th key={v.id} style={{ color: COLORS[i] }}>
                {v.id.toUpperCase()} · {v.name}
              </th>
            ))}
            <th className="lab-ci-head">95% intervals</th>
          </tr>
        </thead>
        <tbody>
          {METRICS.map((m) => (
            <tr key={m.key}>
              <th title={m.better === 'lower' ? 'Lower is better' : 'Higher is better'}>
                {m.label} <span className="muted small"><Icon name={m.better === 'lower' ? 'arrow-down' : 'arrow-up'} /></span>
              </th>
              {r.variants.map((v, i) => (
                <td key={v.id} data-v={`${v.id.toUpperCase()} · ${v.name}`} style={{ ['--v' as string]: COLORS[i] }}>
                  {cell(v.metrics[m.key], m)}
                </td>
              ))}
              <td className="lab-ci-cell">
                <Intervals cells={r.variants.map((v) => v.metrics[m.key])} colors={COLORS} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExperimentCard({ e, repos }: { e: ExperimentView; repos: RepoView[] }) {
  const [busy, setBusy] = useState(false);
  const act = (action: 'start' | 'stop' | 'promote' | 'delete', variant?: string | null) => {
    setBusy(true);
    void api
      .experimentAction(e.id, action, variant)
      .catch(() => undefined) // api() already toasted the error
      .finally(() => setBusy(false));
  };
  // The evidence first: the verdict and the variant's numbers, then the one tap.
  const everyProject = async (v: ExperimentView['variants'][number]) => {
    const ok = await confirmDialog({
      title: `Make ${v.name} every project's default?`,
      icon: 'pin',
      body: (
        <>
          <p>
            Settings → Every project gets: <b>{describePractices(v.settings.practices ?? {})}</b>. Floors that override a switch keep their own.
          </p>
          <p className="small">The evidence: {e.result.summary}.</p>
          {e.result.winner !== v.id && (
            <p className="small">
              <Icon name="triangle-alert" /> The experiment hasn't shown {v.name} to be better yet.
            </p>
          )}
        </>
      ),
      confirm: 'Make it the default',
      tone: e.result.winner === v.id ? 'good' : 'warn',
    });
    if (!ok) return;
    setBusy(true);
    void api
      .everyProject(e.id, v.id)
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };
  const floors = e.floors.length ? e.floors.map((id) => `floor ${repos.find((r) => r.id === id)?.floor ?? id}`).join(', ') : 'every floor';
  const kinds = (e.kinds.length ? e.kinds : LAB_KINDS).map((k) => TASK_KIND_LABELS[k].replace(/^./, (c) => c.toLowerCase())).join(', ');
  const winner = e.result.winner ? e.variants.find((v) => v.id === e.result.winner) : null;
  return (
    <details className={`card lab-exp lab-${e.status}`} open={e.status === 'running'}>
      <summary>
        <b>{e.name}</b> <span className={`pill lab-pill-${e.status}`}>{STATUS[e.status]}</span>
        {e.promoted && <span className="pill lab-pill-promoted">{e.promoted.toUpperCase()} is the default</span>}
        <span className="muted small"> {e.assigned} issue{e.assigned === 1 ? '' : 's'}</span>
      </summary>
      <p className="small lab-hypo">{e.hypothesis}</p>
      <p className="muted small">
        On {floors}; changes {kinds}. A verdict needs {e.minSample} PRs per variant.{e.by === 'ceo' ? ' Proposed by the CEO.' : ''}
      </p>
      <ul className="lab-variants small">
        {e.variants.map((v, i) => (
          <li key={v.id}>
            <b style={{ color: COLORS[i] }}>
              {v.id.toUpperCase()} · {v.name}
              {i === 0 ? ' (control)' : ''}
            </b>{' '}
            <span className="muted">{describe(v.settings)}</span>
          </li>
        ))}
      </ul>
      {e.status !== 'draft' && (
        <>
          <p className="lab-verdict">{e.result.summary}.</p>
          <Results e={e} />
        </>
      )}
      <div className="row wrap lab-actions">
        {e.status === 'running' ? (
          <button className="btn btn-small" disabled={busy} onClick={() => act('stop')} title="New issues go back to the defaults; what's in it keeps its results">
            <Icon name="square" /> Stop
          </button>
        ) : (
          <button className="btn btn-small btn-good" disabled={busy} onClick={() => act('start')} title="New issues on its floors get a variant at random from now on">
            <Icon name="play" /> {e.status === 'stopped' ? 'Start again' : 'Start'}
          </button>
        )}
        {e.status === 'stopped' && (
          <label className="small lab-promote">
            Default:{' '}
            <select value={e.promoted ?? ''} disabled={busy} onChange={(ev) => act('promote', ev.target.value || null)}>
              <option value="">office defaults</option>
              {e.variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.id.toUpperCase()} · {v.name}
                  {winner?.id === v.id ? ' (the winner)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        {e.status === 'stopped' &&
          e.variants
            .filter((v) => v.settings.practices && Object.keys(v.settings.practices).length)
            .map((v) => (
              <button key={v.id} className="btn btn-small" disabled={busy} onClick={() => void everyProject(v)} title="Its practice switches become Settings → Every project's defaults">
                <Icon name="pin" /> {v.id.toUpperCase()} for every project
              </button>
            ))}
        {winner && e.status === 'running' && <span className="small muted">{winner.name} looks better: stop the experiment to make it the default.</span>}
        <span className="spacer" />
        {e.status !== 'running' && (
          <button className="btn btn-small btn-ghost" disabled={busy} onClick={() => act('delete')}>
            Delete
          </button>
        )}
      </div>
    </details>
  );
}

interface VariantDraft {
  name: string;
  prompt: string;
  qaLens: string;
  effort: EffortLevel | '';
  qaCli: AgentCli | '';
}

const blank = (name: string): VariantDraft => ({ name, prompt: '', qaLens: '', effort: '', qaCli: '' });

function NewExperiment({ repos }: { repos: RepoView[] }) {
  const [name, setName] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [floors, setFloors] = useState<string[]>([]);
  const [kinds, setKinds] = useState<TaskKind[]>([]);
  const [variants, setVariants] = useState<VariantDraft[]>([blank('Current'), blank('')]);
  const [busy, setBusy] = useState(false);
  const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);
  const edit = (i: number, patch: Partial<VariantDraft>) => setVariants((vs) => vs.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const submit = () => {
    const covered = kinds.length ? kinds : LAB_KINDS;
    const each = <T,>(v: T | '') => (v ? Object.fromEntries(covered.map((k) => [k, v])) : undefined);
    const input: ExperimentInput = {
      name,
      hypothesis,
      floors,
      kinds,
      variants: variants.map((v) => ({ name: v.name, settings: { prompt: v.prompt, qaLens: v.qaLens, effort: each(v.effort), qaCli: v.qaCli || undefined } })),
    };
    setBusy(true);
    void api
      .defineExperiment(input)
      .then(() => {
        setName('');
        setHypothesis('');
        setVariants([blank('Current'), blank('')]);
      })
      .catch(() => undefined) // toasted
      .finally(() => setBusy(false));
  };
  return (
    <details className="card lab-new">
      <summary>
        <b>＋ New experiment</b>
      </summary>
      <label className="field">
        <span>Name</span>
        <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Short plans vs none" />
      </label>
      <label className="field">
        <span>Hypothesis</span>
        <textarea rows={2} value={hypothesis} maxLength={600} onChange={(e) => setHypothesis(e.target.value)} placeholder="What should change, and on which numbers" />
      </label>
      <fieldset className="lab-checks small">
        <legend>Floors (none ticked: every floor)</legend>
        {repos.map((r) => (
          <label key={r.id}>
            <input type="checkbox" checked={floors.includes(r.id)} onChange={() => setFloors((f) => toggle(f, r.id))} /> {r.floor} · {r.fullName.split('/')[1]}
          </label>
        ))}
      </fieldset>
      <fieldset className="lab-checks small">
        <legend>Sessions it changes (none ticked: all of them)</legend>
        {LAB_KINDS.map((k) => (
          <label key={k}>
            <input type="checkbox" checked={kinds.includes(k)} onChange={() => setKinds((ks) => toggle(ks, k))} /> {TASK_KIND_LABELS[k]}
          </label>
        ))}
      </fieldset>
      {variants.map((v, i) => (
        <fieldset key={i} className="lab-variant">
          <legend style={{ color: COLORS[i] }}>
            {String.fromCharCode(65 + i)}
            {i === 0 ? ' · the control' : ''}
          </legend>
          <input aria-label="Variant name" value={v.name} maxLength={40} onChange={(e) => edit(i, { name: e.target.value })} placeholder="Name" />
          <textarea aria-label="Added to build and fix instructions" rows={2} value={v.prompt} maxLength={1500} onChange={(e) => edit(i, { prompt: e.target.value })} placeholder="Added to build and fix instructions (optional)" />
          <textarea aria-label="Added to QA instructions" rows={1} value={v.qaLens} maxLength={1500} onChange={(e) => edit(i, { qaLens: e.target.value })} placeholder="Added to QA instructions (optional)" />
          <div className="row wrap small">
            <label>
              Effort{' '}
              <select value={v.effort} onChange={(e) => edit(i, { effort: e.target.value as EffortLevel | '' })}>
                <option value="">default</option>
                {EFFORTS.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              QA by{' '}
              <select value={v.qaCli} onChange={(e) => edit(i, { qaCli: e.target.value as AgentCli | '' })}>
                <option value="">anyone</option>
                <option value="claude">Claude Code agents</option>
                <option value="codex">Codex agents</option>
                <option value="opencode">OpenCode agents</option>
              </select>
            </label>
            {i > 1 && (
              <button className="btn btn-small btn-ghost" onClick={() => setVariants((vs) => vs.filter((_, j) => j !== i))}>
                Remove
              </button>
            )}
          </div>
        </fieldset>
      ))}
      <div className="row wrap">
        {variants.length < 4 && (
          <button className="btn btn-small btn-ghost" onClick={() => setVariants((vs) => [...vs, blank('')])}>
            ＋ Variant
          </button>
        )}
        <span className="spacer" />
        <button className="btn btn-small btn-good" disabled={busy || !name.trim() || !hypothesis.trim()} onClick={submit}>
          Save as draft
        </button>
      </div>
    </details>
  );
}

export function ExperimentsSection() {
  const lab = useStore((s) => s.experiments);
  const repos = useStore((s) => s.repos);
  const order = { running: 0, stopped: 1, draft: 2 };
  const list = [...lab.experiments].sort((a, b) => order[a.status] - order[b.status]);
  return (
    <div id="ops-card-experiments" className="lab">
      <h3 className="section">
        <Icon name="flask-conical" /> Experiments
      </h3>
      <p className="muted small">
        A running experiment gives each new issue on its floors a variant at random, balanced by floor and issue size, and its sessions run with it. Agents aren't told. Only you start, stop and promote one.
      </p>
      {list.length === 0 && <EmptyState kind="experiments" compact />}
      {list.map((e) => (
        <ExperimentCard key={e.id} e={e} repos={repos} />
      ))}
      <NewExperiment repos={repos} />
    </div>
  );
}

/** A Kanban card's variant, while its experiment runs: "🧪 B". */
export function LabChip({ repoId, issue, pr }: { repoId: string; issue: number | null; pr: number | null }) {
  const lab = useStore((s) => s.experiments);
  const tag: LabTag | undefined = lab.tags.find((t) => t.repoId === repoId && ((issue !== null && t.issue === issue) || (pr !== null && t.pr === pr)));
  if (!tag) return null;
  const e = lab.experiments.find((x) => x.id === tag.experimentId);
  const v = e?.variants.find((x) => x.id === tag.variantId);
  return (
    <span className="chip lab-chip" title={`${e?.name ?? 'Experiment'}: ${v?.name ?? tag.variantId}`}>
      <Icon name="flask-conical" /> {tag.variantId.toUpperCase()}
    </span>
  );
}
