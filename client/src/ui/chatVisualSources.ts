// The live sources behind the CEO's charts (#146, shared/chatVisuals.ts), resolved in the tab from what it already has:
// the costs view (GET /api/costs, fetched once per message), mission control's numbers, the floors and Claude's usage.
// Pure: a visual with a source comes back with its values filled in, or with `missing` saying why it can't be.

import { KIND_GROUP_LABELS, kindShares, perMergeTrend, wasteGroups, type CostsView, type KindGroup } from '../../../shared/costs';
import { parseSource, type ChatVisual, type VisualChart, type VisualSource, type VisualTable, type VisualTile, type VisualUnit } from '../../../shared/chatVisuals';
import type { OpsNumbers, OpsView } from '../../../shared/ops';
import type { UsageReading } from '../../../shared/types';
import { barName, usedPercent } from '../../../shared/usage';

export interface SourceData {
  costs: Record<number, CostsView | undefined>; // by days
  ops: OpsView;
  floors: readonly { floor: number; repoId: string }[];
  usage: readonly UsageReading[];
  now: number;
}

/** A source's numbers: a series (labels and values, refs per label), or one number with its trend. */
type Data =
  | { chart: Omit<VisualChart, 'kind' | 'title' | 'source'> }
  | { tile: Omit<VisualTile, 'label' | 'source'> };

export type Resolved<T extends ChatVisual = ChatVisual> = T & { missing?: string };

const GROUPS: KindGroup[] = ['build', 'qa', 'fix', 'ceo'];
const GROUP_COLORS = { build: 'warn', qa: 'good', fix: 'bad', ceo: 'blue' } as const;
const STAGE_LABELS = { ready: 'Ready', building: 'Building', inQa: 'In QA', fixing: 'Fixing', toMerge: 'To merge', needsYou: 'Needs you', triage: 'Triage' } as const;
const FLOW: Record<string, { key: keyof OpsNumbers; unit: VisualUnit; pct?: true; good?: 'down' }> = {
  mergedToday: { key: 'mergedToday', unit: 'count' },
  mergedHour: { key: 'mergedHour', unit: 'count' },
  qaPass: { key: 'qaPass', unit: 'pct', pct: true },
  qaFirstPass: { key: 'qaFirstPass', unit: 'pct', pct: true },
  qaRounds: { key: 'qaRoundsPerMerge', unit: 'count', good: 'down' },
  lead: { key: 'leadMs', unit: 'ms', good: 'down' },
  qaWait: { key: 'qaWaitMs', unit: 'ms', good: 'down' },
  ciPass: { key: 'ciPass', unit: 'pct', pct: true },
};

/** The days of costs a visual needs fetched (its own source, its tiles' and charts'). */
export function costDays(v: ChatVisual): number[] {
  const srcs = [v.source, ...(v.kind === 'dashboard' ? [...v.tiles.map((t) => t.source), ...v.charts.map((c) => c.source)] : [])];
  return [...new Set(srcs.map(parseSource).flatMap((s) => (s?.kind === 'costs' ? [s.days] : [])))];
}

/** "2026-11-03" → "Nov 3". */
const dayLabel = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
const round = (n: number) => Math.round(n * 100) / 100;

function costsData(view: CostsView, s: Extract<VisualSource, { kind: 'costs' }>, d: SourceData): Data | null {
  const days = [...view.byDay].reverse(); // oldest first
  const floorOf = (repoId: string) => d.floors.find((f) => f.repoId === repoId)?.floor;
  const trend = perMergeTrend(view.byDay);
  switch (s.view) {
    case 'byFloor': {
      const rows = [...view.floors].sort((a, b) => b.usd - a.usd);
      return {
        chart: {
          type: 'bar',
          unit: 'usd',
          labels: rows.map((r) => (r.repoId ? (floorOf(r.repoId) ? `Floor ${floorOf(r.repoId)}` : r.repoId.split('/').pop()!) : 'CEO')),
          series: [{ name: 'Spend', values: rows.map((r) => round(r.usd)) }],
          refs: rows.map((r) => (floorOf(r.repoId) ? `floor ${floorOf(r.repoId)}` : null)),
        },
      };
    }
    case 'byDay':
      return {
        chart: {
          type: 'stacked-bar',
          unit: 'usd',
          labels: days.map((x) => dayLabel(x.day)),
          series: GROUPS.map((g) => ({ name: KIND_GROUP_LABELS[g], color: GROUP_COLORS[g], values: days.map((x) => round(kindShares(x.byKind).find((k) => k.group === g)?.usd ?? 0)) })).filter((x) => x.values.some((v) => v)),
        },
      };
    case 'byKind': {
      const shares = kindShares(view.total.byKind);
      return { chart: { type: 'donut', unit: 'usd', labels: shares.map((k) => KIND_GROUP_LABELS[k.group]), series: [{ name: 'Spend', values: shares.map((k) => k.usd) }] } };
    }
    case 'wasteByCause': {
      const groups = wasteGroups(view.waste).slice(0, 8);
      return { chart: { type: 'bar', unit: 'usd', labels: groups.map((g) => g.cause), series: [{ name: 'Waste', color: 'bad', values: groups.map((g) => g.usd) }] } };
    }
    case 'perMerge':
      return { chart: { type: 'line', unit: 'usd', labels: days.map((x) => dayLabel(x.day)), series: [{ name: 'Cost per merge', values: trend.points.map((p) => (p === null ? null : round(p))) }] } };
    case null:
    case 'total':
      return { tile: { value: round(view.total.usd), unit: 'usd', good: 'down', spark: days.map((x) => round(x.usd)) } };
    case 'costPerMerge':
      return { tile: { value: view.total.perMerge === null ? null : round(view.total.perMerge), unit: 'usd', good: 'down', spark: trend.points.filter((p): p is number => p !== null), ...(trend.change !== null && { delta: Math.round(trend.change * 100) }) } };
    case 'waste':
      return { tile: { value: round(view.total.wasteUsd), unit: 'usd', good: 'down', spark: days.map((x) => round(x.wasteUsd)), ...(view.total.usd > 0 && { progress: Math.round((view.total.wasteUsd / view.total.usd) * 100) }) } };
    case 'wasteShare':
      return { tile: { value: view.total.usd ? Math.round((view.total.wasteUsd / view.total.usd) * 100) : null, unit: 'pct', good: 'down' } };
    case 'merges':
      return { tile: { value: view.total.merges, unit: 'count', spark: days.map((x) => x.merges) } };
    default:
      return null;
  }
}

function opsOf(d: SourceData, floor: number | null): OpsNumbers | null {
  return floor === null ? d.ops.total : (d.ops.floors.find((f) => f.floor === floor) ?? null);
}

function sourceData(s: VisualSource, d: SourceData): Data | string {
  if (s.kind === 'costs') {
    const view = d.costs[s.days];
    return view ? (costsData(view, s, d) ?? 'Unknown costs view') : 'Loading…';
  }
  if (s.kind === 'usage') {
    if (!d.usage.length) return "No reading of Claude's usage yet";
    if (s.limit) {
      const r = d.usage.find((u) => u.type === s.limit);
      return r ? { tile: { value: usedPercent(r.pct), unit: 'pct', good: 'down', progress: usedPercent(r.pct) } } : `No reading of ${s.limit}`;
    }
    return { chart: { type: 'progress', unit: 'pct', max: 100, labels: d.usage.map((u) => barName(u.type)), series: [{ name: 'Used', values: d.usage.map((u) => usedPercent(u.pct)) }] } };
  }
  if (s.kind === 'throughput' && s.byFloor)
    return { chart: { type: 'bar', unit: 'count', labels: d.ops.floors.map((f) => `Floor ${f.floor}`), series: [{ name: 'Merged today', values: d.ops.floors.map((f) => f.mergedToday) }], refs: d.ops.floors.map((f) => `floor ${f.floor}`) } };
  const ops = opsOf(d, s.floor);
  if (!ops) return `There is no floor ${s.floor}`;
  if (s.kind === 'throughput') {
    if (!s.metric) {
      const now = new Date(d.now).getHours();
      return { chart: { type: 'bar', unit: 'count', labels: ops.spark.map((_, i) => `${String((now - (ops.spark.length - 1 - i) + 48) % 24).padStart(2, '0')}:00`), series: [{ name: 'Merges', values: ops.spark }] } };
    }
    const f = FLOW[s.metric];
    const raw = ops[f.key] as number | null;
    return { tile: { value: raw === null ? null : f.pct ? Math.round(raw * 100) : round(raw), unit: f.unit, ...(f.good && { good: f.good }), ...(f.pct && raw !== null && { progress: Math.round(raw * 100) }), ...(s.metric === 'mergedToday' && { spark: ops.spark }) } };
  }
  if (s.stage) return { tile: { value: ops[s.stage], unit: 'count', ...(s.stage === 'needsYou' && { good: 'down' as const }), ...(s.floor !== null && { ref: `floor ${s.floor}` }) } };
  const stages = Object.keys(STAGE_LABELS) as (keyof typeof STAGE_LABELS)[];
  return { chart: { type: 'bar', unit: 'count', labels: stages.map((k) => STAGE_LABELS[k]), series: [{ name: s.floor === null ? 'Office' : `Floor ${s.floor}`, values: stages.map((k) => ops[k]) }] } };
}

/** A tile from a series: its total (money, counts) or latest value, with the series as its sparkline. */
function tileFromChart(c: Omit<VisualChart, 'kind' | 'title' | 'source'>): Omit<VisualTile, 'label' | 'source'> {
  const vals = c.labels.map((_, j) => c.series.reduce<number | null>((a, s) => (s.values[j] === null ? a : (a ?? 0) + s.values[j]!), null)).filter((v): v is number => v !== null);
  const sum = c.unit === 'usd' || c.unit === 'count';
  return { value: vals.length ? round(sum ? vals.reduce((a, b) => a + b, 0) : vals[vals.length - 1]) : null, unit: c.unit, ...(vals.length > 1 && { spark: vals }) };
}

function resolveChart(c: VisualChart, d: SourceData): Resolved<VisualChart> {
  const s = parseSource(c.source);
  if (!s) return c;
  const got = sourceData(s, d);
  if (typeof got === 'string') return { ...c, missing: got };
  if ('tile' in got) return { ...c, missing: `${c.source} is one number: show it as a dashboard tile` };
  // The CEO's chart type wins (a donut of floors), except a progress bar or donut for days.
  const type = c.type === 'bar' && got.chart.type !== 'bar' ? got.chart.type : c.type;
  return { ...c, ...got.chart, type, title: c.title, ...(c.max && { max: c.max }) };
}

function resolveTile(t: VisualTile, d: SourceData): VisualTile & { missing?: string } {
  const s = parseSource(t.source);
  if (!s) return t;
  const got = sourceData(s, d);
  if (typeof got === 'string') return { ...t, missing: got };
  const live = 'tile' in got ? got.tile : tileFromChart(got.chart);
  return { ...live, label: t.label, ...(t.good && { good: t.good }), ...(t.ref && { ref: t.ref }), source: t.source };
}

/** A table from a series: the label column, then a column per series. */
function tableFromChart(c: VisualChart, t: VisualTable): VisualTable {
  return { ...t, columns: [{ label: t.columns[0]?.label || 'Item', unit: '' }, ...c.series.map((s) => ({ label: s.name, unit: c.unit }))], rows: c.labels.map((l, j) => [l, ...c.series.map((s) => s.values[j])]) };
}

/** The costs dashboard a bare `costs:<N>d` source stands for. */
function costsDashboard(days: number): Pick<Extract<ChatVisual, { kind: 'dashboard' }>, 'tiles' | 'charts'> {
  const src = (v: string) => `costs:${days}d:${v}`;
  return {
    tiles: [
      { label: 'Spend', value: null, unit: 'usd', source: src('total') },
      { label: 'Per merge', value: null, unit: 'usd', source: src('costPerMerge') },
      { label: 'Waste', value: null, unit: 'usd', source: src('waste') },
      { label: 'Merges', value: null, unit: 'count', source: src('merges') },
    ],
    charts: [
      { kind: 'chart', type: 'bar', title: 'By floor', unit: 'usd', labels: [], series: [], source: src('byFloor') },
      { kind: 'chart', type: 'donut', title: 'By kind of work', unit: 'usd', labels: [], series: [], source: src('byKind') },
    ],
  };
}

/** A visual with its sources' numbers filled in. Inline values are kept as written. */
export function resolveVisual(v: ChatVisual, d: SourceData): Resolved {
  if (v.kind === 'chart') return resolveChart(v, d);
  if (v.kind === 'table') {
    const s = parseSource(v.source);
    if (!s) return v;
    const got = sourceData(s, d);
    if (typeof got === 'string') return { ...v, missing: got };
    if ('tile' in got) return { ...v, columns: [{ label: 'Value', unit: got.tile.unit }], rows: [[got.tile.value]] };
    return tableFromChart({ kind: 'chart', title: v.title, ...got.chart }, v);
  }
  const s = parseSource(v.source);
  let base = v;
  if (s?.kind === 'costs' && s.view === null && !v.tiles.length && !v.charts.length) base = { ...v, ...costsDashboard(s.days) };
  else if (s && !v.tiles.length && !v.charts.length) base = { ...v, charts: [{ kind: 'chart', type: 'bar', title: '', unit: 'count', labels: [], series: [], source: v.source }] };
  return { ...base, tiles: base.tiles.map((t) => resolveTile(t, d)), charts: base.charts.map((c) => resolveChart(c, d)) };
}
