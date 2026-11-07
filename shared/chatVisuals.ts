// The CEO's charts, tables and dashboards in the phone chat (#146): ```chart, ```table and ```dashboard blocks of JSON
// that the office lifts out of a CEO message (shared/chatParts.ts), checked and trimmed here. Values are either written
// inline or named by a live `source` ("costs:7d:byFloor") that the phone resolves from the office's own numbers
// (client/src/ui/chatVisualSources.ts). A block that can't be read stays in the text as written. Percentages are 0-100.

export type VisualUnit = 'usd' | 'pct' | 'ms' | 'count' | '';
type ChartType = 'bar' | 'stacked-bar' | 'line' | 'area' | 'donut' | 'progress';
/** Colours by design token (client: --ds-series-*, --ds-good-fill…), never raw CSS. */
export type VisualColor = 'accent' | 'good' | 'warn' | 'bad' | 'blue' | 'muted';

interface VisualSeries {
  name: string;
  values: (number | null)[]; // one per label
  color?: VisualColor;
}

export interface VisualChart {
  kind: 'chart';
  type: ChartType;
  title: string;
  unit: VisualUnit;
  labels: string[];
  series: VisualSeries[];
  refs?: (string | null)[]; // per label: what tapping it opens, written as chat refs ("floor 3 #116", "qa: floor 3 #116")
  max?: number; // progress: the full bar (default 100 for pct)
  source?: string;
}

interface VisualColumn {
  label: string;
  unit: VisualUnit; // '' = text
}
export type VisualCell = string | number | null;

export interface VisualTable {
  kind: 'table';
  title: string;
  columns: VisualColumn[];
  rows: VisualCell[][];
  source?: string;
}

export interface VisualTile {
  label: string;
  value: number | string | null;
  unit: VisualUnit;
  delta?: number; // % change against the previous period
  good?: 'up' | 'down'; // which way is better (default up)
  spark?: number[]; // oldest first
  progress?: number; // 0-100
  ref?: string;
  source?: string;
}

export interface VisualDashboard {
  kind: 'dashboard';
  title: string;
  tiles: VisualTile[];
  charts: VisualChart[];
  source?: string;
}

export type ChatVisual = VisualChart | VisualTable | VisualDashboard;
export type VisualKind = ChatVisual['kind'];

export const MAX_VISUALS = 3;
/** A block's JSON, at most (characters); a longer one stays in the text. */
export const VISUAL_CHARS = 12_000;
const MAX_LABELS = 60;
const MAX_SERIES = 6;
const MAX_COLUMNS = 8;
const MAX_ROWS = 200;
const MAX_TILES = 8;
const MAX_DASH_CHARTS = 2;
const MAX_SPARK = 60;
const TEXT_CHARS = 120;
const TITLE_CHARS = 80;

const CHART_TYPES: readonly ChartType[] = ['bar', 'stacked-bar', 'line', 'area', 'donut', 'progress'];
const COLORS: readonly VisualColor[] = ['accent', 'good', 'warn', 'bad', 'blue', 'muted'];

// ---------- sources ----------

const COST_VIEWS = ['byFloor', 'byDay', 'byKind', 'wasteByCause', 'perMerge', 'total', 'costPerMerge', 'waste', 'wasteShare', 'merges'] as const;
const FLOW_METRICS = ['mergedToday', 'mergedHour', 'qaPass', 'qaFirstPass', 'qaRounds', 'lead', 'qaWait', 'ciPass'] as const;
const STAGES = ['ready', 'building', 'inQa', 'fixing', 'toMerge', 'needsYou', 'triage'] as const;
type CostView = (typeof COST_VIEWS)[number];
type FlowMetric = (typeof FLOW_METRICS)[number];
type Stage = (typeof STAGES)[number];

/** A live source: `null` view or metric is the whole thing (a costs dashboard, merges per hour, every stage, every limit). */
export type VisualSource =
  | { kind: 'costs'; days: number; view: CostView | null }
  | { kind: 'throughput'; floor: number | null; metric: FlowMetric | null; byFloor?: true }
  | { kind: 'backlog'; floor: number | null; stage: Stage | null }
  | { kind: 'usage'; limit: string | null };

const pick = <T extends string>(list: readonly T[], s: string | undefined): T | null => (s === undefined ? null : (list.find((x) => x.toLowerCase() === s.toLowerCase()) ?? null));

/** "office" or "floor:N", then the rest. */
function scope(parts: string[]): { floor: number | null; rest: string[] } | null {
  if (parts[0] === 'office') return { floor: null, rest: parts.slice(1) };
  if (parts[0] === 'floor' && /^\d{1,3}$/.test(parts[1] ?? '')) return { floor: Number(parts[1]), rest: parts.slice(2) };
  return parts.length ? { floor: null, rest: parts } : { floor: null, rest: [] };
}

/**
 * costs:<N>d[:view] · throughput:office|floor:N|byFloor[:metric] · backlog:office|floor:N[:stage] · usage[:limit].
 * Anything else is null, so the block falls back to its inline values.
 */
export function parseSource(raw: unknown): VisualSource | null {
  if (typeof raw !== 'string') return null;
  const parts = raw.trim().split(':').map((p) => p.trim()).filter(Boolean);
  const head = parts.shift()?.toLowerCase();
  if (head === 'costs') {
    const d = parts.shift()?.match(/^(\d{1,2})d$/i);
    const days = d ? Number(d[1]) : 0;
    if (days < 1 || days > 30 || parts.length > 1) return null;
    const view = pick(COST_VIEWS, parts[0]);
    return parts.length && !view ? null : { kind: 'costs', days, view };
  }
  if (head === 'throughput') {
    if (parts[0]?.toLowerCase() === 'byfloor') return parts.length === 1 ? { kind: 'throughput', floor: null, metric: 'mergedToday', byFloor: true } : null;
    const s = scope(parts);
    if (!s || s.rest.length > 1) return null;
    const metric = pick(FLOW_METRICS, s.rest[0]);
    return s.rest.length && !metric ? null : { kind: 'throughput', floor: s.floor, metric };
  }
  if (head === 'backlog') {
    const s = scope(parts);
    if (!s || s.rest.length > 1) return null;
    const stage = pick(STAGES, s.rest[0]);
    return s.rest.length && !stage ? null : { kind: 'backlog', floor: s.floor, stage };
  }
  if (head === 'usage') return parts.length > 1 ? null : { kind: 'usage', limit: parts[0] ?? null };
  return null;
}

// ---------- checking a block ----------

type Json = Record<string, unknown>;
const isObj = (x: unknown): x is Json => !!x && typeof x === 'object' && !Array.isArray(x);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const text = (x: unknown, n = TEXT_CHARS) => (typeof x === 'string' ? clip(x.trim(), n) : typeof x === 'number' && Number.isFinite(x) ? String(x) : '');

/** A number as the CEO may write it: 3.2, "3.2", "$3.20", "72%", "1,200". */
export function numberOf(x: unknown): number | null {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x !== 'string') return null;
  const t = x.trim().replace(/^\$|%$|,/g, '');
  return t && /^-?\d*\.?\d+(e-?\d+)?$/i.test(t) ? Number(t) : null;
}

/** The unit as written ("$", "usd", "%", "duration"…); numbers without one are counts. */
function unitOf(x: unknown, fallback: VisualUnit = 'count'): VisualUnit {
  const u = typeof x === 'string' ? x.trim().toLowerCase() : '';
  if (['usd', '$', 'money', 'dollars', 'cost'].includes(u)) return 'usd';
  if (['pct', '%', 'percent', 'share'].includes(u)) return 'pct';
  if (['ms', 'duration', 'time'].includes(u)) return 'ms';
  if (['count', 'number', 'n'].includes(u)) return 'count';
  if (['text', 'string', 'label'].includes(u)) return '';
  return fallback;
}

const colorOf = (x: unknown): VisualColor | undefined => (COLORS.includes(x as VisualColor) ? (x as VisualColor) : undefined);
const sourceOf = (x: unknown) => (parseSource(x) ? (x as string).trim() : undefined);

/** A chart's JSON, trimmed to fit; null when it has neither a source nor a single number to draw. */
function chartOf(o: unknown): VisualChart | null {
  if (!isObj(o)) return null;
  const type = CHART_TYPES.includes(o.type as ChartType) ? (o.type as ChartType) : 'bar';
  const title = text(o.title, TITLE_CHARS);
  const source = sourceOf(o.source);
  // Points, as [{ "label", "value", "ref" }], are one series.
  const data = Array.isArray(o.data) ? o.data.filter(isObj).slice(0, MAX_LABELS) : null;
  const rawSeries = data ? [{ name: text(o.name) || title, values: data.map((p) => p.value) }] : Array.isArray(o.series) ? o.series.filter(isObj) : [];
  const firstLabels = Array.isArray(rawSeries[0]?.labels) ? (rawSeries[0].labels as unknown[]) : null;
  const labels = (data ? data.map((p) => p.label) : Array.isArray(o.labels) ? o.labels : (firstLabels ?? [])).slice(0, MAX_LABELS).map((l) => text(l, 40));
  const series: VisualSeries[] = rawSeries.slice(0, MAX_SERIES).map((s, i) => {
    const vals = Array.isArray(s.values) ? s.values : [];
    const color = colorOf(s.color);
    return { name: text(s.name) || `Series ${i + 1}`, values: labels.map((_, j) => numberOf(vals[j])), ...(color && { color }) };
  });
  const rawRefs = data ? data.map((p) => p.ref) : Array.isArray(o.refs) ? o.refs : [];
  const refs = labels.map((_, j) => text(rawRefs[j]) || null);
  const drawable = labels.length > 0 && series.some((s) => s.values.some((v) => v !== null));
  if (!drawable && !source) return null;
  const max = numberOf(o.max);
  return {
    kind: 'chart',
    type,
    title,
    unit: unitOf(o.unit ?? rawSeries[0]?.unit),
    labels: drawable ? labels : [],
    series: drawable ? series : [],
    ...(refs.some(Boolean) && { refs }),
    ...(max !== null && max > 0 && { max }),
    ...(source && { source }),
  };
}

/** A table's JSON: columns as strings or { label, unit }, rows as arrays or objects keyed by column label. */
function tableOf(o: unknown): VisualTable | null {
  if (!isObj(o)) return null;
  const source = sourceOf(o.source);
  const rawCols = Array.isArray(o.columns) ? o.columns.slice(0, MAX_COLUMNS) : [];
  const columns: VisualColumn[] = rawCols.map((c) => (isObj(c) ? { label: text(c.label ?? c.name, 40), unit: unitOf(c.unit ?? c.format, '') } : { label: text(c, 40), unit: '' }));
  const raw = (Array.isArray(o.rows) ? o.rows.slice(0, MAX_ROWS) : [])
    .map((r) => (Array.isArray(r) ? r : isObj(r) ? columns.map((c) => r[c.label]) : null))
    .filter((r): r is unknown[] => r !== null);
  // A column of numbers with no unit given is a count.
  for (const [j, c] of columns.entries()) if (!c.unit && raw.length && raw.every((r) => typeof r[j] === 'number')) c.unit = 'count';
  const rows = raw.map((r) => columns.map((c, j) => (c.unit ? numberOf(r[j]) : text(r[j]) || null)));
  const title = text(o.title, TITLE_CHARS);
  if (!(columns.length && rows.length) && !source) return null;
  return { kind: 'table', title, columns, rows, ...(source && { source }) };
}

function tileOf(o: unknown): VisualTile | null {
  if (!isObj(o)) return null;
  const label = text(o.label ?? o.title, 40);
  const source = sourceOf(o.source);
  const num = numberOf(o.value);
  const value = num ?? (text(o.value, 24) || null);
  if (!label || (value === null && !source)) return null;
  const delta = numberOf(o.delta);
  const progress = numberOf(o.progress);
  const spark = Array.isArray(o.spark) ? o.spark.slice(-MAX_SPARK).map(numberOf).filter((v): v is number => v !== null) : [];
  const ref = text(o.ref);
  return {
    label,
    value,
    unit: num === null && typeof value === 'string' ? '' : unitOf(o.unit),
    ...(delta !== null && { delta }),
    ...((o.good === 'down' || o.good === 'up') && { good: o.good }),
    ...(spark.length > 1 && { spark }),
    ...(progress !== null && { progress: Math.max(0, Math.min(100, progress)) }),
    ...(ref && { ref }),
    ...(source && { source }),
  };
}

/** A dashboard's JSON: up to 8 tiles and 2 charts, or a source for the whole thing. */
function dashboardOf(o: unknown): VisualDashboard | null {
  if (!isObj(o)) return null;
  const source = sourceOf(o.source);
  const tiles = (Array.isArray(o.tiles) ? o.tiles : []).map(tileOf).filter((t): t is VisualTile => t !== null).slice(0, MAX_TILES);
  const charts = (Array.isArray(o.charts) ? o.charts : []).map(chartOf).filter((c): c is VisualChart => c !== null).slice(0, MAX_DASH_CHARTS);
  if (!tiles.length && !charts.length && !source) return null;
  return { kind: 'dashboard', title: text(o.title, TITLE_CHARS), tiles, charts, ...(source && { source }) };
}

/** A fenced block's info string as a visual's kind, or null. */
export function visualKind(info: string): VisualKind | null {
  const k = info.trim().toLowerCase();
  return k === 'chart' || k === 'table' || k === 'dashboard' ? k : null;
}

/** One ```chart / ```table / ```dashboard block's body as a visual; null (the block stays text) when it isn't one. */
export function parseVisual(kind: VisualKind, body: string): ChatVisual | null {
  if (!body.trim() || body.length > VISUAL_CHARS) return null;
  let o: unknown;
  try {
    o = JSON.parse(body);
  } catch {
    return null;
  }
  return kind === 'chart' ? chartOf(o) : kind === 'table' ? tableOf(o) : dashboardOf(o);
}

// ---------- formatting ----------

/** A duration in words: 850ms, 42s, 4m 12s, 2h 5m, 3d 4h. */
export function formatDuration(ms: number): string {
  const a = Math.abs(ms);
  const sign = ms < 0 ? '-' : '';
  if (a < 1000) return `${sign}${Math.round(a)}ms`;
  const s = Math.round(a / 1000);
  if (s < 60) return `${sign}${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${sign}${m}m${s % 60 ? ` ${s % 60}s` : ''}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${sign}${h}h${m % 60 ? ` ${m % 60}m` : ''}`;
  const d = Math.floor(h / 24);
  return `${sign}${d}d${h % 24 ? ` ${h % 24}h` : ''}`;
}

/** A value as the chat shows it: $3.20, $1.2k, 72%, 4m 12s, 1,204. `short`: axis labels. */
export function formatValue(v: number | string | null | undefined, unit: VisualUnit, short = false): string {
  if (v === null || v === undefined) return '–';
  if (typeof v === 'string') return v;
  if (unit === 'usd') {
    const a = Math.abs(v);
    const sign = v < 0 ? '-' : '';
    if (a >= 1000) return `${sign}$${(a / 1000).toFixed(a >= 10_000 ? 0 : 1)}k`;
    return `${sign}$${a >= 100 || (short && (a >= 10 || Number.isInteger(a))) ? Math.round(a) : a.toFixed(2)}`;
  }
  if (unit === 'pct') return `${Math.round(v * 10) / 10}%`;
  if (unit === 'ms') return formatDuration(v);
  if (Math.abs(v) >= 10_000 && short) return `${Math.round(v / 1000)}k`;
  return (Math.round(v * 100) / 100).toLocaleString('en-US');
}

/** A change in percent as an arrow: "↑ 12%", "↓ 3%", "→ 0%". */
export const formatDelta = (d: number) => `${d > 0.5 ? '↑' : d < -0.5 ? '↓' : '→'} ${Math.abs(Math.round(d))}%`;

/** Whether a tile's change is good, bad or neither. */
export function deltaTone(t: Pick<VisualTile, 'delta' | 'good'>): 'good' | 'bad' | null {
  if (t.delta === undefined || Math.abs(t.delta) < 0.5) return null;
  return t.delta > 0 === (t.good !== 'down') ? 'good' : 'bad';
}

// ---------- drawing ----------

/** Distinct series colours (client: --ds-series-1…8); a donut with more slices groups the rest as "Other". */
export const SERIES_COLORS = 8;

/** A donut of at most SERIES_COLORS slices: the biggest ones, then the rest summed as "Other". */
export function capSlices<T extends VisualChart>(c: T): T {
  const vals = c.series[0]?.values ?? [];
  if (c.type !== 'donut' || c.labels.length <= SERIES_COLORS) return c;
  const order = c.labels.map((_, j) => j).sort((a, b) => (vals[b] ?? 0) - (vals[a] ?? 0));
  const keep = order.slice(0, SERIES_COLORS - 1).sort((a, b) => a - b);
  const rest = order.slice(SERIES_COLORS - 1).reduce((a, j) => a + Math.max(0, vals[j] ?? 0), 0);
  return {
    ...c,
    labels: [...keep.map((j) => c.labels[j]), 'Other'],
    series: c.series.slice(0, 1).map((s) => ({ ...s, values: [...keep.map((j) => s.values[j]), Math.round(rest * 100) / 100] })),
    ...(c.refs && { refs: [...keep.map((j) => c.refs![j]), null] }),
  };
}

/** Which x labels fit under a chart `plotW` px wide at `charPx` per character: every k-th one, cut at 8 characters (or 6 rather than skip). */
export function xTicks(labels: readonly string[], plotW: number, charPx: number): { i: number; text: string }[] {
  const n = labels.length;
  if (!n) return [];
  const want = Math.min(8, Math.max(...labels.map((l) => l.length)));
  let step = 1;
  let chars = 0;
  for (; step < n; step++) {
    chars = Math.floor((plotW / n) * step / charPx) - 1; // a character's gap between labels
    if (chars >= Math.min(want, 6)) break; // cut long labels to 6+ before skipping any
  }
  if (step >= n) chars = Math.floor(plotW / charPx) - 1;
  const fit = Math.max(1, Math.min(want, chars));
  return labels.flatMap((l, i) => (i % step ? [] : [{ i, text: l.length > fit ? `${l.slice(0, Math.max(1, fit - 1))}…` : l }]));
}

// ---------- as text (Telegram, notifications) ----------

const ICONS: Record<VisualKind, string> = { chart: '📊', table: '📋', dashboard: '📈' };
const LIVE = 'live in the office';

function chartText(c: VisualChart, lines: string[]) {
  if (!c.labels.length) return;
  c.labels.slice(0, 12).forEach((l, j) => lines.push(`${l}: ${c.series.map((s) => (c.series.length > 1 ? `${s.name} ${formatValue(s.values[j], c.unit)}` : formatValue(s.values[j], c.unit))).join(' · ')}`));
  if (c.labels.length > 12) lines.push(`…and ${c.labels.length - 12} more`);
}

/** A visual as plain text: its title, then its numbers (a source's are only in the office). */
export function visualText(v: ChatVisual): string {
  const lines = [`${ICONS[v.kind]} ${v.title || (v.kind === 'chart' ? 'Chart' : v.kind === 'table' ? 'Table' : 'Dashboard')}${v.source ? ` (${LIVE})` : ''}`];
  if (v.kind === 'chart') chartText(v, lines);
  else if (v.kind === 'table') {
    if (v.columns.length) lines.push(v.columns.map((c) => c.label).join(' | '));
    v.rows.slice(0, 10).forEach((r) => lines.push(r.map((cell, j) => formatValue(cell, v.columns[j]?.unit ?? '')).join(' | ')));
    if (v.rows.length > 10) lines.push(`…and ${v.rows.length - 10} more rows`);
  } else {
    v.tiles.forEach((t) => lines.push(`${t.label}: ${t.source && t.value === null ? LIVE : formatValue(t.value, t.unit)}${t.delta !== undefined ? ` (${formatDelta(t.delta)})` : ''}`));
    v.charts.forEach((c) => {
      lines.push(`${c.title || 'Chart'}${c.source ? ` (${LIVE})` : ''}`);
      chartText(c, lines);
    });
  }
  return lines.join('\n');
}

/** A message's text with its visuals after it, for places that only show text. */
export const withVisualsText = (body: string, visuals: readonly ChatVisual[] | undefined) => [body, ...(visuals ?? []).map(visualText)].filter(Boolean).join('\n\n');

/** A table's rows sorted by one column (numbers by value, text A–Z), empty cells always last. */
export function sortRows(rows: readonly VisualCell[][], col: number, dir: 'asc' | 'desc'): VisualCell[][] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[col] ?? null;
    const y = b[col] ?? null;
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign;
    return String(x).localeCompare(String(y), undefined, { numeric: true }) * sign;
  });
}
