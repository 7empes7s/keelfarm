import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useWidth } from './useWidth';
import { clearsPick, pickPoint, pointTone, stepPoint, targetLabelY, TREND_H, TREND_PAD, trendX, trendY } from './trendPoints';
import './trendChart.css';

// A stat card's trend (#325), on the chat charts' pattern (ChatVisuals.tsx): our own SVG at its real width, no chart
// library. Tap, hover or drag along it to pick a day and see its bubble; focused, ← → Home End step through the days.
// An optional target is a dashed line with its label at the end, and the days on either side of it are coloured.

export interface TrendTarget {
  value: number;
  better: 'lower' | 'higher';
  label: string; // "target ≤ 1.5"
}

export function TrendChart({ values, label, bubble, target }: { values: (number | null)[]; label: string; bubble: (i: number) => string; target?: TrendTarget }) {
  const [ref, w] = useWidth(160);
  const [picked, setSel] = useState<number | null>(null);
  const dragging = useRef(false);
  const n = values.length;
  if (values.filter((v) => v !== null).length < 2) return null;
  const sel = picked !== null && picked < n && values[picked] !== null ? picked : null;
  const x = (i: number) => trendX(i, n, w);
  const y = trendY(values, target?.value ?? null);
  const pick = (e: PointerEvent<HTMLDivElement>) => setSel(pickPoint(e.clientX - e.currentTarget.getBoundingClientRect().left, w, values));
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && sel !== null) {
      e.stopPropagation(); // the card's own Back or × stays on the next Escape
      return setSel(null);
    }
    const next = stepPoint(values, sel, e.key);
    if (next === null) return;
    e.preventDefault();
    setSel(next);
  };
  const lift = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    if (clearsPick('lift', e.pointerType, true)) setSel(null);
  };
  // A gap (a day without a number) breaks the line.
  const runs: [number, number][][] = [[]];
  values.forEach((v, i) => (v === null ? runs.push([]) : runs[runs.length - 1].push([x(i), y(v)])));
  const ty = target && y(target.value);
  const latest = values.flatMap((v, i) => (v === null ? [] : [i])).pop()!;
  return (
    <div
      ref={ref}
      className="trend"
      tabIndex={0}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={n - 1}
      aria-valuenow={sel ?? latest}
      aria-valuetext={bubble(sel ?? latest)}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        pick(e);
      }}
      onPointerMove={(e) => (dragging.current || e.pointerType === 'mouse') && pick(e)}
      onPointerUp={lift}
      onPointerCancel={lift}
      onPointerLeave={(e) => !dragging.current && clearsPick('leave', e.pointerType, document.activeElement === e.currentTarget) && setSel(null)}
      onBlur={() => setSel(null)}
      onKeyDown={onKey}
    >
      <svg viewBox={`0 0 ${w} ${TREND_H}`} height={TREND_H} aria-hidden="true">
        {ty !== undefined && (
          <g className="trend-target">
            <line x1={TREND_PAD.x} x2={w - TREND_PAD.x} y1={ty} y2={ty} />
            <text x={w - TREND_PAD.x} y={targetLabelY(ty, target!.label, w, runs.flat())} textAnchor="end">
              {target!.label}
            </text>
          </g>
        )}
        {runs
          .filter((r) => r.length > 1)
          .map((r, k) => (
            <path key={k} className="trend-line" d={r.map(([px, py], m) => `${m ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('')} />
          ))}
        {sel !== null && <line className="trend-cursor" x1={x(sel)} x2={x(sel)} y1={2} y2={TREND_H - 2} />}
        {values.map((v, i) => v !== null && <circle key={i} cx={x(i)} cy={y(v)} r={i === sel ? 5 : 2.5} className={`trend-dot ${target ? `trend-${pointTone(v, target)}` : ''} ${i === sel ? 'trend-on' : ''}`} />)}
      </svg>
      {sel !== null && (
        <span className="trend-bubble" style={{ left: x(sel), transform: `translateX(-${(x(sel) / w) * 100}%)` }}>
          {bubble(sel)}
        </span>
      )}
    </div>
  );
}
