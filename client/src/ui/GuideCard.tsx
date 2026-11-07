// "Get the most out of the office" (#109): guide.ts's checklist as a card (pocket's Company tab) or a sheet (the 3D
// office's HUD button). Items tick from the office's state; each open one has a "Do it" that goes where it's done.
import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { go, useFinder } from './goTo';
import { dismissGuide, guideDismissed, guideItems, guideProgress, type GuideItem } from './guide';
import { Sheet } from './Sheet';
import { CloseButton, Icon } from './Icon';

const installed = () => {
  try {
    return matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
};

function useGuide(): GuideItem[] {
  const repos = useStore((s) => s.repos);
  const settings = useStore((s) => s.settings);
  const notifyChannels = useStore((s) => s.notifyChannels);
  const experiments = useStore((s) => s.experiments);
  const messages = useStore((s) => s.messages);
  return useMemo(() => guideItems({ repos, settings, notifyChannels, experiments, messages, installed: installed() }), [repos, settings, notifyChannels, experiments, messages]);
}

function Checklist({ items, onGo, open }: { items: GuideItem[]; onGo?: () => void; open?: boolean }) {
  // the open items first, so "Do it" is at the top; `open`: only those (the card on the Company tab)
  const sorted = [...items].filter((i) => !open || !i.done).sort((a, b) => Number(a.done) - Number(b.done));
  return (
    <ul className="gm-list">
      {sorted.map((i) => (
        <li key={i.id} className={`gm-item ${i.done ? 'gm-item-done' : ''}`} data-guide={i.id} data-done={i.done}>
          <span className="gm-tick" aria-label={i.done ? 'Done' : 'Not done yet'}>
            {i.done ? <Icon name="check" /> : ''}
          </span>
          <div className="gm-text">
            <b>{i.title}</b>
            {!i.done && <span className="muted small">{i.why}</span>}
          </div>
          {!i.done && (
            <button
              className="btn btn-small gm-go"
              onClick={() => {
                onGo?.();
                go(i.target);
              }}
              aria-label={`Do it: ${i.title}`}
            >
              Do it
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function Progress({ items }: { items: GuideItem[] }) {
  const p = guideProgress(items);
  return (
    <span className="gm-progress">
      <span className="gm-bar" aria-hidden>
        <span style={{ width: `${(p.done / p.total) * 100}%` }} />
      </span>
      <span className="small">
        {p.done}/{p.total}
      </span>
    </span>
  );
}

/** Pocket's Company tab: the card, until it's all done or dismissed (the search brings it back). */
export function GuideCard() {
  const items = useGuide();
  const asked = useFinder((s) => s.guide);
  const [hidden, setHidden] = useState(guideDismissed);
  const p = guideProgress(items);
  if ((hidden || p.done === p.total) && !asked) return null;
  return (
    <section data-tour="guide" className="pk-card gm-card" aria-label="Get the most out of the office">
      <div className="gm-head">
        <b className="grow">
          <Icon name="circle-check" /> Get the most out of the office
        </b>
        <Progress items={items} />
        <CloseButton
          className="gm-x"
          label="Dismiss the guide"
          title="Dismiss (the search brings it back)"
          onClick={() => {
            dismissGuide(true);
            setHidden(true);
            useFinder.setState({ guide: false });
          }}
        />
      </div>
      <Checklist items={items} open />
      {p.done > 0 && (
        <p className="muted small gm-done">
          <Icon name="check" /> {p.done} done: {items.filter((i) => i.done).map((i) => i.title.toLowerCase()).join(' · ')}
        </p>
      )}
    </section>
  );
}

/** The 3D office: a HUD pill with the progress, opening the checklist as a sheet. */
export function GuideButton() {
  const items = useGuide();
  const p = guideProgress(items);
  if (p.done === p.total) return null;
  return (
    <button data-tour="guide" className="pill pill-guide" onClick={() => go({ kind: 'guide' })} title="Get the most out of the office" aria-label={`Guide: ${p.done} of ${p.total} done`}>
      <Icon name="circle-check" /> {p.done}/{p.total}
    </button>
  );
}

export function GuideSheet() {
  const open = useFinder((s) => s.guide);
  const items = useGuide();
  if (!open) return null;
  const close = () => useFinder.setState({ guide: false });
  return (
    <Sheet
      title={
        <>
          <Icon name="circle-check" /> Get the most out of the office
        </>
      }
      onClose={close}
      className="gm-sheet"
    >
      <div className="gm-head">
        <span className="muted small grow">It ticks itself as you go.</span>
        <Progress items={items} />
      </div>
      <Checklist items={items} onGo={close} />
    </Sheet>
  );
}
