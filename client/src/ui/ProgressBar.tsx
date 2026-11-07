// The office's progress bar and ring (#140, docs/design.md "Progress bar"): one thin rounded track with a label and a
// value above it, filled to a share, stacked in parts, split into steps (the one running now pulses), or moving while
// nobody knows how far along it is. Coloured by tone from the tokens, and never colour alone: the words say it too.
// With onClick or href the whole bar is a 44 px button or link to what it counts. The values come from
// shared/progressBars.ts; the ring is the compact form for avatars and tight cards.
import type { ReactNode } from 'react';
import type { BarPart, BarTone } from '../../../shared/progressBars';
import './progressBar.css';
import { Icon } from './Icon';

export interface ProgressBarProps {
  label: ReactNode;
  /** The number, at the right of the label, e.g. "42%" or "3 of 10". */
  value?: ReactNode;
  /** 0..1 filled; null: indeterminate (it moves). Leave out with parts or steps. */
  pct?: number | null;
  /** A stacked bar: each part in --ds-series-1…4, in order, with a legend. */
  parts?: BarPart[];
  /** Stages: the ones before `at` done, `at` running now. */
  steps?: { labels: string[]; at: number };
  tone?: BarTone;
  /** A short line under the bar, e.g. the time against the median. */
  note?: ReactNode;
  /** What it says to a screen reader, with its numbers. */
  aria: string;
  onClick?: () => void;
  href?: string;
  /** What tapping it does, e.g. "Open the Kanban". */
  tap?: string;
  /** With onClick: the list it opens is showing. */
  expanded?: boolean;
  /** No step labels, no legend: for cards. */
  compact?: boolean;
  className?: string;
}

const clamp = (x: number) => Math.min(1, Math.max(0, x));

function Track({ pct, parts, steps, tone = 'neutral', aria, interactive }: Pick<ProgressBarProps, 'pct' | 'parts' | 'steps' | 'tone' | 'aria'> & { interactive: boolean }) {
  // Inside a button or link the track is presentational: the words go in its hidden text (ProgressBar).
  const role = (r: string) => (interactive ? { 'aria-hidden': true } : { role: r, 'aria-label': aria });
  if (parts) {
    const total = parts.reduce((n, p) => n + p.value, 0);
    return (
      <span className="pb-track pb-parts" {...role('img')}>
        {total > 0 && parts.map((p, i) => p.value > 0 && <span key={p.key} className={`pb-part pb-s${(i % 4) + 1}`} style={{ flexGrow: p.value }} />)}
      </span>
    );
  }
  if (steps) {
    const n = steps.labels.length;
    const meter = interactive ? { 'aria-hidden': true } : { role: 'progressbar', 'aria-label': aria, 'aria-valuemin': 0, 'aria-valuemax': n, 'aria-valuenow': Math.min(steps.at, n), 'aria-valuetext': steps.labels[steps.at] ?? 'done' };
    return (
      <span className={`pb-steps pb-${tone}`} {...meter}>
        {steps.labels.map((l, i) => (
          <span key={l} className={`pb-step ${i < steps.at ? 'pb-step-done' : i === steps.at ? 'pb-step-now' : ''}`} />
        ))}
      </span>
    );
  }
  const known = typeof pct === 'number';
  const meter = interactive
    ? { 'aria-hidden': true }
    : known
      ? { role: 'progressbar', 'aria-label': aria, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(clamp(pct) * 100) }
      : { role: 'progressbar', 'aria-label': aria, 'aria-busy': true };
  return (
    <span className={`pb-track pb-${tone} ${known ? '' : 'pb-indeterminate'}`} {...meter}>
      <span className="pb-fill" style={known ? { inlineSize: `${clamp(pct) * 100}%` } : undefined} />
    </span>
  );
}

export function ProgressBar(p: ProgressBarProps) {
  const interactive = !!(p.onClick || p.href);
  const body = (
    <>
      <span className="pb-head">
        <span className="pb-label">{p.label}</span>
        {p.value !== undefined && <span className="pb-value">{p.value}</span>}
        {interactive && (
          <span className="pb-chevron" aria-hidden>
            <Icon name={p.href ? 'external-link' : 'chevron-right'} />
          </span>
        )}
      </span>
      <Track pct={p.pct} parts={p.parts} steps={p.steps} tone={p.tone} aria={p.aria} interactive={interactive} />
      {!p.compact && p.steps && (
        <span className="pb-step-labels" aria-hidden>
          {p.steps.labels.map((l, i) => (
            <span key={l} className={i === p.steps!.at ? 'pb-step-label-now' : ''}>
              {l}
            </span>
          ))}
        </span>
      )}
      {!p.compact && p.parts && p.parts.length > 1 && (
        <span className="pb-legend" aria-hidden>
          {p.parts.map((x, i) => (
            <span key={x.key}>
              <i className={`pb-dot pb-s${(i % 4) + 1}`} />
              {x.label} {x.value}
            </span>
          ))}
        </span>
      )}
      {p.note && <span className="pb-note">{p.note}</span>}
      {interactive && <span className="sr-only">{p.tap ? `${p.aria}. ${p.tap}` : p.aria}</span>}
    </>
  );
  const cls = `pb ${p.compact ? 'pb-compact' : ''} ${interactive ? 'pb-tap' : ''} ${p.className ?? ''}`;
  if (p.href)
    return (
      <a className={cls} href={p.href} target="_blank" rel="noreferrer" title={p.tap}>
        {body}
      </a>
    );
  if (p.onClick)
    return (
      <button type="button" className={cls} onClick={p.onClick} aria-expanded={p.expanded} title={p.tap}>
        {body}
      </button>
    );
  return <span className={cls}>{body}</span>;
}

const R = 15;
const C = 2 * Math.PI * R;
const GAP = 2.5;

/** The compact form: a ring filled to `pct`, or split into `steps`, with an optional glyph inside. */
export function ProgressRing({ pct, steps, tone = 'neutral', aria, children, size = 28 }: { pct?: number; steps?: { labels: string[]; at: number }; tone?: BarTone; aria: string; children?: ReactNode; size?: number }) {
  const n = steps?.labels.length ?? 0;
  const seg = n ? C / n : C;
  const meter = steps
    ? { 'aria-valuemin': 0, 'aria-valuemax': n, 'aria-valuenow': Math.min(steps.at, n), 'aria-valuetext': steps.labels[steps.at] ?? 'done' }
    : { 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(clamp(pct ?? 0) * 100) };
  return (
    <span className={`pr pb-${tone}`} role="progressbar" aria-label={aria} {...meter} style={{ inlineSize: size, blockSize: size }}>
      <svg viewBox="0 0 36 36" aria-hidden>
        {steps ? (
          steps.labels.map((l, i) => (
            <circle
              key={l}
              cx="18"
              cy="18"
              r={R}
              className={`pr-arc ${i < steps.at ? 'pr-done' : i === steps.at ? 'pr-now' : ''}`}
              strokeDasharray={`${seg - GAP} ${C - seg + GAP}`}
              strokeDashoffset={-i * seg}
            />
          ))
        ) : (
          <>
            <circle cx="18" cy="18" r={R} className="pr-arc" />
            <circle cx="18" cy="18" r={R} className="pr-arc pr-done" strokeDasharray={`${clamp(pct ?? 0) * C} ${C}`} />
          </>
        )}
      </svg>
      {children && <span className="pr-glyph">{children}</span>}
    </span>
  );
}
