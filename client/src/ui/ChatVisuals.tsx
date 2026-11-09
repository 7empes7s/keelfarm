import { useEffect, useId, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { parseRefs, soleRef, type RefContext } from '../../../shared/chatRefs';
import { deltaTone, formatDelta, formatValue, SERIES_COLORS, sortRows, xTicks, type ChatVisual, type VisualChart, type VisualColor, type VisualTable, type VisualTile, type VisualUnit } from '../../../shared/chatVisuals';
import type { CostsView } from '../../../shared/costs';
import { costDays, needsServerTrend, resolveVisual, type Resolved, type SourceData } from './chatVisualSources';
import type { ServerPoint } from '../../../shared/serverLoad';
import { useRefOpen } from './RefChips';
import { Sheet } from './ChatArtifacts';
import './chatVisuals.css';
import { Icon } from './Icon';
import type { IconName } from './icons';

// The CEO's charts, tables and dashboards in a chat bubble (#146; blocks in shared/chatVisuals.ts, live sources in
// chatVisualSources.ts). Loaded lazily with the first message that has one. Small SVG charts of our own, no chart
// library: a tap (or hover) selects a point and shows its value with a button to what it names; legend chips hide a
// series; ⤢ opens the card full-screen with its numbers as a table. Every chart has a data table for screen readers.

// ---------- live data ----------

const COSTS_TTL = 60_000;
const costsCache = new Map<number, { at: number; view: Promise<CostsView> }>();
function costsFor(days: number): Promise<CostsView> {
  const hit = costsCache.get(days);
  if (hit && Date.now() - hit.at < COSTS_TTL) return hit.view;
  const view = api.costs(days);
  costsCache.set(days, { at: Date.now(), view });
  view.catch(() => costsCache.delete(days));
  return view;
}

let trendCache: { at: number; points: Promise<ServerPoint[]> } | null = null;
function serverTrend(): Promise<ServerPoint[]> {
  if (trendCache && Date.now() - trendCache.at < COSTS_TTL) return trendCache.points;
  const points = api.serverTrend();
  trendCache = { at: Date.now(), points };
  points.catch(() => (trendCache = null));
  return points;
}

function useResolved(v: ChatVisual): Resolved {
  const ops = useStore((s) => s.ops);
  const repos = useStore((s) => s.repos);
  const usage = useStore((s) => s.claudeUsage);
  const server = useStore((s) => s.serverLoad);
  const held = useStore((s) => s.health?.heldWork?.tasks ?? 0);
  const [costs, setCosts] = useState<SourceData['costs']>({});
  const [trend, setTrend] = useState<ServerPoint[] | undefined>(undefined);
  const days = useMemo(() => costDays(v), [v]);
  const wantsTrend = useMemo(() => needsServerTrend(v), [v]);
  useEffect(() => {
    let live = true;
    for (const d of days) costsFor(d).then((view) => live && setCosts((c) => ({ ...c, [d]: view })), () => undefined);
    if (wantsTrend) serverTrend().then((points) => live && setTrend(points), () => undefined);
    return () => {
      live = false;
    };
  }, [days, wantsTrend]);
  const floors = useMemo(() => repos.map((r) => ({ floor: r.floor, repoId: r.id })), [repos]);
  return useMemo(() => resolveVisual(v, { costs, ops, floors, usage, now: Date.now(), server, serverTrend: trend, held }), [v, costs, ops, floors, usage, server, trend, held]);
}

/** What a ref written in a block ("floor 3 #116", "qa: floor 3 #116", "@Ada") opens, or null. `whole`: only when the
 * text is that ref (a table cell), not free text that mentions one. */
function useRefText(): (text: string | null | undefined, whole?: boolean) => (() => void) | null {
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const open = useRefOpen();
  return (text, whole) => {
    if (!text) return null;
    const ctx: RefContext = { floors: repos.map((r) => ({ floor: r.floor, repoId: r.id })), agents: Object.values(agents).filter((a) => a.role !== 'ceo').map((a) => ({ id: a.id, name: a.name })), hasFile: () => false };
    const ref = whole ? soleRef(text, ctx) : parseRefs(text, ctx)[0];
    return ref ? open(ref) : null;
  };
}

// ---------- colours ----------

const TOKENS: Record<VisualColor, string> = { accent: 'var(--ds-accent)', good: 'var(--ds-good-fill)', warn: 'var(--ds-warn-fill)', bad: 'var(--ds-bad-fill)', blue: 'var(--ds-series-4)', muted: 'var(--ds-line-strong)' };
const seriesColor = (i: number, c?: VisualColor) => (c ? TOKENS[c] : `var(--ds-series-${(i % SERIES_COLORS) + 1})`);

// ---------- charts ----------

// The SVG is drawn at its real width (1 unit = 1 px), so axis text keeps the --ds-text-xs size in a narrow chat.
const W = 320; // before it is measured
const PAD = { l: 44, r: 8, t: 8, b: 24 };
const CHAR_PX = 7; // a character of axis text, about
const heightOf = (w: number) => Math.min(260, Math.max(140, Math.round(w * 0.47)));

/** An element's width in px, measured as it changes (a callback ref: the plot appears once its data loads). */
function useWidth(): [(el: HTMLElement | null) => void, number] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [w, setW] = useState(W);
  useLayoutEffect(() => {
    if (!el) return;
    const read = () => el.clientWidth && setW(Math.round(el.clientWidth));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w];
}

/** A round top for the y axis: 1, 2, 2.5 or 5 times a power of ten. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= v) ?? 10) * p;
}

interface ChartProps {
  c: VisualChart;
  hidden: Set<number>;
  sel: number | null;
  onSel: (i: number | null) => void;
  w: number;
}

function Axes({ max, unit, w, h }: { max: number; unit: VisualUnit; w: number; h: number }) {
  const ys = [0, max / 2, max];
  return (
    <g className="viz-axis" aria-hidden>
      {ys.map((y) => {
        const py = PAD.t + (h - PAD.t - PAD.b) * (1 - y / max);
        return (
          <g key={y}>
            <line x1={PAD.l} x2={w - PAD.r} y1={py} y2={py} />
            <text x={PAD.l - 4} y={py + 3} textAnchor="end">
              {formatValue(y, unit, true)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function XLabels({ labels, x, w, h }: { labels: string[]; x: (i: number) => number; w: number; h: number }) {
  return (
    <g className="viz-axis" aria-hidden>
      {xTicks(labels, w - PAD.l - PAD.r, CHAR_PX).map(({ i, text }) => (
        <text key={i} x={x(i)} y={h - 6} textAnchor="middle">
          {text}
        </text>
      ))}
    </g>
  );
}

function BarsChart({ c, hidden, sel, onSel, w }: ChartProps) {
  const h = heightOf(w);
  const shown = c.series.map((s, i) => ({ s, i })).filter((x) => !hidden.has(x.i));
  const stacked = c.type === 'stacked-bar';
  const n = c.labels.length;
  const totals = c.labels.map((_, j) => shown.reduce((a, { s }) => a + Math.max(0, s.values[j] ?? 0), 0));
  const max = niceMax(Math.max(...(stacked ? totals : shown.flatMap(({ s }) => s.values.map((v) => v ?? 0))), 0));
  const plotW = w - PAD.l - PAD.r;
  const plotH = h - PAD.t - PAD.b;
  const slot = plotW / Math.max(1, n);
  const x = (j: number) => PAD.l + slot * (j + 0.5);
  const bw = Math.min(28, slot * 0.7);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="viz-svg" aria-hidden>
      <Axes max={max} unit={c.unit} w={w} h={h} />
      {c.labels.map((_, j) => {
        let base = 0;
        return (
          <g key={j} className={`viz-slot ${sel === j ? 'viz-on' : ''}`} onPointerEnter={(e) => e.pointerType === 'mouse' && onSel(j)} onClick={() => onSel(j)}>
            <rect x={PAD.l + slot * j} y={PAD.t} width={slot} height={plotH} className="viz-hit" />
            {shown.map(({ s, i }, k) => {
              const v = Math.max(0, s.values[j] ?? 0);
              const h = (v / max) * plotH;
              const each = stacked ? bw : bw / shown.length;
              const bx = stacked ? x(j) - bw / 2 : x(j) - bw / 2 + each * k;
              const by = PAD.t + plotH - h - (stacked ? (base / max) * plotH : 0);
              if (stacked) base += v;
              return h > 0 ? <rect key={i} x={bx} y={by} width={Math.max(1, each - (stacked ? 0 : 1))} height={h} rx={2} fill={seriesColor(i, s.color)} className="viz-mark" /> : null;
            })}
          </g>
        );
      })}
      <XLabels labels={c.labels} x={x} w={w} h={h} />
    </svg>
  );
}

function LinesChart({ c, hidden, sel, onSel, w }: ChartProps) {
  const h = heightOf(w);
  const shown = c.series.map((s, i) => ({ s, i })).filter((x) => !hidden.has(x.i));
  const n = c.labels.length;
  const max = niceMax(Math.max(0, ...shown.flatMap(({ s }) => s.values.map((v) => v ?? 0))));
  const plotW = w - PAD.l - PAD.r;
  const plotH = h - PAD.t - PAD.b;
  const x = (j: number) => PAD.l + (n === 1 ? plotW / 2 : (plotW * j) / (n - 1));
  const y = (v: number) => PAD.t + plotH * (1 - v / max);
  const slot = plotW / Math.max(1, n - 1);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="viz-svg" aria-hidden>
      <Axes max={max} unit={c.unit} w={w} h={h} />
      {shown.map(({ s, i }) => {
        // A gap (null) breaks the line.
        const runs: [number, number][][] = [[]];
        s.values.forEach((v, j) => (v === null ? runs.push([]) : runs[runs.length - 1].push([x(j), y(v)])));
        return (
          <g key={i}>
            {runs
              .filter((r) => r.length)
              .map((r, k) => {
                const d = r.map(([px, py], m) => `${m ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
                return (
                  <g key={k}>
                    {c.type === 'area' && <path d={`${d}L${r[r.length - 1][0].toFixed(1)},${PAD.t + plotH}L${r[0][0].toFixed(1)},${PAD.t + plotH}Z`} fill={seriesColor(i, s.color)} opacity={0.45} />}
                    <path d={d} fill="none" stroke={seriesColor(i, s.color)} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
                    {r.length === 1 && <circle cx={r[0][0]} cy={r[0][1]} r={3} fill={seriesColor(i, s.color)} />}
                  </g>
                );
              })}
          </g>
        );
      })}
      {c.labels.map((_, j) => (
        <g key={j} className={`viz-slot ${sel === j ? 'viz-on' : ''}`} onPointerEnter={(e) => e.pointerType === 'mouse' && onSel(j)} onClick={() => onSel(j)}>
          <rect x={x(j) - slot / 2} y={PAD.t} width={n === 1 ? plotW : slot} height={plotH} className="viz-hit" />
          {sel === j && <line x1={x(j)} x2={x(j)} y1={PAD.t} y2={PAD.t + plotH} className="viz-cursor" />}
          {sel === j && shown.map(({ s, i }) => s.values[j] !== null && <circle key={i} cx={x(j)} cy={y(s.values[j]!)} r={4.5} fill={seriesColor(i, s.color)} className="viz-mark" />)}
        </g>
      ))}
      <XLabels labels={c.labels} x={x} w={w} h={h} />
    </svg>
  );
}

function DonutChart({ c, hidden, sel, onSel }: ChartProps) {
  const vals = c.labels.map((_, j) => (hidden.has(j) ? 0 : Math.max(0, c.series[0]?.values[j] ?? 0)));
  const total = vals.reduce((a, b) => a + b, 0);
  const r = 46;
  const len = 2 * Math.PI * r;
  let at = 0;
  return (
    <svg viewBox="0 0 120 120" className="viz-svg viz-donut" aria-hidden>
      <circle cx={60} cy={60} r={r} className="viz-donut-track" />
      {total > 0 &&
        vals.map((v, j) => {
          if (!v) return null;
          const part = (v / total) * len;
          const el = (
            <circle
              key={j}
              cx={60}
              cy={60}
              r={r}
              fill="none"
              stroke={seriesColor(j)}
              strokeWidth={sel === j ? 22 : 18}
              strokeDasharray={`${part} ${len - part}`}
              strokeDashoffset={-at}
              transform="rotate(-90 60 60)"
              className="viz-slice"
              onPointerEnter={(e) => e.pointerType === 'mouse' && onSel(j)}
              onClick={() => onSel(j)}
            />
          );
          at += part;
          return el;
        })}
      <text x={60} y={58} textAnchor="middle" className="viz-donut-total">
        {formatValue(sel !== null ? vals[sel] : total, c.unit, true)}
      </text>
      <text x={60} y={74} textAnchor="middle" className="viz-donut-sub">
        {sel !== null ? (c.labels[sel].length > 12 ? `${c.labels[sel].slice(0, 11)}…` : c.labels[sel]) : 'total'}
      </text>
    </svg>
  );
}

function ProgressChart({ c, sel, onSel }: ChartProps) {
  const vals = c.series[0]?.values ?? [];
  const max = c.max ?? (c.unit === 'pct' ? 100 : Math.max(1, ...vals.map((v) => v ?? 0)));
  return (
    <div className="viz-progress" aria-hidden>
      {c.labels.map((l, j) => {
        const v = vals[j] ?? 0;
        const share = Math.max(0, Math.min(1, v / max));
        return (
          <button type="button" key={j} tabIndex={-1} className={`viz-progress-row ${sel === j ? 'viz-on' : ''}`} onClick={() => onSel(j)}>
            <span className="viz-progress-label">{l}</span>
            <span className="viz-meter">
              <span style={{ width: `${share * 100}%`, background: share >= 0.9 ? TOKENS.bad : share >= 0.7 ? TOKENS.warn : TOKENS.good }} />
            </span>
            <span className="viz-progress-value">{formatValue(vals[j], c.unit)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The chart's numbers as a table: for screen readers in the bubble, shown in the full-screen view. */
function DataTable({ c, visible }: { c: VisualChart; visible?: boolean }) {
  return (
    <table className={visible ? 'viz-data' : 'sr-only'}>
      <caption className="sr-only">{c.title || 'Chart'} data</caption>
      <thead>
        <tr>
          <th scope="col">Item</th>
          {c.series.map((s, i) => (
            <th key={i} scope="col">
              {s.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {c.labels.map((l, j) => (
          <tr key={j}>
            <th scope="row">{l}</th>
            {c.series.map((s, i) => (
              <td key={i}>{formatValue(s.values[j], c.unit)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ChartBody({ c, big }: { c: Resolved<VisualChart>; big?: boolean }) {
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [sel, setSel] = useState<number | null>(null);
  const refOpen = useRefText();
  const [plotRef, w] = useWidth();
  if (c.missing || !c.labels.length) return <p className="viz-missing">{c.missing ?? 'Nothing to show yet.'}</p>;
  const donut = c.type === 'donut';
  const props: ChartProps = { c, hidden, sel: sel !== null && sel < c.labels.length ? sel : null, onSel: setSel, w };
  const Body = donut ? DonutChart : c.type === 'progress' ? ProgressChart : c.type === 'line' || c.type === 'area' ? LinesChart : BarsChart;
  const legend = donut ? c.labels : c.series.length > 1 ? c.series.map((s) => s.name) : [];
  const toggle = (i: number) =>
    setHidden((h) => {
      const next = new Set(h);
      if (!next.delete(i)) next.add(i);
      return next.size >= legend.length ? h : next; // one stays on
    });
  const open = props.sel !== null ? refOpen(c.refs?.[props.sel]) : null;
  const summary = `${c.title || 'Chart'}: ${c.labels
    .slice(0, 8)
    .map((l, j) => `${l} ${c.series.map((s) => formatValue(s.values[j], c.unit)).join(' / ')}`)
    .join(', ')}${c.labels.length > 8 ? '…' : ''}`;
  return (
    <div className={`viz-chart ${big ? 'viz-big' : ''}`}>
      <div ref={plotRef} className="viz-plot" role="img" aria-label={summary}>
        <Body {...props} />
      </div>
      {legend.length > 0 && (
        <div className="viz-legend">
          {legend.map((name, i) => (
            <button type="button" key={i} className="viz-legend-chip" aria-pressed={!hidden.has(i)} onClick={() => toggle(i)} title={hidden.has(i) ? `Show ${name}` : `Hide ${name}`}>
              <span className="viz-swatch" style={{ background: seriesColor(i, donut ? undefined : c.series[i]?.color) }} />
              {name}
            </button>
          ))}
        </div>
      )}
      <div className="viz-tip" aria-live="polite">
        {props.sel !== null ? (
          <>
            <b className="grow viz-tip-text">
              {c.labels[props.sel]}: {c.series.filter((_, i) => donut || !hidden.has(i)).map((s) => `${c.series.length > 1 ? `${s.name} ` : ''}${formatValue(s.values[props.sel!], c.unit)}`).join(' · ')}
            </b>
            {open && (
              <button type="button" className="btn btn-small viz-tip-open" onClick={open}>
                Open <Icon name="chevron-right" />
              </button>
            )}
          </>
        ) : (
          <span className="muted small">{`Tap a ${donut ? 'slice' : c.type === 'line' || c.type === 'area' ? 'point' : c.type === 'progress' ? 'row' : 'bar'} ${c.refs?.some(Boolean) ? 'to see it and open it' : 'for its value'}`}</span>
        )}
      </div>
      <DataTable c={c} visible={big} />
    </div>
  );
}

// ---------- tables ----------

const PREVIEW_ROWS = 5;

function Cell({ v, unit, refOpen }: { v: VisualTable['rows'][number][number]; unit: VisualUnit; refOpen: ReturnType<typeof useRefText> }) {
  const open = typeof v === 'string' ? refOpen(v, true) : null;
  if (open)
    return (
      <button type="button" className="ref-chip" onClick={open}>
        {v}
      </button>
    );
  return <>{formatValue(v, unit)}</>;
}

function TableBody({ t, big }: { t: Resolved<VisualTable>; big?: boolean }) {
  const [sort, setSort] = useState<{ col: number; dir: 'asc' | 'desc' } | null>(null);
  const [all, setAll] = useState(!!big);
  const refOpen = useRefText();
  if (t.missing || !t.rows.length) return <p className="viz-missing">{t.missing ?? 'Nothing to show yet.'}</p>;
  const rows = sort ? sortRows(t.rows, sort.col, sort.dir) : t.rows;
  const shown = all ? rows : rows.slice(0, PREVIEW_ROWS);
  const flip = (col: number) => setSort((s) => (s?.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: t.columns[col].unit ? 'desc' : 'asc' }));
  return (
    <>
      <div className={`viz-table ${big ? 'viz-big' : ''}`} tabIndex={0} role="region" aria-label={t.title || 'Table'}>
        <table>
          <thead>
            <tr>
              {t.columns.map((c, j) => (
                <th key={j} scope="col" className={c.unit ? 'viz-num' : undefined} aria-sort={sort?.col === j ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  <button type="button" onClick={() => flip(j)}>
                    {c.label}
                    <span aria-hidden>{sort?.col === j ? <> <Icon name={sort.dir === 'asc' ? 'chevron-up' : 'chevron-down'} /></> : ''}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i}>
                {t.columns.map((c, j) => (
                  <td key={j} className={c.unit ? 'viz-num' : undefined}>
                    <Cell v={r[j]} unit={c.unit} refOpen={refOpen} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > PREVIEW_ROWS && !big && (
        <button type="button" className="long-toggle" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? 'Show less' : `Show all ${rows.length}`}
        </button>
      )}
    </>
  );
}

// ---------- dashboards ----------

function Spark({ values }: { values: number[] }) {
  const max = Math.max(...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 60).toFixed(1)},${(18 - ((v - min) / span) * 16).toFixed(1)}`).join(' ');
  return (
    <svg viewBox="0 0 60 20" className="viz-spark" aria-hidden preserveAspectRatio="none">
      <polyline points={pts} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Tile({ t }: { t: VisualTile & { missing?: string } }) {
  const refOpen = useRefText();
  const open = refOpen(t.ref);
  const tone = deltaTone(t);
  const value = t.missing ? '–' : formatValue(t.value, t.unit);
  const body = (
    <>
      <span className="viz-tile-label">{t.label}</span>
      <span className="viz-tile-value">{value}</span>
      <span className="viz-tile-foot">
        {t.delta !== undefined && <span className={`viz-delta ${tone ? `viz-delta-${tone}` : ''}`}>{formatDelta(t.delta)}</span>}
        {t.spark && <Spark values={t.spark} />}
      </span>
      {t.progress !== undefined && (
        <span className="viz-meter" aria-hidden>
          <span style={{ width: `${t.progress}%` }} />
        </span>
      )}
      {t.missing && <span className="viz-tile-note">{t.missing}</span>}
    </>
  );
  const label = `${t.label}: ${value}${t.delta !== undefined ? `, ${formatDelta(t.delta)}${tone ? ` (${tone === 'good' ? 'better' : 'worse'})` : ''}` : ''}`;
  return open ? (
    <button type="button" className="viz-tile viz-tile-tap" onClick={open} aria-label={`${label}. Open it.`}>
      {body}
    </button>
  ) : (
    <div className="viz-tile" role="group" aria-label={label}>
      {body}
    </div>
  );
}

function DashboardBody({ d, big }: { d: Resolved<Extract<ChatVisual, { kind: 'dashboard' }>>; big?: boolean }) {
  return (
    <>
      {d.tiles.length > 0 && (
        <div className="viz-tiles">
          {d.tiles.map((t, i) => (
            <Tile key={i} t={t} />
          ))}
        </div>
      )}
      {d.charts.map((c, i) => (
        <section key={i} className="viz-sub">
          {c.title && <h4 className="viz-sub-title">{c.title}</h4>}
          <ChartBody c={c} big={big} />
        </section>
      ))}
    </>
  );
}

// ---------- the card ----------

const VIZ_ICON: Record<'chart' | 'table' | 'dashboard', IconName> = { chart: 'chart-column', table: 'clipboard-list', dashboard: 'trending-up' };

function Body({ v, big }: { v: Resolved; big?: boolean }) {
  if (v.kind === 'chart') return <ChartBody c={v} big={big} />;
  if (v.kind === 'table') return <TableBody t={v} big={big} />;
  return <DashboardBody d={v} big={big} />;
}

function VisualCard({ visual }: { visual: ChatVisual }) {
  const v = useResolved(visual);
  const [full, setFull] = useState(false);
  const titleId = useId();
  const title = v.title || (v.kind === 'chart' ? 'Chart' : v.kind === 'table' ? 'Table' : 'Dashboard');
  const head = (extra?: ReactNode) => (
    <div className="viz-head">
      <Icon name={VIZ_ICON[v.kind]} />
      <b id={titleId} className="grow viz-title">
        {title}
      </b>
      {v.source && <span className="viz-live" title={`Live: ${v.source}`}>live</span>}
      {extra}
    </div>
  );
  return (
    <figure className="viz-card" aria-labelledby={titleId}>
      {head(
        <button type="button" className="viz-expand" aria-label={`Open ${title} full screen`} title="Full screen" onClick={() => setFull(true)}>
          <Icon name="maximize-2" />
        </button>,
      )}
      <Body v={v} />
      {full && (
        <Sheet label={title} onClose={() => setFull(false)} className="viz-sheet">
          <div className="artifact-body">
            <Body v={v} big />
          </div>
        </Sheet>
      )}
    </figure>
  );
}

/** A message's visuals, each as a card. */
export default function ChatVisuals({ visuals }: { visuals: readonly ChatVisual[] }) {
  return (
    <>
      {visuals.map((v, i) => (
        <VisualCard key={i} visual={v} />
      ))}
    </>
  );
}
