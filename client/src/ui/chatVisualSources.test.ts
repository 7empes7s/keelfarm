import { describe, expect, it } from 'vitest';
import type { CostDayRow, CostSplit, CostsView } from '../../../shared/costs';
import type { OpsNumbers, OpsView } from '../../../shared/ops';
import { parseVisual, type ChatVisual, type VisualChart, type VisualDashboard, type VisualTable } from '../../../shared/chatVisuals';
import { costDays, resolveVisual, type SourceData } from './chatVisualSources';

const split = (usd: number, o: Partial<CostSplit> = {}): CostSplit => ({ usd, sessions: 1, merges: 0, perMerge: null, wasteUsd: 0, wasteSessions: 0, byKind: {}, ...o });
const day = (d: string, usd: number, o: Partial<CostSplit> = {}): CostDayRow => ({ day: d, ...split(usd, o) });

const costs: CostsView = {
  days: 7,
  since: 0,
  total: split(10, { merges: 4, perMerge: 2.5, wasteUsd: 2, byKind: { issue: 6, qa: 3, 'ceo-chat': 1 } }),
  floors: [
    { repoId: 'acme/shop', ...split(3) },
    { repoId: 'acme/api', ...split(6) },
    { repoId: '', ...split(1) },
  ],
  byDay: [day('2026-11-06', 6, { merges: 3, perMerge: 2, byKind: { issue: 4, qa: 2 } }), day('2026-11-05', 4, { merges: 1, perMerge: 4, byKind: { issue: 4 } })], // newest first
  top: [],
  waste: [{ at: 0, repoId: 'acme/shop', agent: 'a', kind: 'qa', issue: 1, pr: 2, usd: 2, why: 'QA round 3', cause: 'QA past round 2', streak: 1 }],
  kinds: [],
  startup: [],
};

const nums = (o: Partial<OpsNumbers> = {}): OpsNumbers => ({
  ready: 4, building: 2, inQa: 1, fixing: 1, toMerge: 0, needsYou: 1, triage: 0,
  mergedToday: 3, mergedHour: 1, spark: [0, 1, 2],
  leadMs: 3_600_000, qaWaitMs: null, qaPass: 0.75, qaFirstPass: 0.5, qaRoundsPerMerge: 1.4,
  ciPass: 0.9, ciRuns: 10, ciMs: null, busy: 2, idle: 1, errors: 0, costToday: 1,
  ...o,
});
const ops: OpsView = { floors: [{ repoId: 'acme/shop', floor: 1, alarms: 0, ...nums({ ready: 1, mergedToday: 2 }) }, { repoId: 'acme/api', floor: 2, alarms: 0, ...nums({ mergedToday: 1 }) }], total: nums(), ceoCostToday: 0, alarms: [] };

const data = (o: Partial<SourceData> = {}): SourceData => ({
  costs: { 7: costs },
  ops,
  floors: [
    { floor: 1, repoId: 'acme/shop' },
    { floor: 2, repoId: 'acme/api' },
  ],
  usage: [{ type: 'five_hour', pct: 42, resetsAt: null, at: 0 }],
  now: new Date(2026, 10, 7, 14, 30).getTime(),
  ...o,
});
const v = (kind: 'chart' | 'table' | 'dashboard', o: object) => parseVisual(kind, JSON.stringify(o))!;

describe('resolveVisual', () => {
  it('fills a chart from costs by floor, costliest first, each floor tappable', () => {
    const c = resolveVisual(v('chart', { type: 'bar', title: 'Where it went', source: 'costs:7d:byFloor' }), data()) as VisualChart;
    expect(c.title).toBe('Where it went');
    expect(c.labels).toEqual(['Floor 2', 'Floor 1', 'CEO']);
    expect(c.series[0].values).toEqual([6, 3, 1]);
    expect(c.refs).toEqual(['floor 2', 'floor 1', null]);
    expect(c.unit).toBe('usd');
  });

  it('draws spend by day as stacked kinds, oldest day first', () => {
    const c = resolveVisual(v('chart', { source: 'costs:7d:byDay' }), data()) as VisualChart;
    expect(c.type).toBe('stacked-bar');
    expect(c.labels).toEqual(['Nov 5', 'Nov 6']);
    expect(c.series.map((s) => [s.name, s.values])).toEqual([
      ['Build', [4, 4]],
      ['QA', [0, 2]],
    ]);
  });

  it('keeps the chart type the CEO asked for over the source default', () => {
    expect((resolveVisual(v('chart', { type: 'donut', source: 'costs:7d:byFloor' }), data()) as VisualChart).type).toBe('donut');
  });

  it('expands a bare costs source into the costs dashboard', () => {
    const d = resolveVisual(v('dashboard', { title: 'Week', source: 'costs:7d' }), data()) as VisualDashboard;
    expect(d.tiles.map((t) => [t.label, t.value])).toEqual([
      ['Spend', 10],
      ['Per merge', 2.5],
      ['Waste', 2],
      ['Merges', 4],
    ]);
    expect(d.tiles[1]).toMatchObject({ delta: -50, good: 'down', spark: [4, 2] }); // $4 then $2 a merge
    expect(d.tiles[2].progress).toBe(20);
    expect((d.charts[1] as VisualChart).labels).toEqual(['Build', 'QA', 'CEO']);
  });

  it('fills tiles and charts from mission control, the floors and usage, live', () => {
    const d = resolveVisual(
      v('dashboard', {
        tiles: [
          { label: 'Merged', source: 'throughput:floor:1:mergedToday' },
          { label: 'First pass', source: 'throughput:office:qaFirstPass' },
          { label: 'Lead', source: 'throughput:office:lead' },
          { label: 'Ready', source: 'backlog:floor:1:ready' },
          { label: '5h', source: 'usage:five_hour' },
        ],
        charts: [{ source: 'throughput:office' }, { source: 'backlog:floor:2' }],
      }),
      data(),
    ) as VisualDashboard;
    expect(d.tiles.map((t) => [t.value, t.unit])).toEqual([
      [2, 'count'],
      [50, 'pct'],
      [3_600_000, 'ms'],
      [1, 'count'],
      [42, 'pct'],
    ]);
    expect(d.tiles[3].ref).toBe('floor 1');
    const [hourly, backlog] = d.charts as VisualChart[];
    expect(hourly.labels).toEqual(['12:00', '13:00', '14:00']);
    expect(backlog.series[0].values).toEqual([4, 2, 1, 1, 0, 1, 0]);
    expect((resolveVisual(v('chart', { source: 'throughput:byFloor' }), data()) as VisualChart).series[0].values).toEqual([2, 1]);
    expect((resolveVisual(v('chart', { source: 'usage' }), data()) as VisualChart).type).toBe('progress');
  });

  it('turns a series into a table with a column per series', () => {
    const t = resolveVisual(v('table', { title: 'Floors', columns: ['Floor'], source: 'costs:7d:byFloor' }), data()) as VisualTable;
    expect(t.columns).toEqual([
      { label: 'Floor', unit: '' },
      { label: 'Spend', unit: 'usd' },
    ]);
    expect(t.rows[0]).toEqual(['Floor 2', 6]);
  });

  it("says why when a source can't be shown yet, never a broken card", () => {
    expect(resolveVisual(v('chart', { source: 'costs:30d:byFloor' }), data())).toMatchObject({ missing: 'Loading…' });
    expect(resolveVisual(v('chart', { source: 'backlog:floor:9' }), data())).toMatchObject({ missing: 'There is no floor 9' });
    expect(resolveVisual(v('chart', { source: 'usage' }), data({ usage: [] }))).toMatchObject({ missing: "No reading of Claude's usage yet" });
    expect(resolveVisual(v('chart', { source: 'costs:7d:total' }), data()).missing).toMatch(/one number/);
  });

  it('keeps inline values as written', () => {
    const inline: ChatVisual = v('chart', { labels: ['a'], series: [{ values: [1] }] });
    expect(resolveVisual(inline, data())).toBe(inline);
  });
});

describe('costDays', () => {
  it("lists the days of costs a visual's sources need", () => {
    expect(costDays(v('dashboard', { source: 'costs:7d', tiles: [{ label: 'x', source: 'costs:30d:total' }], charts: [{ source: 'backlog:office' }] }))).toEqual([7, 30]);
    expect(costDays(v('chart', { labels: ['a'], series: [{ values: [1] }] }))).toEqual([]);
  });
});
