// The Previews page (#226): every floor's live app and PR previews on one page, from the menu. A list on the left (a
// sheet on a phone or beside a docked chat) grouped as Running now, By project, By agent and By PR, with plain status
// words, a search and filter chips; the picked preview on the right in the app viewer's stage. The address follows
// what's picked (#previews/<floor>/<main|pr-N>). The lists are pure, in previewGroups.ts.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { AppViewer } from './AppViewer';
import { Icon } from './Icon';
import { stopsLabel } from './channels';
import { Panel } from './Panel';
import { Sheet } from './Sheet';
import { ago, FILTERS, parsePreviewsHash, previewLists, previewsHash, previewsStats, rowMatches, type PreviewFilter, type PreviewRow } from './previewGroups';
import './previews.css';

/** Narrower than this, the list is a sheet and the stage has the page. */
const LIST_BESIDE_PX = 760;

/** Re-render every 30 s, for "12 min" and "stops in N min". */
function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Whether `ref`'s box is narrower than `px` (the page is beside a docked chat, or on a phone). */
function useNarrower(px: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(() => typeof innerWidth === 'number' && innerWidth < px);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < px));
    ro.observe(el);
    return () => ro.disconnect();
  }, [px]);
  return { ref, narrow };
}

const wordClass = (w: string) => `pv-word pv-word-${w.toLowerCase().replace(/\s+/g, '-')}`;

function Row({ r, on, pick, meta, now }: { r: PreviewRow; on: boolean; pick: (r: PreviewRow) => void; meta?: ReactNode; now: number }) {
  const up = r.led === 'live' || r.led === 'busy';
  const stops = r.led === 'live' ? stopsLabel(r.stopsAt, now) : '';
  return (
    <li>
      <button className={`pv-row ${on ? 'pv-row-on' : ''}`} aria-current={on || undefined} onClick={() => pick(r)}>
        <span className={`led led-${r.led}`} aria-hidden />
        <span className="pv-row-text">
          <span className="pv-row-title">{r.title}</span>
          <span className="pv-row-meta small">
            {meta ?? (r.pr == null ? `Floor ${r.floor} · ${r.project}` : `PR #${r.pr} · ${r.project}`)}
            {up && r.startedAt != null && ` · up ${ago(r.startedAt, now)}`}
            {stops && ` · ${stops}`}
            {r.led === 'bad' && ' · didn’t start'}
          </span>
        </span>
        {r.word && <span className={wordClass(r.word)}>{r.word}</span>}
      </button>
    </li>
  );
}

function Group({ title, count, open, children }: { title: string; count: number; open?: boolean; children: ReactNode }) {
  return (
    <details className="pv-group" open={open}>
      <summary className="pv-group-head">
        {title} <span className="muted">({count})</span>
      </summary>
      {count ? <ul className="pv-rows">{children}</ul> : <p className="muted small pv-none">Nothing here.</p>}
    </details>
  );
}

/** The grouped list, its search and filter chips. */
function PreviewList({ selected, first, pick, now }: { selected: string | null; first: string | null; pick: (r: PreviewRow) => void; now: number }) {
  const repos = useStore((s) => s.repos);
  const agentMap = useStore((s) => s.agents);
  const prPreviews = useStore((s) => s.prPreviews);
  const qa = useStore((s) => s.qa);
  const recentHours = useStore((s) => s.settings.previewRecentHours);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Set<PreviewFilter>>(new Set());
  const [showOlder, setShowOlder] = useState(false);
  const agents = useMemo(() => Object.values(agentMap), [agentMap]);
  const lists = previewLists({ repos, agents, prPreviews, qa, now, recentHours, current: selected, first }, showOlder);
  const ok = (r: PreviewRow) => rowMatches(r, filters, query);
  const toggle = (f: PreviewFilter) =>
    setFilters((s) => {
      const n = new Set(s);
      if (!n.delete(f)) n.add(f);
      return n;
    });
  const running = lists.running.filter(ok);
  const projects = lists.projects.map((p) => ({ ...p, rows: p.rows.filter(ok) })).filter((p) => p.rows.length);
  const agentRows = lists.agents.filter((a) => ok(a.row));
  const prs = lists.prs.filter(ok);
  const row = (r: PreviewRow, key = r.key, meta?: ReactNode) => <Row key={key} r={r} on={r.key === selected} pick={pick} meta={meta} now={now} />;
  return (
    <div className="pv-list">
      <input type="search" className="pv-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search previews" aria-label="Search previews" />
      <div className="pv-chips" role="group" aria-label="Filters">
        {FILTERS.map(([f, label]) => (
          <button key={f} className={`pv-chip ${filters.has(f) ? 'pv-chip-on' : ''}`} aria-pressed={filters.has(f)} onClick={() => toggle(f)}>
            {label}
          </button>
        ))}
      </div>
      <Group title="Running now" count={running.length} open>
        {running.map((r) => row(r, `run:${r.key}`))}
      </Group>
      <Group title="By project" count={projects.reduce((n, p) => n + p.rows.length, 0)} open>
        {projects.map((p) => (
          <li key={p.repo.id} className="pv-project">
            <div className="pv-project-head small" style={{ ['--accent' as string]: p.repo.color }}>
              <span className="floor-badge">{p.repo.floor}</span> {p.repo.fullName.split('/')[1]}
            </div>
            <ul className="pv-rows">{p.rows.map((r) => row(r, `proj:${r.key}`, r.pr == null ? `Floor ${r.floor}` : `PR #${r.pr}`))}</ul>
          </li>
        ))}
      </Group>
      <Group title="By agent" count={agentRows.length}>
        {agentRows.map((a) => row(a.row, `agent:${a.id}`, `@${a.name} · ${a.doing}`))}
      </Group>
      <Group title="By PR" count={prs.length}>
        {prs.map((r) => row(r, `pr:${r.key}`))}
      </Group>
      {lists.older > 0 && (
        <button className="btn btn-small btn-ghost pv-older" aria-expanded={showOlder} onClick={() => setShowOlder((v) => !v)}>
          {showOlder ? 'Hide older' : `Show older (${lists.older})`}
        </button>
      )}
    </div>
  );
}

/** Running 1/2 PR slots · live apps up · last started. */
function StatsBar({ now }: { now: number }) {
  const repos = useStore((s) => s.repos);
  const prPreviews = useStore((s) => s.prPreviews);
  const st = previewsStats(repos, prPreviews);
  return (
    <div className="pv-stats small" role="status" aria-label="Previews at a glance">
      <span className="chip">
        PR slots {st.used}/{st.slots}
      </span>
      <span className="chip">
        {st.mainUp} live app{st.mainUp === 1 ? '' : 's'} up
      </span>
      <span className="chip">Last started {st.lastStarted == null ? '—' : st.lastStarted >= now - 60_000 ? 'just now' : `${ago(st.lastStarted, now)} ago`}</span>
    </div>
  );
}

/** The page. `repoId`/`pr`: what to show first (a floor card, a tile or a link); else the first running preview, else floor 1's live app. */
export function PreviewsPage({ repoId, pr, qa, merged, path }: { repoId?: string; pr?: number | null; qa?: boolean; merged?: { pr: number; sha: string; path: string }; path?: string }) {
  const repos = useStore((s) => s.repos);
  const prPreviews = useStore((s) => s.prPreviews);
  const runningPr = Object.values(prPreviews).find((x) => x.status === 'running');
  const runningMain = repos.find((x) => x.preview.status === 'running');
  const firstRunning = runningPr ? { repoId: runningPr.repoId, pr: runningPr.pr as number | null } : runningMain ? { repoId: runningMain.id, pr: null } : null;
  const [pick, setPick] = useState<{ repoId: string; pr: number | null } | null>(repoId ? { repoId, pr: pr ?? null } : null);
  const [sheet, setSheet] = useState(false);
  const now = useNow();
  const { ref, narrow } = useNarrower(LIST_BESIDE_PX);
  const fallback = firstRunning ?? (repos[0] ? { repoId: repos[0].id, pr: null } : null);
  const shown = pick && repos.some((r) => r.id === pick.repoId) ? pick : fallback;
  // what it opened on stays on stage while other previews start and stop
  useEffect(() => {
    if (!pick && fallback) setPick(fallback);
  }, [pick, fallback?.repoId, fallback?.pr]); // eslint-disable-line react-hooks/exhaustive-deps
  const repo = shown && repos.find((r) => r.id === shown.repoId);
  const selected = shown ? (shown.pr == null ? `${shown.repoId}:main` : `${shown.repoId}:pr-${shown.pr}`) : null;
  // What the page opened on leads Running now until it reopens; picks light up in place (#414).
  const [first] = useState(() => selected);

  // The address says what's on stage; it goes back when the page closes.
  useEffect(() => {
    history.replaceState(history.state, '', previewsHash(repo?.floor ?? null, shown?.pr ?? null));
  }, [repo?.floor, shown?.pr]);
  useEffect(
    () => () => {
      // Esc and × close it before the panel's history entry is popped, landing on the entry it opened over, which
      // can carry a #previews address too (a deep link, or one written before the panel's entry was pushed).
      const clear = () => void (parsePreviewsHash(location.hash) && history.replaceState(history.state, '', location.pathname + location.search));
      clear();
      addEventListener('popstate', clear, { once: true });
      setTimeout(() => removeEventListener('popstate', clear), 1000);
    },
    [],
  );

  const choose = (r: PreviewRow) => {
    setPick({ repoId: r.repoId, pr: r.pr });
    setSheet(false);
  };
  const list = <PreviewList selected={selected} first={first} pick={choose} now={now} />;
  const name = repo && (shown?.pr == null ? `${repo.fullName.split('/')[1]} · live app` : `${repo.fullName.split('/')[1]} · PR #${shown.pr}`);
  return (
    <Panel
      wide
      title={
        <>
          <Icon name="monitor" /> Previews
        </>
      }
      className="panel-previews"
    >
      <div className="pv" ref={ref}>
        <div className="pv-top">
          {narrow && (
            <button className="btn btn-small pv-open-list" aria-haspopup="dialog" aria-label={name ? `All previews (showing ${name})` : 'All previews'} onClick={() => setSheet(true)}>
              <span className="pv-open-name">{name ?? 'All previews'}</span> <Icon name="chevron-down" />
            </button>
          )}
          {!narrow && <StatsBar now={now} />}
        </div>
        <div className={`pv-split ${narrow ? 'pv-split-narrow' : ''}`}>
          {!narrow && (
            <aside className="pv-side" aria-label="Previews list">
              {list}
            </aside>
          )}
          <div className="pv-stage">
            {repo && shown ? (
              <AppViewer key={repo.id} repoId={repo.id} pr={shown.pr} qa={qa && shown.repoId === repoId && shown.pr === (pr ?? null)} merged={shown.repoId === repoId && shown.pr == null ? merged : undefined} path={shown.repoId === repoId && shown.pr === (pr ?? null) ? path : undefined} bare />
            ) : (
              <p className="muted pv-empty">No projects yet: move one in from Floors &amp; repos and its live app shows here.</p>
            )}
          </div>
        </div>
        {narrow && sheet && (
          <Sheet title={name ? `Previews · ${name}` : 'Previews'} onClose={() => setSheet(false)} className="pv-sheet">
            <StatsBar now={now} />
            {list}
          </Sheet>
        )}
      </div>
    </Panel>
  );
}
