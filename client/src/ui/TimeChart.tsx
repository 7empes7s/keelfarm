// A time-series chart (#587), for any chart that carries its points' times (VisualChart.time): x proportional to
// time with ticks on round hours and a date marker at midnight, a gap in the readings left as a gap, points instead
// of lines while there are only a few, the y axis fitted to the data (percentages up to 100), and hover (or a tap)
// showing a thin crosshair with its readout in a line just above it. The scale is pure, in shared/timeScale.ts.
import { useState, type PointerEvent } from 'react';
import { formatValue, type VisualChart } from '../../../shared/chatVisuals';
import { nearestAt, SPARSE_POINTS, timeRuns, timeTicks, timeX, yTop, type TimeAxis } from '../../../shared/timeScale';
import './timeChart.css';

const PAD = { l: 40, r: 10, t: 10, b: 22 };
const EDGE_PX = 18; // a tick this near an edge is a gridline only: its label would spill out of the card or crowd the next
const when = (at: number) => new Date(at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });

interface Props {
  c: VisualChart;
  time: TimeAxis;
  hidden: Set<number>;
  w: number;
  h: number;
  color: (i: number) => string;
}

export function TimeChart({ c, time, hidden, w, h, color }: Props) {
  const [sel, setSel] = useState<number | null>(null);
  const shown = c.series.map((s, i) => ({ s, i })).filter((x) => !hidden.has(x.i));
  const plotW = Math.max(1, w - PAD.l - PAD.r);
  const plotH = h - PAD.t - PAD.b;
  const top = yTop(Math.max(0, ...shown.flatMap(({ s }) => s.values.map((v) => v ?? 0))), c.unit === 'pct');
  const x = (t: number) => timeX(t, time.from, time.to, PAD.l, PAD.l + plotW);
  const y = (v: number) => PAD.t + plotH * (1 - Math.min(Math.max(v, 0), top) / top);
  const readings = Math.max(0, ...shown.map(({ s }) => s.values.filter((v) => v !== null).length));
  const sparse = readings < SPARSE_POINTS;
  const at = sel !== null && sel < time.at.length ? sel : null;
  const pick = (e: PointerEvent<SVGSVGElement>) => {
    if (e.pointerType !== 'mouse' && !e.buttons) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / (r.width || 1)) * w;
    setSel(nearestAt(time.at, time.from + ((px - PAD.l) / plotW) * (time.to - time.from)));
  };
  const cx = at === null ? 0 : x(time.at[at]);
  return (
    <div className="tc">
      <svg viewBox={`0 0 ${w} ${h}`} className="viz-svg tc-svg" aria-hidden onPointerMove={pick} onPointerDown={pick} onPointerLeave={(e) => e.pointerType === 'mouse' && setSel(null)}>
        <g className="tc-grid">
          {[0, top / 2, top].map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={PAD.l + plotW} y1={y(v)} y2={y(v)} />
              <text x={PAD.l - 4} y={y(v) + 3} textAnchor="end">
                {formatValue(v, c.unit, true)}
              </text>
            </g>
          ))}
          {timeTicks(time.from, time.to, plotW).map((t) => {
            const tx = x(t.at);
            const edge = tx < PAD.l + EDGE_PX || tx > PAD.l + plotW - EDGE_PX;
            return (
              <g key={t.at} className={t.midnight ? 'tc-day' : undefined}>
                <line x1={tx} x2={tx} y1={PAD.t} y2={PAD.t + plotH} />
                {!edge && (
                  <text x={tx} y={h - 6} textAnchor="middle">
                    {t.text}
                  </text>
                )}
              </g>
            );
          })}
        </g>
        {shown.map(({ s, i }) => (
          <g key={i} stroke={color(i)} fill={color(i)}>
            {timeRuns(time.at, s.values, time.gapMs).map((run) =>
              sparse || run.length === 1 ? (
                run.map((j) => <circle key={j} cx={x(time.at[j])} cy={y(s.values[j]!)} r={sparse ? 3.5 : 2} stroke="none" />)
              ) : (
                <path key={run[0]} d={run.map((j, k) => `${k ? 'L' : 'M'}${x(time.at[j]).toFixed(1)},${y(s.values[j]!).toFixed(1)}`).join('')} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              ),
            )}
          </g>
        ))}
        {at !== null && (
          <g className="tc-cursor">
            <line x1={cx} x2={cx} y1={PAD.t} y2={PAD.t + plotH} />
            {shown.map(({ s, i }) => s.values[at] !== null && <circle key={i} cx={cx} cy={y(s.values[at]!)} r={4} fill={color(i)} />)}
          </g>
        )}
        <rect x={PAD.l} y={PAD.t} width={plotW} height={plotH} className="tc-hit" />
      </svg>
      {at !== null && (
        // above the plot, sliding along with the crosshair and kept inside the card, so it hides none of the lines
        <div className="tc-tip" style={{ left: cx, transform: `translateX(-${Math.round((cx / w) * 100)}%)` }}>
          <b>{when(time.at[at])}</b>
          {shown.map(({ s, i }) => (
            <span key={i} className="tc-tip-row" title={s.name}>
              <span className="tc-key" style={{ background: color(i) }} />
              <b>{formatValue(s.values[at], c.unit)}</b>
            </span>
          ))}
        </div>
      )}
      {sparse && (
        <p className="muted small tc-note">
          Collecting data: {readings} reading{readings === 1 ? '' : 's'} so far, a line from {SPARSE_POINTS}.
        </p>
      )}
    </div>
  );
}
