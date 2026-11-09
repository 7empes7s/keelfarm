// Company → Memory map (#136): the company and its projects as a graph you can explore, like Obsidian's graph view.
// Built in the tab from the snapshot and the live events (shared/memoryMap.ts), so it changes as the office does.
// Search, filters, colour groups, a local graph 1-3 links deep, insight cards, a time slider to replay how it grew,
// and a card per node with what it links to and what to open. Loaded when first opened; the canvas is MapCanvas.tsx.
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { CEO_ID } from '../../../shared/types';
import { buildGraph, DEFAULT_CAPS, filterGraph, localIds, mapChanges, mapInsights, neighbours, NODE_TYPES, searchNodes, type MapChange, type MapEdgeKind, type MapInsight, type MapNode, type MapNodeType, type MapStatus, type MapTarget, type MemoryGraph } from '../../../shared/memoryMap';
import { useStore } from '../store';
import { useMode } from '../pocket/mode';
import { useA11y } from './a11y';
import { kindStrong, type StatusKind } from './statusLook';
import { jumpFor } from './chatRefs';
import { ArtifactView, Sheet } from './ChatArtifacts';
import { sendToCeo } from './chatSend';
import { MapCanvas, type MapPaint, type MapStageProps } from './MapCanvas';
import { MapViewSwitch, Stage3d, useMapView } from './MapViewSwitch';
import './memoryMap.css';
import { CloseButton, Icon } from './Icon';
import { iconFor } from './icons';

const TYPE_LOOK: Record<MapNodeType, [string, string]> = {
  company: ['#ff9f1c', 'Company'],
  floor: ['#ffbf69', 'Floors'],
  objective: ['#ffd166', 'Objectives'],
  standard: ['#ced4da', 'Standards'],
  issue: ['#8fb3ff', 'Issues'],
  pr: ['#80ed99', 'PRs'],
  qa: ['#c77dff', 'QA rounds'],
  agent: ['#4cc9f0', 'Agents'],
  ceo: ['#ff6b6b', 'The CEO'],
  decision: ['#f4a261', 'Decisions'],
  artifact: ['#e9c46a', 'Artifacts'],
  file: ['#adb5bd', 'Files'],
  experiment: ['#06d6a0', 'Experiments'],
};
const GROUP_COLOURS = ['#ffd166', '#80ed99', '#ff8fa3', '#8fb3ff', '#c77dff', '#4cc9f0', '#f4a261', '#06d6a0'];
const NONE = '#e9ecef';
const RING: Record<MapStatus, StatusKind | null> = { open: null, idle: null, closed: 'idle', building: 'busy', working: 'busy', fixing: 'busy', qa: 'waiting', ready: 'ok', merged: 'ok', failed: 'bad' };
const STATUSES: MapStatus[] = ['open', 'building', 'qa', 'fixing', 'ready', 'merged', 'failed', 'closed', 'working'];
const ALL_CAPS = { sinceDays: 3650, maxNodes: 1500 };
const PLAY_MS = 8000;

type ColourBy = 'type' | 'floor' | 'objective';
interface Filters {
  hiddenTypes: MapNodeType[];
  repoId: string | null;
  objective: string | null;
  agentId: string | null;
  status: MapStatus | null;
}
const NO_FILTERS: Filters = { hiddenTypes: [], repoId: null, objective: null, agentId: null, status: null };
const activeFilters = (f: Filters) => f.hiddenTypes.length + [f.repoId, f.objective, f.agentId, f.status].filter(Boolean).length;
const groupColour = (key: string) => GROUP_COLOURS[[...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % GROUP_COLOURS.length];
const dayLabel = (t: number) => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' });

/** The world the map is built from, from the store. */
function useGraph(older: boolean): MemoryGraph {
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const qa = useStore((s) => s.qa);
  const messages = useStore((s) => s.messages);
  const experiments = useStore((s) => s.experiments);
  const company = useStore((s) => s.settings.companyName);
  return useMemo(
    () => buildGraph({ now: Date.now(), company, repos, agents: Object.values(agents), qa: Object.values(qa), messages, experiments }, older ? ALL_CAPS : DEFAULT_CAPS),
    [repos, agents, qa, messages, experiments, company, older],
  );
}

/**
 * `Stage`: what draws the graph (the map room passes its 3D constellation), with everything else shared. Without
 * one the bar's 2D / 3D switch picks the 2D canvas or the constellation (#314). `action`: the bar's last button (the
 * map room's way back to 2D); otherwise the switch, and in the 3D office a button that walks into the map room.
 */
export function MemoryMap({ Stage, action }: { Stage?: ComponentType<MapStageProps>; action?: ReactNode }) {
  const office = useMode((s) => s.mode === 'office');
  const mapView = useMapView();
  const StageNow = Stage ?? (mapView.view === '3d' ? Stage3d : MapCanvas);
  const [older, setOlder] = useState(false);
  const graph = useGraph(older);
  const repos = useStore((s) => s.repos);
  const palette = useA11y((s) => s.prefs.palette);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [colourBy, setColourBy] = useState<ColourBy>('type');
  const [until, setUntil] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [local, setLocal] = useState<{ id: string; depth: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [insight, setInsight] = useState<MapInsight | null>(null);
  const [sheet, setSheet] = useState<'filters' | 'node' | null>(null);
  const [artifact, setArtifact] = useState<{ messageId: number; artifactId: string } | null>(null);
  const [query, setQuery] = useState('');
  const [centre, setCentre] = useState<{ id: string; at: number } | null>(null);

  // live changes pulse: what this build has that the last one didn't (not when "show older" brings in the past)
  const last = useRef<{ graph: MemoryGraph; older: boolean } | null>(null);
  const [pulses, setPulses] = useState<{ changes: MapChange[]; at: number }>({ changes: [], at: 0 });
  useEffect(() => {
    const prev = last.current?.older === older ? last.current.graph : null;
    last.current = { graph, older };
    const changes = mapChanges(prev, graph);
    if (changes.length) setPulses({ changes, at: Date.now() });
  }, [graph, older]);

  const shown = useMemo(() => filterGraph(graph, { ...filters, until, local }), [graph, filters, until, local]);
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const node = selected ? (byId.get(selected) ?? null) : null;
  useEffect(() => {
    if (selected && !byId.has(selected)) setSelected(null);
  }, [byId, selected]);
  const lit = useMemo(() => (selected && shown.nodes.some((n) => n.id === selected) ? localIds(shown, selected, 1) : insight ? new Set(insight.ids) : null), [selected, shown, insight]);
  const insights = useMemo(() => mapInsights(graph, Date.now()), [graph]);
  const hits = useMemo(() => searchNodes(graph, query), [graph, query]);

  const repoColour = useMemo(() => new Map(repos.map((r) => [r.id, r.color])), [repos]);
  const paint = useMemo<MapPaint>(
    () => ({
      fill: (n) => (colourBy === 'type' ? TYPE_LOOK[n.type][0] : colourBy === 'floor' ? ((n.repoId && repoColour.get(n.repoId)) ?? NONE) : n.objective ? groupColour(n.objective) : n.type === 'company' ? TYPE_LOOK.company[0] : NONE),
      ring: (n) => (n.status && RING[n.status] ? kindStrong(RING[n.status]!, palette) : null),
      byType: colourBy === 'type',
    }),
    [colourBy, repoColour, palette],
  );

  // the time slider: from the first thing the map knows to now
  const first = useMemo(() => Math.min(Date.now() - 86_400_000, ...graph.nodes.filter((n) => n.at > 0).map((n) => n.at)), [graph]);
  useEffect(() => {
    if (!playing) return;
    const start = performance.now();
    const span = Date.now() - first;
    const id = setInterval(() => {
      const t = (performance.now() - start) / PLAY_MS;
      if (t >= 1) {
        setUntil(null);
        setPlaying(false);
      } else setUntil(first + span * t);
    }, 100);
    return () => clearInterval(id);
  }, [playing, first]);

  const select = (id: string | null) => {
    setSelected(id);
    if (id) setInsight(null);
  };
  const pick = (n: MapNode) => {
    setQuery('');
    // bring it into view: drop the filters that hide it
    if (!shown.nodes.some((x) => x.id === n.id)) {
      setFilters(NO_FILTERS);
      setLocal(null);
      setUntil(null);
    }
    select(n.id);
    setCentre({ id: n.id, at: Date.now() });
  };
  const legend: [string, string, MapNodeType | null][] =
    colourBy === 'type'
      ? NODE_TYPES.filter((t) => graph.nodes.some((n) => n.type === t)).map((t) => [TYPE_LOOK[t][0], TYPE_LOOK[t][1], t])
      : colourBy === 'floor'
        ? repos.map((r) => [r.color, `${r.floor} · ${r.fullName.split('/')[1]}`, null])
        : [...[...new Set(graph.nodes.map((n) => n.objective).filter((o): o is string => !!o))].sort().map((o): [string, string, null] => [groupColour(o), o, null]), [NONE, 'No objective', null]];
  const toggleType = (t: MapNodeType) => setFilters((f) => ({ ...f, hiddenTypes: f.hiddenTypes.includes(t) ? f.hiddenTypes.filter((x) => x !== t) : [...f.hiddenTypes, t] }));
  const nFilters = activeFilters(filters);

  return (
    <div className={`mm ${StageNow === MapCanvas ? '' : 'mm-3d'}`}>
      <div className="mm-bar">
        <div className="mm-search">
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search #12, a title, a name" aria-label="Search the map" enterKeyHint="search" onKeyDown={(e) => e.key === 'Enter' && hits[0] && pick(hits[0])} />
          {query.trim() && (
            <ul className="mm-hits" role="listbox" aria-label="Matches">
              {hits.length === 0 && <li className="muted small mm-hit-none">Nothing on the map matches.</li>}
              {hits.map((n) => (
                <li key={n.id}>
                  <button type="button" role="option" aria-selected={false} className="mm-hit" onClick={() => pick(n)}>
                    <span className="mm-dot" style={{ background: TYPE_LOOK[n.type][0] }} aria-hidden />
                    <span className="grow mm-ellipsis">{n.title}</span>
                    <span className="muted small">{TYPE_LOOK[n.type][1]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="button" className="btn mm-filter-btn" onClick={() => setSheet('filters')} aria-label={`Filters and groups${nFilters ? `, ${nFilters} on` : ''}`}>
          <Icon name="sliders-horizontal" /> Filters{nFilters > 0 && <span className="badge">{nFilters}</span>}
        </button>
        {action ?? (
          <>
            <MapViewSwitch view={mapView.view} onChoose={mapView.choose} />
            {office && (
              <button type="button" className="btn mm-filter-btn" onClick={() => useStore.getState().openOverlay({ kind: 'mapRoom' })} aria-label="Walk into the map room" title="Walk into the map room">
                <Icon name="orbit" />
              </button>
            )}
          </>
        )}
      </div>
      {!action && mapView.note && (
        <p className="muted small mm-note" role="status">
          {mapView.note}
        </p>
      )}

      <div className="mm-insights" role="group" aria-label="Insights">
        {insights.map((i) => (
          <button key={i.id} type="button" className={`mm-insight ${insight?.id === i.id ? 'mm-insight-on' : ''}`} aria-pressed={insight?.id === i.id} disabled={!i.ids.length} onClick={() => (setSelected(null), setInsight(insight?.id === i.id ? null : i))}>
            <span className="mm-insight-label">
              <Icon name={iconFor(i.icon, 'info')} /> {i.label}
            </span>
            <b className="mm-insight-value mm-ellipsis">{i.value}</b>
          </button>
        ))}
      </div>

      <div className="mm-stage">
        <StageNow graph={shown} paint={paint} selected={selected} lit={lit} pulses={pulses} centre={centre} onSelect={select} onMenu={(id) => (select(id), setSheet('node'))} />
        <div className="mm-stats small" aria-live="polite">
          {shown.nodes.length} things · {shown.edges.length} links
          {local && byId.get(local.id) && <> · around {byId.get(local.id)!.label}</>}
        </div>
        {local && (
          <div className="mm-local" role="group" aria-label="Local graph depth">
            <span className="small">Depth</span>
            {[1, 2, 3].map((d) => (
              <button key={d} type="button" className={`mm-seg ${local.depth === d ? 'mm-seg-on' : ''}`} aria-pressed={local.depth === d} onClick={() => setLocal({ ...local, depth: d })}>
                {d}
              </button>
            ))}
            <button type="button" className="mm-seg" aria-label="Show the whole map" onClick={() => setLocal(null)}>
              <Icon name="x" />
            </button>
          </div>
        )}
        {node && sheet !== 'node' && <Peek node={node} local={local} onLocal={() => setLocal(local?.id === node.id ? null : { id: node.id, depth: local?.depth ?? 1 })} onDetails={() => setSheet('node')} onClose={() => setSelected(null)} onOpen={(t) => openTarget(t, setArtifact, (repoId) => setFilters((f) => ({ ...f, repoId })))} />}
      </div>

      <div className="mm-time">
        <button type="button" className="btn btn-small mm-play" onClick={() => (playing ? setPlaying(false) : (setUntil(first), setPlaying(true)))} aria-label={playing ? 'Pause the replay' : 'Replay how the map grew'}>
          <Icon name={playing ? 'pause' : 'play'} />
        </button>
        <input type="range" min={first} max={Date.now()} step={3_600_000} value={until ?? Date.now()} aria-label="Show the map as it was on" aria-valuetext={until ? dayLabel(until) : 'now'} onChange={(e) => (setPlaying(false), setUntil(Number(e.target.value) >= Date.now() - 3_600_000 ? null : Number(e.target.value)))} />
        <span className="small mm-time-label">{until ? dayLabel(until) : 'Now'}</span>
      </div>

      <ul className="mm-legend" aria-label="Colours">
        {legend.map(([colour, label, type]) => (
          <li key={label}>
            {type ? (
              <button type="button" className={`mm-key ${filters.hiddenTypes.includes(type) ? 'mm-key-off' : ''}`} aria-pressed={!filters.hiddenTypes.includes(type)} onClick={() => toggleType(type)} title={`Show or hide ${label.toLowerCase()}`}>
                <span className="mm-dot" style={{ background: colour }} aria-hidden /> {label}
              </button>
            ) : (
              <span className="mm-key">
                <span className="mm-dot" style={{ background: colour }} aria-hidden /> {label}
              </span>
            )}
          </li>
        ))}
      </ul>
      {graph.hidden > 0 && !older && (
        <button type="button" className="btn btn-ghost btn-small" onClick={() => setOlder(true)}>
          Show older work ({graph.hidden} more)
        </button>
      )}

      {sheet === 'filters' && <FiltersSheet graph={graph} filters={filters} setFilters={setFilters} colourBy={colourBy} setColourBy={setColourBy} older={older} setOlder={setOlder} onClose={() => setSheet(null)} />}
      {sheet === 'node' && node && (
        <NodeSheet
          node={node}
          graph={graph}
          onClose={() => setSheet(null)}
          onGo={(id) => (setSheet(null), pick(byId.get(id)!))}
          onLocal={(depth) => (setSheet(null), setLocal({ id: node.id, depth }))}
          onOpen={(t) => (setSheet(null), openTarget(t, setArtifact, (repoId) => setFilters((f) => ({ ...f, repoId }))))}
        />
      )}
      {artifact && <MapArtifact {...artifact} onClose={() => setArtifact(null)} />}
    </div>
  );
}

// ---------- opening what a node is ----------

function openTarget(t: MapTarget, artifact: (a: { messageId: number; artifactId: string }) => void, floor: (repoId: string) => void) {
  const s = useStore.getState();
  if (t.kind === 'artifact') return artifact({ messageId: t.messageId, artifactId: t.artifactId });
  if (t.kind === 'floor') return floor(t.repoId);
  if (t.kind === 'agent') return s.openOverlay(t.agentId === CEO_ID ? { kind: 'phone', tab: 'chat' } : { kind: 'terminal', agentId: t.agentId });
  const j = jumpFor({ kind: 'issue', repoId: t.repoId, number: t.number, start: 0, end: 0 }, useMode.getState().mode === 'pocket' ? 'pocket' : 'office', s);
  if (j?.kind === 'overlay') s.openOverlay(j.overlay);
  else if (j?.kind === 'url') window.open(j.url, '_blank', 'noopener,noreferrer');
}

const OPEN_LABEL: Record<MapTarget['kind'], string> = { issue: 'Open the card', agent: 'Open their window', floor: 'Only this floor', artifact: 'Read it' };

function openLabel(n: MapNode) {
  if (!n.target) return null;
  return n.type === 'ceo' ? 'Open the chat' : OPEN_LABEL[n.target.kind];
}

/** The selected node, small, over the bottom of the map (like a place card in Maps). */
function Peek({ node, local, onLocal, onDetails, onClose, onOpen }: { node: MapNode; local: { id: string } | null; onLocal: () => void; onDetails: () => void; onClose: () => void; onOpen: (t: MapTarget) => void }) {
  const open = openLabel(node);
  return (
    <div className="mm-peek" role="region" aria-label={node.title}>
      <div className="mm-peek-head">
        <span className="mm-dot" style={{ background: TYPE_LOOK[node.type][0] }} aria-hidden />
        <b className="grow mm-ellipsis">{node.title}</b>
        <CloseButton className="mm-x" label="Clear the selection" onClick={onClose} />
      </div>
      <div className="muted small mm-ellipsis">{[node.status, ...node.facts.slice(0, 2).map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join(' · ')}</div>
      <div className="mm-peek-actions">
        <button type="button" className="btn btn-small" onClick={onDetails}>
          Details
        </button>
        <button type="button" className="btn btn-small" aria-pressed={local?.id === node.id} onClick={onLocal}>
          {local?.id === node.id ? 'Whole map' : 'Local graph'}
        </button>
        {open && node.target && (
          <button type="button" className="btn btn-small btn-good" onClick={() => onOpen(node.target!)}>
            {open}
          </button>
        )}
      </div>
    </div>
  );
}

const EDGE_WORDS: Record<MapEdgeKind, string> = {
  'part-of': 'Part of',
  serves: 'Serves',
  closes: 'Closes',
  depends: 'Waits for',
  built: 'Built',
  tested: 'Tested',
  fixed: 'Fixed',
  round: 'QA of',
  merged: 'Merged into',
  filed: 'Filed',
  decided: 'Decided',
  mentions: 'Mentions',
  touches: 'Changes',
  overlap: 'Same files as',
  trial: 'Tries out on',
};

/** What to call a node in a message to the CEO: the chat turns "floor 2 #12" and "@Ada" into chips. */
function askText(n: MapNode, floorOf: (repoId: string) => number | undefined) {
  if (n.target?.kind === 'issue') return `About floor ${floorOf(n.target.repoId)} #${n.target.number} (${n.title.replace(/^(PR )?#\d+ /, '')}): `;
  if (n.target?.kind === 'agent' && n.type !== 'ceo') return `About @${n.label}: `;
  return `About “${n.title}”: `;
}

/** A node's card: its facts, what it links to (tap to go there) and what to do with it. */
function NodeSheet({ node, graph, onClose, onGo, onLocal, onOpen }: { node: MapNode; graph: MemoryGraph; onClose: () => void; onGo: (id: string) => void; onLocal: (depth: number) => void; onOpen: (t: MapTarget) => void }) {
  const repos = useStore((s) => s.repos);
  const floorOf = (repoId: string) => repos.find((r) => r.id === repoId)?.floor;
  const [ask, setAsk] = useState(() => askText(node, floorOf));
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const links = graph.edges
    .filter((e) => e.source === node.id || e.target === node.id)
    .map((e) => ({ kind: e.kind, out: e.source === node.id, other: byId.get(e.source === node.id ? e.target : e.source) }))
    .filter((l): l is { kind: MapEdgeKind; out: boolean; other: MapNode } => !!l.other)
    .sort((a, b) => b.other.weight - a.other.weight);
  const near = neighbours(graph).get(node.id)?.size ?? 0;
  const open = openLabel(node);
  return (
    <Sheet label={`${TYPE_LOOK[node.type][1].replace(/s$/, '')} · ${node.title}`} onClose={onClose} className="mm-sheet">
      <div className="artifact-body">
        <dl className="mm-facts">
          {node.status && (
            <div className="mm-fact">
              <dt>Status</dt>
              <dd>{node.status}</dd>
            </div>
          )}
          {node.facts.map(([k, v]) => (
            <div key={k} className="mm-fact">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
          <div className="mm-fact">
            <dt>Links</dt>
            <dd>{near}</dd>
          </div>
        </dl>
        <h3 className="mm-sheet-head">Linked to</h3>
        {links.length === 0 && <p className="muted small">Nothing yet.</p>}
        <ul className="mm-links">
          {links.slice(0, 24).map((l) => (
            <li key={`${l.kind}-${l.other.id}`}>
              <button type="button" className="mm-link" onClick={() => onGo(l.other.id)}>
                <span className="mm-dot" style={{ background: TYPE_LOOK[l.other.type][0] }} aria-hidden />
                <span className="muted small mm-link-kind">{l.out ? (
                    EDGE_WORDS[l.kind]
                  ) : (
                    <>
                      <Icon name="arrow-left" /> {EDGE_WORDS[l.kind]}
                    </>
                  )}</span>
                <span className="grow mm-ellipsis">{l.other.title}</span>
                <Icon name="chevron-right" />
              </button>
            </li>
          ))}
        </ul>
        <h3 className="mm-sheet-head">Ask the CEO about it</h3>
        <form
          className="mm-ask"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ask.trim()) return;
            sendToCeo(ask.trim());
            useStore.getState().pushToast('success', 'Sent to the CEO');
            onClose();
          }}
        >
          <textarea value={ask} onChange={(e) => setAsk(e.target.value)} rows={2} aria-label="Your message to the CEO" />
          <button type="submit" className="btn btn-small" disabled={!ask.trim()}>
            <Icon name="message-circle" /> Send
          </button>
        </form>
      </div>
      <div className="artifact-actions">
        {open && node.target && (
          <button type="button" className="btn btn-small btn-good" onClick={() => onOpen(node.target!)}>
            {open}
          </button>
        )}
        {[1, 2, 3].map((d) => (
          <button key={d} type="button" className="btn btn-small" onClick={() => onLocal(d)}>
            Local graph · {d}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function MapArtifact({ messageId, artifactId, onClose }: { messageId: number; artifactId: string; onClose: () => void }) {
  const artifact = useStore((s) => s.messages.find((m) => m.id === messageId)?.artifacts?.find((a) => a.id === artifactId));
  if (!artifact) return null;
  return <ArtifactView messageId={messageId} artifact={artifact} linked={(t) => t} onFloor={() => undefined} onReplyAbout={() => useStore.getState().openOverlay({ kind: 'phone', tab: 'chat' })} onClose={onClose} />;
}

// ---------- filters and groups ----------

function FiltersSheet({ graph, filters, setFilters, colourBy, setColourBy, older, setOlder, onClose }: { graph: MemoryGraph; filters: Filters; setFilters: (f: Filters) => void; colourBy: ColourBy; setColourBy: (c: ColourBy) => void; older: boolean; setOlder: (b: boolean) => void; onClose: () => void }) {
  const repos = useStore((s) => s.repos);
  const of = (t: MapNodeType) => graph.nodes.filter((n) => n.type === t);
  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });
  const floorName = (repoId: string | null) => {
    const r = repos.find((x) => x.id === repoId);
    return r ? `${r.floor} · ${r.fullName.split('/')[1]}` : '';
  };
  return (
    <Sheet label="Filters and groups" onClose={onClose} className="mm-sheet">
      <div className="artifact-body mm-filters">
        <fieldset className="mm-field">
          <legend>Colour by</legend>
          <div className="mm-segs">
            {(['type', 'floor', 'objective'] as const).map((c) => (
              <button key={c} type="button" className={`mm-seg ${colourBy === c ? 'mm-seg-on' : ''}`} aria-pressed={colourBy === c} onClick={() => setColourBy(c)}>
                {c === 'type' ? 'Type' : c === 'floor' ? 'Floor' : 'Objective'}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="mm-field">
          <legend>Show</legend>
          <div className="mm-chips">
            {NODE_TYPES.filter((t) => of(t).length).map((t) => {
              const on = !filters.hiddenTypes.includes(t);
              return (
                <button key={t} type="button" className={`mm-key ${on ? '' : 'mm-key-off'}`} aria-pressed={on} onClick={() => set({ hiddenTypes: on ? [...filters.hiddenTypes, t] : filters.hiddenTypes.filter((x) => x !== t) })}>
                  <span className="mm-dot" style={{ background: TYPE_LOOK[t][0] }} aria-hidden /> {TYPE_LOOK[t][1]} <span className="muted">{of(t).length}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
        <label className="mm-field">
          <span>Floor</span>
          <select value={filters.repoId ?? ''} onChange={(e) => set({ repoId: e.target.value || null })}>
            <option value="">Every floor</option>
            {repos.map((r) => (
              <option key={r.id} value={r.id}>
                {floorName(r.id)}
              </option>
            ))}
          </select>
        </label>
        <label className="mm-field">
          <span>Objective</span>
          <select value={filters.objective ?? ''} onChange={(e) => set({ objective: e.target.value || null })}>
            <option value="">Any objective</option>
            {of('objective').map((o) => (
              <option key={o.id} value={o.id}>
                {floorName(o.repoId)} · {o.title}
              </option>
            ))}
          </select>
        </label>
        <label className="mm-field">
          <span>Agent</span>
          <select value={filters.agentId ?? ''} onChange={(e) => set({ agentId: e.target.value || null })}>
            <option value="">Anyone</option>
            {[...of('ceo'), ...of('agent')].map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
        </label>
        <label className="mm-field">
          <span>Status</span>
          <select value={filters.status ?? ''} onChange={(e) => set({ status: (e.target.value || null) as MapStatus | null })}>
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="mm-check">
          <input type="checkbox" checked={older} onChange={(e) => setOlder(e.target.checked)} />
          <span>Show work older than {DEFAULT_CAPS.sinceDays} days</span>
        </label>
      </div>
      <div className="artifact-actions">
        <button type="button" className="btn btn-small" disabled={!activeFilters(filters)} onClick={() => setFilters(NO_FILTERS)}>
          Clear filters
        </button>
        <button type="button" className="btn btn-small btn-good" onClick={onClose}>
          Done
        </button>
      </div>
    </Sheet>
  );
}
