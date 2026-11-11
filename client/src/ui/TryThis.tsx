// "Try this" (#381): the numbered steps to see a PR's change in its preview, first in the "What this PR changes" sheet
// and on the PR page and approvals card. Each can be ticked off (kept for the tab, per PR); a step with a page opens it
// in the preview; a step QA failed carries QA's note. The steps are read when a card opens (the snapshot can't carry
// every open PR's), again when the PR or QA's report changes.
import { useEffect, useSyncExternalStore } from 'react';
import type { PullInfo, QaView } from '../../../shared/types';
import type { TryThis } from '../../../shared/tryIt';
import { api } from '../api';
import { Icon } from './Icon';
import './tryThis.css';

const ticks = new Map<string, ReadonlySet<number>>();
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const changed = () => listeners.forEach((fn) => fn());
const NONE: ReadonlySet<number> = new Set();

function toggle(key: string, i: number) {
  const next = new Set(ticks.get(key));
  if (!next.delete(i)) next.add(i);
  ticks.set(key, next);
  changed();
}

const latest = new Map<string, TryThis | null>(); // per PR: the last steps read, shown while a newer read is on its way
const read = new Set<string>(); // the versions (PR and QA report) already read

const FROM: Record<TryThis['from'], string> = { qa: 'checked by QA', pr: 'from the PR', issue: "from the issue's acceptance" };

/** An open PR's steps: QA's, the PR body's, else its issue's acceptance criteria (null: none, or not read yet). */
export function useTryThis(repoId: string | undefined, pull: PullInfo | undefined, qa: QaView | undefined): TryThis | null {
  const pr = repoId && pull?.state === 'OPEN' ? `${repoId}#${pull.number}` : null;
  const version = pr && `${pr}@${pull!.updatedAt ?? pull!.createdAt}:${qa?.updatedAt ?? 0}`;
  const steps = useSyncExternalStore(subscribe, () => (pr ? (latest.get(pr) ?? null) : null));
  const number = pull?.number;
  useEffect(() => {
    if (!pr || !version || read.has(version) || !repoId || number == null) return;
    read.add(version);
    api.tryIt(repoId, number).then(
      (r) => {
        latest.set(pr, r.tryThis);
        changed();
      },
      () => read.delete(version), // tried again next time it opens
    );
  }, [pr, version, repoId, number]);
  return steps;
}

/** The pill's label with #380: "Try this · 3 steps". */
export const tryThisLabel = (t: TryThis) => `Try this · ${t.steps.length} ${t.steps.length === 1 ? 'step' : 'steps'}`;

/**
 * The list. `onOpen`: open a step's page in the preview; `current`: the page it shows; `titled: false` inside a card
 * that already says "Try this".
 */
export function TryThisList({ repoId, pull, steps, onOpen, current, titled = true }: { repoId: string; pull: PullInfo; steps: TryThis; onOpen?: (path: string) => void; current?: string; titled?: boolean }) {
  const key = `${repoId}#${pull.number}:${steps.from}`;
  const done = useSyncExternalStore(subscribe, () => ticks.get(key) ?? NONE);
  const n = steps.steps.length;
  return (
    <section className="try" data-part="try" aria-label="Try this">
      <div className="try-head">
        {titled && <h5 className="try-title">Try this</h5>}
        <span className="muted small">
          {done.size} of {n} done · {FROM[steps.from]}
        </span>
      </div>
      <ol className="try-steps">
        {steps.steps.map((s, i) => {
          const on = done.has(i);
          return (
            <li key={i} className={`try-step ${on ? 'try-step-done' : ''} ${s.result === 'fail' ? 'try-step-fail' : ''}`}>
              <button className="try-tick" role="checkbox" aria-checked={on} onClick={() => toggle(key, i)} aria-label={`Step ${i + 1}: ${on ? 'done' : 'not done'}`}>
                {on ? <Icon name="circle-check" /> : <span className="try-num">{i + 1}</span>}
              </button>
              <div className="try-text">
                <span>{s.text}</span>
                {s.result === 'fail' && (
                  <span className="try-qa small">
                    <Icon name="circle-x" /> QA: {s.note ?? 'this step failed'}
                  </span>
                )}
              </div>
              {s.path && onOpen && (
                <button className="btn btn-small" onClick={() => onOpen(s.path!)} aria-current={s.path === current || undefined} title={`Open ${s.path} in the preview`}>
                  Open <Icon name="arrow-up-right" />
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
