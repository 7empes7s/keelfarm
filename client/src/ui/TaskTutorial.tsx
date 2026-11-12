import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { useStore } from '../store';
import { openLink } from '../routeLink';
import { go as goTo, useFinder } from './goTo';
import { matchCommands } from './chatCardRules';
import { reduceMotion } from './a11y';
import { Icon } from './Icon';
import { useNoticePop } from './Notices';
import { Spotlight, StepText, useSpot } from './Tutorial';
import { cardPlace } from './tourSpot';
import { seenNow, useTour } from './tour';
import { newSince, type Track } from './tourSteps';
import { doneOf, moveTo, neverStarted, pauseTutorial, readProgress, sentCount, startTutorial, stepBlocked, stepLink, tapUses, tutorialById, TUTORIALS, type Mode, type Progress, type World } from './tutorials';
import './tour.css';
import './tutorials.css';

// The task tutorials (#517): a coach card that opens each step's page, rings its control and waits for the manager to
// use it; the hub that lists them with progress, Resume and Restart; and the first launch's "Get started". Progress is
// remembered per device (tutorials.ts has the rules).

const KEY = 'cubefarm:tutorials';
const INVITE_KEY = 'cubefarm:tutorials-invite';

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // remembered for this visit only
  }
};

interface Tutorials {
  progress: Progress;
  /** "Not now" on the first launch's Get started. */
  invited: boolean;
  /** The tutorial just finished: its Done card. */
  finished: string | null;
}

const useTutorials = create<Tutorials>(() => ({ progress: readProgress(typeof window === 'undefined' ? null : read(KEY)), invited: typeof window !== 'undefined' && read(INVITE_KEY) === '1', finished: null }));

function save(progress: Progress) {
  write(KEY, JSON.stringify(progress));
  useTutorials.setState({ progress });
}

/** Starts a tutorial (or resumes it where it was; `restart`: from its first step). */
function runTutorial(id: string, restart = false) {
  useTour.setState({ replay: null, pocketTour: false }); // one guide on screen at a time
  useTutorials.setState({ finished: null });
  save(startTutorial(useTutorials.getState().progress, id, restart));
}

const worldOf = (s: ReturnType<typeof useStore.getState>): World => ({ repos: s.repos, agents: s.agents, qa: s.qa });
const modeOf = (track: Track): Mode => (track === 'office' ? 'office' : 'pocket');

/** Opens the page a step is on: its link, or the chat with a /plan ready to send. */
function openStep(id: string, at: number, mode: Mode) {
  const step = tutorialById(id)?.steps[at];
  if (!step) return;
  if (document.pointerLockElement) document.exitPointerLock();
  const s = useStore.getState();
  // what the last step opened makes way: nothing covers this one's control
  useFinder.setState({ guide: false, search: false });
  useNoticePop.setState({ open: false });
  s.openOverlay(null);
  if (step.open === 'plan') return goTo({ kind: 'ceo', text: matchCommands('plan')[0].template(s.repos[0]?.floor ?? 1) });
  const link = stepLink(step, worldOf(s), mode);
  if (link) openLink(link);
  else if (mode === 'pocket') window.dispatchEvent(new CustomEvent('cubefarm:open', { detail: '?tab=company' })); // its header has every button
}

/** Brings the step's control into view when it's drawn but scrolled away (a long page, the Kanban's columns). */
function useBringIntoView(selectors: readonly string[], key: string) {
  useEffect(() => {
    let tries = 0;
    const t = setInterval(() => {
      const el = selectors.map((s) => document.querySelector(s)).find(Boolean);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) el.scrollIntoView({ block: 'center', inline: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
        clearInterval(t);
      } else if (++tries > 40) clearInterval(t);
    }, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/** A confirmation still open (Merge anyway?): the next step waits for it. */
const asking = () => !!document.querySelector('[role="alertdialog"]');

/** The task tutorial on screen, if one runs. */
export function TaskTutorial({ track }: { track: Track }) {
  const progress = useTutorials((s) => s.progress);
  const finished = useTutorials((s) => s.finished);
  const tourOn = useTour((s) => s.on);
  const entered = useStore((s) => s.started || track !== 'office');
  const aside = tourOn || !entered; // the tour, or the 3D office's start screen, comes first
  const mode = modeOf(track);
  const id = progress.running;
  const tut = id ? tutorialById(id) : undefined;
  const at = id ? (progress.at[id]?.step ?? 0) : 0;
  const step = tut?.steps[at];
  const blocked = useStore((s) => !!step && stepBlocked(step, worldOf(s), mode));
  const [done, setDone] = useState(false);
  const key = step ? `${id}/${step.id}` : '';

  // owns the screen while it shows: toasts wait behind it (Notices.tsx)
  useEffect(() => {
    useTour.setState({ task: !!step || !!finished });
    return () => useTour.setState({ task: false });
  }, [step, finished]);

  // each step opens its own page first
  useEffect(() => {
    setDone(false);
    if (id && step && !aside) openStep(id, at, mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, aside]);

  const go = (to: number) => {
    if (!id || !tut) return;
    setDone(false);
    save(moveTo(useTutorials.getState().progress, id, to));
    if (to >= tut.steps.length) useTutorials.setState({ finished: id });
  };

  // done once the manager uses the ringed control, or sends the message
  useEffect(() => {
    if (!step) return;
    if (step.done === 'sent') {
      const before = sentCount(useStore.getState().messages);
      return useStore.subscribe((s) => void (sentCount(s.messages) > before && setDone(true)));
    }
    const onClick = (e: MouseEvent) => void (tapUses(e.target as Element | null, step.targets) && setDone(true));
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // and moves on by itself, unless the tap opened a form to finish first
  useEffect(() => {
    if (!done || !step || step.stay) return;
    const t = setInterval(() => {
      if (asking()) return;
      clearInterval(t);
      go(at + 1);
    }, 900);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, key]);

  const selectors = step && !aside ? step.targets : [];
  useBringIntoView(selectors, key);
  const spot = useSpot(selectors.join('\n'));

  if (aside) return null;
  if (finished && !step) {
    const t = tutorialById(finished);
    const next = TUTORIALS.find((x) => x.id !== finished && !doneOf(progress, x.id).finished);
    return (
      <section className={`tour tour-task tour-${track} tour-at-bottom tour-cheer`} aria-label="Tutorial" aria-live="polite" data-tutorial={finished} data-step="done">
        <div className="tour-title">
          <Icon name="check" /> Done: {t?.title}
        </div>
        <div className="tour-body">You did every step for real. Tutorials in the guide or Settings → Company can run it again.</div>
        <div className="tour-nav">
          {next && (
            <button className="btn btn-small btn-ghost" onClick={() => runTutorial(next.id)}>
              Next: {next.title}
            </button>
          )}
          <span className="spacer" />
          <button className="btn btn-small btn-good" onClick={() => useTutorials.setState({ finished: null })}>
            Done
          </button>
        </div>
      </section>
    );
  }
  if (!tut || !step) return null;
  const last = at === tut.steps.length - 1;
  return (
    <>
      <Spotlight rect={spot} className="tour-task-ring" />
      <section
        className={`tour tour-task tour-${track} tour-at-${cardPlace(spot, true, innerHeight)} ${done ? 'tour-cheer' : ''} ${reduceMotion() ? 'tour-still' : ''}`}
        aria-label={`Tutorial: ${tut.title}`}
        aria-live="polite"
        data-tutorial={tut.id}
        data-step={step.id}
        data-done={done ? '1' : undefined}
        data-targets={step.targets.join('\n')}
      >
        <div className="tour-head">
          <span className="tour-count">
            <Icon name={tut.icon} /> {tut.title} · {at + 1}/{tut.steps.length}
          </span>
          <span className="spacer" />
          <button className="linkish small tour-skip" onClick={() => save(pauseTutorial(useTutorials.getState().progress))} title="Close (Resume from the guide)">
            Close
          </button>
        </div>
        <div className="tour-title">
          {done ? (
            <>
              <Icon name="check" /> {step.title}
            </>
          ) : (
            step.title
          )}
        </div>
        <div className="tour-body">{blocked ? 'Nothing to show for this yet: it appears once your office has some work. Skip it for now.' : <StepText text={step.text} />}</div>
        <div className="tour-dots" aria-hidden>
          {tut.steps.map((x, i) => (
            <span key={x.id} className={`tour-dot ${i === at ? 'tour-dot-on' : i < at ? 'tour-dot-done' : ''}`} />
          ))}
        </div>
        <div className="tour-nav">
          {at > 0 && (
            <button className="btn btn-small btn-ghost" onClick={() => go(at - 1)}>
              <Icon name="chevron-left" /> Back
            </button>
          )}
          <span className="spacer" />
          {done ? (
            <button className="btn btn-small btn-good" onClick={() => go(at + 1)}>
              {last ? 'Finish' : 'Next'} <Icon name="chevron-right" />
            </button>
          ) : (
            <button className="btn btn-small btn-ghost" onClick={() => go(at + 1)}>
              Skip step
            </button>
          )}
        </div>
      </section>
    </>
  );
}

/** The tutorials with their progress, Resume and Restart (the guide, ⓘ, Settings → Company). `onStart`: close the sheet it's in. */
export function TutorialsHub({ onStart }: { onStart?: () => void }) {
  const progress = useTutorials((s) => s.progress);
  const run = (id: string, restart = false) => {
    onStart?.();
    runTutorial(id, restart);
  };
  return (
    <section className="tut-hub" aria-label="Tutorials">
      <h3 className="tut-hub-h">
        <Icon name="book-open" /> Tutorials
      </h3>
      <p className="muted small">Real jobs, step by step: each step opens the page and waits until you've done it.</p>
      <ul className="tut-list">
        {TUTORIALS.map((t) => {
          const p = doneOf(progress, t.id);
          const started = p.done > 0 && !p.finished;
          return (
            <li key={t.id} className="tut-row" data-tutorial-row={t.id}>
              <span className="tut-icon" aria-hidden>
                <Icon name={t.icon} />
              </span>
              <div className="tut-text">
                <b>{t.title}</b>
                <span className="muted small">{t.blurb}</span>
                <span className="tut-bar" aria-label={`${p.done} of ${p.total} steps done`}>
                  <span style={{ width: `${(p.done / p.total) * 100}%` }} />
                </span>
              </div>
              <span className="tut-count small">
                {p.finished ? <Icon name="check" /> : null}
                {p.done}/{p.total}
              </span>
              <div className="tut-actions">
                {(started || p.finished) && (
                  <button className="btn btn-small btn-ghost" onClick={() => run(t.id, true)} aria-label={`Restart ${t.title}`}>
                    <Icon name="rotate-ccw" /> Restart
                  </button>
                )}
                {!p.finished && (
                  <button className="btn btn-small btn-good" onClick={() => run(t.id)} aria-label={`${started ? 'Resume' : 'Start'} ${t.title}`}>
                    <Icon name="play" /> {started ? 'Resume' : 'Start'}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The first launch's offer: Get started, until a tutorial is opened or Not now. `floating`: the 3D office's corner card. */
export function TutorialInvite({ track, floating = false }: { track: Track; floating?: boolean }) {
  const progress = useTutorials((s) => s.progress);
  const invited = useTutorials((s) => s.invited);
  const setupDone = useStore((s) => s.settings.setupDone);
  const tourLeft = useStore((s) => s.settings.tutorialStep >= 0);
  const busy = useTour((s) => s.on || !!s.replay || s.pocketTour);
  const whatsNew = useTour((s) => floating && newSince(track, seenNow(s.raw)).length > 0); // the corner shows What's new first
  const covered = useStore((s) => floating && (!!s.overlay || !s.started));
  // the 3D office's own tour comes first; its corner then offers this
  if (!setupDone || invited || busy || covered || whatsNew || !neverStarted(progress) || (floating && tourLeft)) return null;
  const later = () => {
    write(INVITE_KEY, '1');
    useTutorials.setState({ invited: true });
  };
  const start = TUTORIALS[0];
  return (
    <section className={`pk-card tour-invite ${floating ? 'tour-invite-float' : ''}`} aria-label={start.title}>
      <div className="grow">
        <b>
          <Icon name={start.icon} /> {start.title}
        </b>
        <div className="muted small">{start.steps.length} real steps: sign in an agent, add a project, its charter and QA brief.</div>
      </div>
      <div className="tour-invite-nav">
        <button className="btn btn-small btn-ghost" onClick={later}>
          Not now
        </button>
        <button className="btn btn-small btn-good" onClick={() => runTutorial(start.id)}>
          Start
        </button>
      </div>
    </section>
  );
}
