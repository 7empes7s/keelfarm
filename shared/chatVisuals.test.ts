import { describe, expect, it } from 'vitest';
import { parseCeoMessage } from './chatParts';
import { capSlices, deltaTone, formatDelta, formatDuration, formatValue, numberOf, parseSource, parseVisual, SERIES_COLORS, sortRows, visualText, xTicks, withVisualsText, VISUAL_CHARS } from './chatVisuals';

const fence = '```';

describe('parseSource', () => {
  it('reads the costs, throughput, backlog and usage sources', () => {
    expect(parseSource('costs:7d:byFloor')).toEqual({ kind: 'costs', days: 7, view: 'byFloor' });
    expect(parseSource('costs:30d')).toEqual({ kind: 'costs', days: 30, view: null });
    expect(parseSource('throughput:floor:3')).toEqual({ kind: 'throughput', floor: 3, metric: null });
    expect(parseSource('throughput:office:qaRounds')).toEqual({ kind: 'throughput', floor: null, metric: 'qaRounds' });
    expect(parseSource('throughput:byFloor')).toEqual({ kind: 'throughput', floor: null, metric: 'mergedToday', byFloor: true });
    expect(parseSource('backlog:floor:2:ready')).toEqual({ kind: 'backlog', floor: 2, stage: 'ready' });
    expect(parseSource('backlog:office')).toEqual({ kind: 'backlog', floor: null, stage: null });
    expect(parseSource('usage')).toEqual({ kind: 'usage', limit: null });
  });

  it('refuses what it does not know, so the block keeps its inline values', () => {
    for (const s of ['costs:7d:byMoon', 'costs:90d', 'costs', 'throughput:floor:x', 'backlog:floor:2:soon', 'weather', 42, null]) expect(parseSource(s)).toBeNull();
  });
});

describe('parseVisual', () => {
  it('reads an inline chart, trimming values to its labels', () => {
    const c = parseVisual('chart', JSON.stringify({ type: 'bar', title: 'Cost by floor', unit: '$', labels: ['Floor 1', 'Floor 2'], series: [{ name: 'Spend', values: ['$3.20', 1.1, 9] }], refs: ['floor 1', ''] }));
    expect(c).toEqual({ kind: 'chart', type: 'bar', title: 'Cost by floor', unit: 'usd', labels: ['Floor 1', 'Floor 2'], series: [{ name: 'Spend', values: [3.2, 1.1] }], refs: ['floor 1', null] });
  });

  it('reads points as one series, and an unknown chart type as a bar chart', () => {
    const c = parseVisual('chart', JSON.stringify({ type: 'pie3d', title: 'QA', data: [{ label: 'Passed', value: 7, ref: 'qa: floor 3 #116' }, { label: 'Failed', value: 2 }] }));
    expect(c).toMatchObject({ type: 'bar', labels: ['Passed', 'Failed'], series: [{ name: 'QA', values: [7, 2] }], refs: ['qa: floor 3 #116', null], unit: 'count' });
  });

  it('takes a chart with only a live source', () => {
    expect(parseVisual('chart', '{"type":"donut","title":"By kind","source":"costs:7d:byKind"}')).toEqual({ kind: 'chart', type: 'donut', title: 'By kind', unit: 'count', labels: [], series: [], source: 'costs:7d:byKind' });
  });

  it('gives null for broken JSON, nothing to draw, an unknown source alone or an oversized block', () => {
    expect(parseVisual('chart', '{"type":"bar", labels: [1,2]')).toBeNull();
    expect(parseVisual('chart', '{"type":"bar","labels":["a"],"series":[{"values":["x"]}]}')).toBeNull();
    expect(parseVisual('chart', '{"source":"weather:today"}')).toBeNull();
    expect(parseVisual('table', '[1,2,3]')).toBeNull();
    expect(parseVisual('chart', JSON.stringify({ labels: ['a'], series: [{ values: [1] }], title: 'x'.repeat(VISUAL_CHARS) }))).toBeNull();
  });

  it('reads a table with object rows, and numbers without a unit as counts', () => {
    const t = parseVisual('table', JSON.stringify({ title: 'PRs', columns: ['PR', { label: 'Cost', unit: 'usd' }, 'Rounds'], rows: [{ PR: 'floor 1 #4', Cost: '2.5', Rounds: 3 }, ['floor 1 #5', 1, 1]] }));
    expect(t).toEqual({
      kind: 'table',
      title: 'PRs',
      columns: [
        { label: 'PR', unit: '' },
        { label: 'Cost', unit: 'usd' },
        { label: 'Rounds', unit: 'count' },
      ],
      rows: [
        ['floor 1 #4', 2.5, 3],
        ['floor 1 #5', 1, 1],
      ],
    });
  });

  it('reads a dashboard, dropping bad tiles and keeping at most two charts', () => {
    const chart = { labels: ['a'], series: [{ values: [1] }] };
    const d = parseVisual('dashboard', JSON.stringify({ title: 'How we do', tiles: [{ label: 'Spend', value: 12.5, unit: 'usd', delta: -8, good: 'down', spark: [1, 2, 'x', 3], progress: 140 }, { label: 'No value' }, { label: 'Live', source: 'costs:7d:total' }], charts: [chart, chart, chart] }));
    expect(d).toMatchObject({ kind: 'dashboard', tiles: [{ label: 'Spend', value: 12.5, unit: 'usd', delta: -8, good: 'down', spark: [1, 2, 3], progress: 100 }, { label: 'Live', value: null, source: 'costs:7d:total' }] });
    expect(d?.kind === 'dashboard' && d.charts.length).toBe(2);
  });
});

describe('parseCeoMessage with visuals', () => {
  it('lifts a chart block out of the text', () => {
    const p = parseCeoMessage(`Floor 2 costs the most.\n\n${fence}chart\n{"title":"Spend","labels":["Floor 1","Floor 2"],"series":[{"values":[1,4]}]}\n${fence}`);
    expect(p.text).toBe('Floor 2 costs the most.');
    expect(p.visuals).toHaveLength(1);
  });

  it('leaves a malformed block in the text, as written', () => {
    const raw = `Here.\n${fence}chart\n{"title": oops}\n${fence}`;
    expect(parseCeoMessage(raw)).toEqual({ text: raw });
  });
});

describe('formatting', () => {
  it('formats money, percentages, durations and counts', () => {
    expect(formatValue(3.2, 'usd')).toBe('$3.20');
    expect(formatValue(123.4, 'usd')).toBe('$123');
    expect(formatValue(1520, 'usd')).toBe('$1.5k');
    expect(formatValue(12.5, 'usd', true)).toBe('$13');
    expect(formatValue(0, 'usd', true)).toBe('$0');
    expect(formatValue(72.04, 'pct')).toBe('72%');
    expect(formatValue(252_000, 'ms')).toBe('4m 12s');
    expect(formatValue(1204, 'count')).toBe('1,204');
    expect(formatValue(null, 'usd')).toBe('–');
    expect(formatDuration(850)).toBe('850ms');
    expect(formatDuration(7_500_000)).toBe('2h 5m');
    expect(formatDuration(3 * 86_400_000 + 4 * 3_600_000)).toBe('3d 4h');
    expect(numberOf('1,200')).toBe(1200);
    expect(numberOf('72%')).toBe(72);
    expect(numberOf('soon')).toBeNull();
  });

  it('shows a change as an arrow, and whether it is good', () => {
    expect(formatDelta(12.4)).toBe('↑ 12%');
    expect(formatDelta(-3)).toBe('↓ 3%');
    expect(formatDelta(0.2)).toBe('→ 0%');
    expect(deltaTone({ delta: 10 })).toBe('good');
    expect(deltaTone({ delta: 10, good: 'down' })).toBe('bad');
    expect(deltaTone({ delta: -10, good: 'down' })).toBe('good');
    expect(deltaTone({})).toBeNull();
  });

  it('sorts a column, numbers by value and text A–Z, empty cells last', () => {
    const rows = [
      ['b', 2],
      ['a', null],
      ['c', 10],
    ];
    expect(sortRows(rows, 1, 'desc').map((r) => r[0])).toEqual(['c', 'b', 'a']);
    expect(sortRows(rows, 1, 'asc').map((r) => r[0])).toEqual(['b', 'c', 'a']);
    expect(sortRows(rows, 0, 'asc').map((r) => r[0])).toEqual(['a', 'b', 'c']);
  });
});

describe('visualText', () => {
  it('writes a chart, table and dashboard as text for Telegram', () => {
    const chart = parseVisual('chart', '{"title":"Spend","unit":"usd","labels":["Floor 1","Floor 2"],"series":[{"values":[1,4.5]}]}')!;
    expect(visualText(chart)).toBe('📊 Spend\nFloor 1: $1.00\nFloor 2: $4.50');
    const table = parseVisual('table', '{"title":"PRs","columns":["PR","Rounds"],"rows":[["#4",3]]}')!;
    expect(visualText(table)).toBe('📋 PRs\nPR | Rounds\n#4 | 3');
    const dash = parseVisual('dashboard', '{"title":"Week","tiles":[{"label":"Spend","value":12,"unit":"usd","delta":-8},{"label":"Live","source":"costs:7d:total"}]}')!;
    expect(visualText(dash)).toBe('📈 Week\nSpend: $12.00 (↓ 8%)\nLive: live in the office');
    expect(withVisualsText('Floor 2 costs most.', [chart])).toBe('Floor 2 costs most.\n\n📊 Spend\nFloor 1: $1.00\nFloor 2: $4.50');
  });
});

describe('capSlices', () => {
  const donut = (n: number) => ({ kind: 'chart' as const, type: 'donut' as const, title: 'Spend', unit: 'usd' as const, labels: Array.from({ length: n }, (_, i) => `K${i}`), series: [{ name: 'Spend', values: Array.from({ length: n }, (_, i) => i + 1) }], refs: Array.from({ length: n }, (_, i) => `#${i}`) });

  it('keeps a donut of up to 8 slices as it is, each with its own colour', () => {
    const c = donut(SERIES_COLORS);
    expect(capSlices(c)).toBe(c);
    expect(SERIES_COLORS).toBe(8);
  });

  it('keeps the 7 biggest slices in order and groups the rest as Other', () => {
    const c = capSlices(donut(11)); // values 1..11: the biggest are K4..K10, the rest 1+2+3+4 = 10
    expect(c.labels).toEqual(['K4', 'K5', 'K6', 'K7', 'K8', 'K9', 'K10', 'Other']);
    expect(c.series[0].values).toEqual([5, 6, 7, 8, 9, 10, 11, 10]);
    expect(c.refs).toEqual(['#4', '#5', '#6', '#7', '#8', '#9', '#10', null]);
  });

  it('leaves other charts alone', () => {
    const bars = { ...donut(12), type: 'bar' as const };
    expect(capSlices(bars)).toBe(bars);
  });
});

describe('xTicks', () => {
  const days = Array.from({ length: 14 }, (_, i) => `Nov ${i + 1}`);

  it('shows every label when they fit', () => {
    expect(xTicks(['Build', 'QA', 'Fix'], 270, 7).map((t) => t.text)).toEqual(['Build', 'QA', 'Fix']);
  });

  it('skips labels rather than squeezing or cutting them in a narrow chart', () => {
    const ticks = xTicks(days, 200, 7);
    expect(ticks.map((t) => t.text)).toEqual(['Nov 1', 'Nov 5', 'Nov 9', 'Nov 13']);
    expect(ticks.length * 7 * Math.max(...ticks.map((t) => t.text.length + 1))).toBeLessThanOrEqual(200);
    expect(ticks[0]).toEqual({ i: 0, text: 'Nov 1' });
  });

  it('cuts long labels with an ellipsis, never past 8 characters, before skipping any', () => {
    expect(xTicks(['CEO', 'Floor 1', 'weather-api', 'Floor 3'], 248, 7).map((t) => t.text)).toEqual(['CEO', 'Floor 1', 'weathe…', 'Floor 3']);
    const ticks = xTicks(['Infrastructure', 'Documentation'], 400, 7);
    expect(ticks.map((t) => t.text)).toEqual(['Infrast…', 'Documen…']);
    expect(xTicks(['Infrastructure', 'Documentation', 'Refactoring'], 120, 7)).toEqual([
      { i: 0, text: 'Infrast…' },
      { i: 2, text: 'Refacto…' },
    ]);
  });
});
