import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { currentStep, liveText, type CeoLive, type LiveStep, type StepLog } from '../../../shared/ceoStream';
import { usedLine, type UsedView } from '../../../shared/used';
import { stepsSummary, stepTime } from './chatCardRules';
import { Icon } from './Icon';
import { iconFor } from './icons';
import { Markdown } from './Markdown';
import { foldText } from './longText';
import './chat.css';

// The CEO chat closer to Claude's (#51): the reply streaming in with its live step line, each reply's step log (#150)
// as one compact row that opens the round's steps, and long messages folded behind "Show more".

type Linked = { linked: (t: string) => string; onFloor: (n: number) => void };

/** A round's steps, oldest first: icon, sentence (its floor and #N linked), time and result. `live`: follows the newest. */
export function StepLogList({ steps, now, live, linked, onFloor }: { steps: readonly LiveStep[]; now: number; live?: boolean } & Linked) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (live && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [live, steps.length]);
  return (
    <ol ref={list} className="step-log">
      {steps.map((s, i) => (
        <li key={i} className={`step-row step-row-${s.state}`}>
          <span className="step-icon" aria-hidden>
            <Icon name={iconFor(s.icon, 'circle-dot')} />
          </span>
          <span className="step-body">
            <Markdown className="step-text" text={linked(s.label)} onFloor={onFloor} />
            {s.note && s.state === 'failed' && <span className="step-note">
                <Icon name="triangle-alert" /> {s.note}
              </span>}
          </span>
          <span className="step-meta">
            {stepTime(s, now)}
            <span className="step-mark" aria-label={s.state === 'running' ? 'running' : s.state === 'failed' ? 'failed' : 'done'}>
              {s.state === 'running' ? <span className="step-spin" /> : <Icon name={s.state === 'failed' ? 'triangle-alert' : 'check'} />}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The CEO's reply as it is written: its text so far (dots before any) and the step it's on; a tap opens the round's log. */
export function LiveBubble({ live, ceoName, linked, onFloor, onOpenLog }: { live: CeoLive | null; ceoName: string; onOpenLog: () => void } & Linked) {
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
          <button type="button" className={`live-foot live-step-${step.state}`} onClick={onOpenLog}>
            <span className={`live-icon ${step.state === 'running' ? 'live-icon-busy' : ''}`} aria-hidden>
              <Icon name={iconFor(step.icon, 'circle-dot')} />
            </span>
            <span className="live-step">{step.label}</span>
            {count > 1 && <span className="muted live-count">step {count}</span>}
          </button>
        )}
      </div>
    </div>
  );
}

/** A finished reply's steps as one row ("⚙ 6 steps · 1 action · 42 s ▸") that opens the round's log; its action cards stay above it. */
export function StepsRow({ log, actions, used, linked, onFloor }: { log: StepLog | null; actions: number; used: UsedView | undefined } & Linked) {
  const [open, setOpen] = useState(false);
  return (
    <div className="steps-row-wrap">
      <button type="button" className="steps-row" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="settings" />
        <span className="grow">{stepsSummary(log, actions)}</span>
        <span className="steps-row-chev" aria-hidden>
          <Icon name="chevron-right" />
        </span>
      </button>
      {open && (
        <div className="steps-row-log">
          {log && <StepLogList steps={log.steps} now={0} linked={linked} onFloor={onFloor} />}
          {log && log.count > log.steps.length && <p className="steps-row-foot muted">{log.steps.length ? `and ${log.count - log.steps.length} earlier steps` : 'Only the newest replies keep each step after a reload'}</p>}
          {used && <p className="steps-row-foot muted">{usedLine(used)}</p>}
        </div>
      )}
    </div>
  );
}

/** A long message shows its whole first blocks (#339), with "Show more · 2 more code blocks". */
export function LongText({ text, children }: { text: string; children: (text: string) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const fold = useMemo(() => foldText(text), [text]);
  if (!fold) return children(text);
  return (
    <>
      {open ? children(text) : fold.shown === null ? <div className="long-folded">{children(text)}</div> : children(fold.shown)}
      <button type="button" className="long-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Show less' : fold.more}
      </button>
    </>
  );
}
