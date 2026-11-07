import { useState, type ReactNode } from 'react';
import { currentStep, liveText, type CeoLive } from '../../../shared/ceoStream';
import { Icon } from './Icon';
import { Markdown } from './Markdown';
import { isLong } from './longText';
import './chat.css';

// The CEO chat closer to Claude's (#51): the reply streaming in with its live step line and a Stop, the "Steps" a
// finished reply keeps, and long messages folded behind "Show more".

/** The CEO's reply as it is written: its text so far (dots before any) and the step it's on. Stop is the composer's. */
export function LiveBubble({ live, ceoName, linked, onFloor }: { live: CeoLive | null; ceoName: string; linked: (t: string) => string; onFloor: (n: number) => void }) {
  const text = live ? liveText(live) : '';
  const step = live && currentStep(live);
  const count = live?.stepCount ?? 0;
  return (
    <div className="bubble-row" aria-live="off">
      <div className="bubble bubble-them bubble-live">
        <div className="bubble-from">{ceoName}</div>
        {text ? (
          <Markdown className="bubble-md" text={linked(text)} onFloor={onFloor} />
        ) : (
          <div className="bubble-typing" aria-label={`${ceoName} is writing`}>
            <span />
            <span />
            <span />
          </div>
        )}
        {step && (
          <div className="live-foot">
            <span className={`live-step live-step-${step.state}`} title={`${count} step${count === 1 ? '' : 's'} so far`}>
              <Icon name={step.state === 'running' ? 'circle-dot' : step.state === 'failed' ? 'x' : 'check'} /> {step.label}
              {step.state === 'running' && '…'}
              {count > 1 && <span className="muted"> · {count} steps</span>}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/** A finished reply's steps, folded. */
export function StepsList({ steps }: { steps: readonly string[] }) {
  return (
    <details className="chat-steps">
      <summary>Steps ({steps.length})</summary>
      <ol>
        {steps.map((s, i) => (
          <li key={i} className={s.startsWith('✗') ? 'chat-step-failed' : undefined}>
            {s}
          </li>
        ))}
      </ol>
    </details>
  );
}

/** A long message shows its start, with "Show more". */
export function LongText({ text, children }: { text: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!isLong(text)) return children;
  return (
    <>
      <div className={open ? undefined : 'long-folded'}>{children}</div>
      <button type="button" className="long-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Show less' : 'Show more'}
      </button>
    </>
  );
}
