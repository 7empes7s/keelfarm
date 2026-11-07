import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { useStore } from '../store';
import { CEO_ID } from '../../../shared/types';
import { Key, MoveKeys } from './Key';
import { go as goTo, openSearch, useFinder } from './goTo';
import type { ActionId } from './keymap';
import { matchCommands } from './chatCardRules';
import { reduceMotion } from './a11y';
import { newSince, stepsFor, textParts, TOUR, isStep, type TourStep, type Track, type TryIt } from './tourSteps';
import { openWhatsNew, saveSeen, seenNow, useTour } from './tour';
import './tour.css';
import { useChatMode } from './chatMode';
import { isTouch, useTouchStick } from '../world/touch/touchState';

// The tour (#121): a coach card with one sentence per step, a ring around the real control it's about, Back / Next /
// Skip, progress dots and, where it's harmless, "Try it". Its steps are in tourSteps.ts, one track per kind of screen.
// The full tour's place lives in settings.tutorialStep, so a refresh resumes it; "What's new" replays only the steps
// this device hasn't seen (tour.ts). In the 3D office a step moves on by itself once you've done what it asks.

type S = ReturnType<typeof useStore.getState>;

/** When a step is done, and the least time it shows before moving on. */
const DONE: Record<string, { done: (s: S) => boolean; minMs?: number }> = {
  look: { done: (s) => (isTouch ? useTouchStick.getState().walked && useTouchStick.getState().looked : s.locked), minMs: 5000 },
  phone: { done: (s) => s.overlay?.kind === 'phone' },
  'phone-tour': { done: (s) => s.overlay?.kind !== 'phone', minMs: 2500 },
  ceo: { done: (s) => (s.overlay?.kind === 'terminal' && s.overlay.agentId === CEO_ID) || (s.overlay?.kind === 'manager' && s.overlay.tab === 'ceo') },
  hires: { done: (s) => s.requests.some((r) => r.status !== 'pending' && r.decidedBy === 'manager') },
  upstairs: { done: (s) => s.floor > 0 },
  whiteboard: { done: (s) => s.overlay?.kind === 'kanban' },
  watch: { done: (s) => s.overlay?.kind === 'terminal' && s.overlay.agentId !== CEO_ID },
  search: { done: () => useFinder.getState().search },
  guide: { done: () => useFinder.getState().guide },
  bell: { done: (s) => s.overlay?.kind === 'notices' },
  'agent-chat': { done: () => useChatMode.getState().on, minMs: 3000 },
};

const TRY_LABEL: Record<TryIt, string> = { search: 'Open search', guide: 'Open the guide', bell: 'Open the bell', plan: 'Start a /plan', console: 'Open the console', charter: 'Open a charter', costs: 'Show the costs' };

/** Brings what a Try it opened into view, once it's drawn. */
function reveal(target: string) {
  setTimeout(() => document.querySelector(`[data-tour="${target}"]`)?.scrollIntoView({ block: 'start', behavior: reduceMotion() ? 'auto' : 'smooth' }), 400);
}

function tryIt(t: TryIt) {
  const s = useStore.getState();
  if (document.pointerLockElement) document.exitPointerLock();
  switch (t) {
    case 'search':
      return openSearch();
    case 'guide':
      return goTo({ kind: 'guide' });
    case 'bell':
      return s.openOverlay({ kind: 'notices' });
    case 'plan': // fills the box, never sends
      return goTo({ kind: 'ceo', text: matchCommands('plan')[0].template(s.repos[0]?.floor ?? 1) });
    case 'console':
      return goTo({ kind: 'section', section: 'floors' });
    case 'charter':
      goTo({ kind: 'section', section: 'charter' });
      return reveal('charter');
    case 'costs':
      goTo({ kind: 'section', section: 'ops' });
      return reveal('costs');
  }
}

function StepText({ text }: { text: string }) {
  const company = useStore((s) => s.settings.companyName) || 'the company';
  const ceo = useStore((s) => s.agents[CEO_ID]?.name ?? 'the CEO');
  return (
    <>
      {textParts(text).map((p, i) =>
        'key' in p ? <Key key={i} action={p.key as ActionId} /> : 'move' in p ? <MoveKeys key={i} /> : 'name' in p ? <span key={i}>{p.name === 'ceo' ? ceo : company}</span> : <span key={i}>{p.text}</span>,
      )}
    </>
  );
}

/** The first of `targets` on screen. */
function findTarget(targets: readonly string[]): DOMRect | null {
  for (const t of targets)
    for (const el of document.querySelectorAll(`[data-tour="${t}"]`)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight) return r;
    }
  return null;
}

/** A ring around the control a step is about, following it as the page moves; nothing when it isn't on screen. */
function Spotlight({ targets }: { targets: readonly string[] }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    const look = () =>
      setRect((was) => {
        const r = findTarget(targets);
        return r && was && r.x === was.x && r.y === was.y && r.width === was.width && r.height === was.height ? was : r;
      });
    look();
    const t = setInterval(look, 300);
    window.addEventListener('resize', look);
    return () => {
      clearInterval(t);
      window.removeEventListener('resize', look);
    };
  }, [targets]);
  if (!rect) return null;
  const pad = 4;
  // on the body: inside a zoomed box (the UI scale) its place would be scaled again
  return createPortal(<div className={`tour-ring ${reduceMotion() ? '' : 'tour-ring-pulse'}`} aria-hidden style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />, document.body);
}

/** The tour on this screen: the full one while settings.tutorialStep says so, else a What's new replay. */
export function Tutorial({ track }: { track: Track }) {
  const step = useStore((s) => s.settings.tutorialStep);
  const setupDone = useStore((s) => s.settings.setupDone);
  const started = useStore((s) => s.started);
  const pocketTour = useTour((s) => s.pocketTour);
  const replay = useTour((s) => s.replay);
  const [cheer, setCheer] = useState(false);
  const shownAt = useRef(Date.now());
  useEffect(() => useTour.setState({ track }), [track]);

  const all = stepsFor(track);
  const tour = setupDone && step >= 0 && step < all.length && (track === 'office' ? started : pocketTour);
  const steps: TourStep[] = replay && !tour ? replay.ids.map((id) => TOUR.find((e) => e.id === id)).filter((e): e is TourStep => !!e && isStep(e)) : all;
  const at = replay && !tour ? replay.at : step;
  const active = tour || (!!replay && at < steps.length);

  const go = (to: number) => {
    setCheer(false);
    if (!tour) {
      if (to >= steps.length) {
        saveSeen(steps);
        useTour.setState({ replay: null });
      } else useTour.setState({ replay: { ids: replay!.ids, at: Math.max(0, to) } });
      return;
    }
    if (to >= all.length) {
      saveSeen(all);
      useTour.setState({ pocketTour: false });
    }
    // at once here, so quick taps each count; the office's echo agrees
    const tutorialStep = to >= all.length ? -1 : Math.max(0, to);
    useStore.setState((st) => ({ settings: { ...st.settings, tutorialStep } }));
    void api.updateSettings({ tutorialStep }).catch(() => undefined);
  };

  useEffect(() => {
    shownAt.current = Date.now();
    setCheer(false);
  }, [at, active]);

  // Move on by itself once the thing the step asks for has happened.
  const id = active ? steps[at]?.id : undefined;
  useEffect(() => {
    const rule = id ? DONE[id] : undefined;
    if (!rule) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = () => {
      if (timer) return;
      if (!rule.done(useStore.getState())) return;
      const wait = Math.max(0, (rule.minMs ?? 0) - (Date.now() - shownAt.current));
      timer = setTimeout(() => {
        if (!rule.done(useStore.getState())) {
          timer = null;
          return;
        }
        setCheer(true);
        timer = setTimeout(() => go(at + 1), 900);
      }, wait);
    };
    check();
    const unsub = useStore.subscribe(check);
    const unsubFinder = useFinder.subscribe(check);
    const poll = setInterval(check, 1000); // locked / minMs can flip without a store change we see
    return () => {
      unsub();
      unsubFinder();
      clearInterval(poll);
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, at]);

  if (!active) return null;
  const s = steps[at];
  if (!s) return null;
  const last = at === steps.length - 1;
  const auto = tour && !!DONE[s.id];
  return (
    <>
      {s.targets && <Spotlight targets={s.targets} />}
      <section className={`tour tour-${track} ${cheer ? 'tour-cheer' : ''} ${reduceMotion() ? 'tour-still' : ''}`} aria-label={tour ? 'Tour' : "What's new"} aria-live="polite">
        <div className="tour-head">
          <span className="tour-count">
            {tour ? '🧭 Tour' : "✨ What's new"} · {at + 1}/{steps.length}
          </span>
          <span className="spacer" />
          <button className="linkish small tour-skip" onClick={() => go(steps.length)}>
            {tour ? 'Skip tour' : 'Done'}
          </button>
        </div>
        <div className="tour-title">{cheer ? `✅ ${s.title}` : s.title}</div>
        <div className="tour-body">
          <StepText text={(isTouch && s.touchText) || s.text} />
        </div>
        <div className="tour-dots" aria-hidden>
          {steps.map((x, i) => (
            <span key={x.id} className={`tour-dot ${i === at ? 'tour-dot-on' : i < at ? 'tour-dot-done' : ''}`} />
          ))}
        </div>
        {s.tryIt && (
          <button className="btn btn-small tour-try" onClick={() => tryIt(s.tryIt!)}>
            👆 {TRY_LABEL[s.tryIt]}
          </button>
        )}
        <div className="tour-nav">
          {at > 0 && (
            <button className="btn btn-small btn-ghost" onClick={() => go(at - 1)}>
              ← Back
            </button>
          )}
          <span className="spacer" />
          <button className="btn btn-small btn-good" onClick={() => go(at + 1)}>
            {last ? (tour ? 'Finish' : 'Done') : auto ? 'Skip step' : 'Next →'}
          </button>
        </div>
      </section>
    </>
  );
}

/**
 * The tour's way in: in pocket mode "Take the tour" while the office's tour isn't finished, and anywhere "N new things
 * since you last looked" once it is and this device hasn't seen every step. `floating`: the 3D office's corner card.
 */
export function TourInvite({ track, floating = false }: { track: Track; floating?: boolean }) {
  const step = useStore((s) => s.settings.tutorialStep);
  const setupDone = useStore((s) => s.settings.setupDone);
  const raw = useTour((s) => s.raw);
  const busy = useTour((s) => !!s.replay || s.pocketTour);
  const covered = useStore((s) => floating && (!!s.overlay || !s.started)); // the 3D card stays out of the panels' way
  if (!setupDone || busy || covered) return null;
  const all = stepsFor(track);
  const tourLeft = step >= 0 && step < all.length;
  // the 3D office starts its tour by itself
  if (tourLeft && track === 'office') return null;
  const fresh = tourLeft ? [] : newSince(track, seenNow(raw));
  if (!tourLeft && !fresh.length) return null;
  const later = () => {
    if (tourLeft) void api.updateSettings({ tutorialStep: -1 }).catch(() => undefined);
    saveSeen(tourLeft ? all : fresh);
  };
  return (
    <section className={`pk-card tour-invite ${floating ? 'tour-invite-float' : ''}`} aria-label={tourLeft ? 'Take the tour' : "What's new"}>
      <div className="grow">
        <b>{tourLeft ? '🧭 Take the tour' : `✨ ${fresh.length} new thing${fresh.length === 1 ? '' : 's'} since you last looked`}</b>
        <div className="muted small">{tourLeft ? `${all.length} short steps, each pointing at the real thing.` : fresh.map((s) => s.title).join(' · ')}</div>
      </div>
      <div className="tour-invite-nav">
        <button className="btn btn-small btn-ghost" onClick={later}>
          {tourLeft ? 'Not now' : 'Later'}
        </button>
        <button className="btn btn-small btn-good" onClick={() => (tourLeft ? useTour.setState({ pocketTour: true }) : openWhatsNew(fresh))}>
          {tourLeft ? 'Start' : 'Show me'}
        </button>
      </div>
    </section>
  );
}
