import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { CEO_ID } from '../../../shared/types';
import { Key, MoveKeys } from './Key';
import { useFinder } from './goTo';
import { useChatMode } from './chatMode';
import { isTouch, useTouchStick } from '../world/touch/touchState';

// The first-run tour: a coach card in the corner that moves on by itself as you try each thing,
// with Next and Skip always there. Progress lives in settings.tutorialStep, so a refresh resumes it.

type S = ReturnType<typeof useStore.getState>;

interface Ctx {
  ceo: string;
  company: string;
  repo: string | null; // first project's short name
}

interface Step {
  title: string;
  body: (c: Ctx) => ReactNode;
  done?: (s: S) => boolean;
  minMs?: number; // show at least this long before a done() can move on
}

const STEPS: Step[] = [
  {
    title: 'Look around',
    body: () =>
      isTouch ? (
        <>
          Put a thumb near the ghost stick at the bottom and drag to walk (far to run). Drag in the other bottom corner to look around. Tap a desk, a person or the floor to walk there.
        </>
      ) : (
        <>
          Click the view to grab the mouse and look around, then walk with <MoveKeys />. Hold <Key action="run" /> to run. <kbd>Esc</kbd> gives you the mouse back. <Key action="overview" /> shows the whole floor
          from above.
        </>
      ),
    done: (s) => (isTouch ? useTouchStick.getState().walked && useTouchStick.getState().looked : s.locked),
    minMs: 5000,
  },
  {
    title: 'Pull out your phone',
    body: (c) => (
      <>
        Press <Key action="phone" />. Your phone is how you talk to {c.ceo} from anywhere in the building.
      </>
    ),
    done: (s) => s.overlay?.kind === 'phone',
  },
  {
    title: 'Your phone',
    body: (c) => (
      <>
        💬 {c.ceo} texts you here, and you can text back: the + in the chat has starters like "Plan the next milestone". 👥 <b>Team</b> shows the CEO's team changes waiting for your OK. 📊 <b>Company</b> is
        every project at a glance. Put it away with <Key action="phone" />.
      </>
    ),
    done: (s) => s.overlay?.kind !== 'phone',
    minMs: 2500,
  },
  {
    title: 'Visit the CEO',
    body: (c) => (
      <>
        {c.ceo}'s corner office is at the back right of the lobby, under the purple sign. Walk in and press <Key action="interact" /> or click the desk to see what {c.ceo} is up to.
      </>
    ),
    done: (s) => (s.overlay?.kind === 'terminal' && s.overlay.agentId === CEO_ID) || (s.overlay?.kind === 'manager' && s.overlay.tab === 'ceo'),
  },
  {
    title: 'New agents',
    body: (c) => (
      <>
        When {c.ceo} wants a bigger team, each new agent waits on the green chairs along the east wall. Press <Key action="interact" /> or click one to see why, change their coding agent, model or effort if
        you like, then hire or decline. It all works from your phone too.
      </>
    ),
    done: (s) => s.requests.some((r) => r.status !== 'pending' && r.decidedBy === 'manager'),
  },
  {
    title: 'Go upstairs',
    body: (c) =>
      c.repo ? (
        <>
          {c.repo} has its own floor. Walk into the elevator in the middle of the south wall and press <Key action="interact" /> on its panel, or press <Key action="interact" /> or click the directory beside it.
        </>
      ) : (
        <>
          Every project gets its own floor. Add one in your office (the glass room at the back left), then take the elevator in the middle of the south wall.
        </>
      ),
    done: (s) => s.floor > 0,
  },
  {
    title: 'The whiteboard',
    body: () => (
      <>
        The whiteboard at the front of every floor is its Kanban board. Press <Key action="interact" /> or click it to hand out issues, send pull requests to QA and merge them.
      </>
    ),
    done: (s) => s.overlay?.kind === 'kanban',
  },
  {
    title: 'Watch the team',
    body: () => (
      <>
        Walk up behind anyone to watch their screen, or press <Key action="interact" /> or click a desk for their full terminal. Every pull request is tested by an agent before you merge it.
      </>
    ),
    done: (s) => s.overlay?.kind === 'terminal' && s.overlay.agentId !== CEO_ID,
  },
  {
    title: 'Their chat',
    body: () => (
      <>
        An agent's window switches between 💬 <b>Chat</b> and ⌨ <b>Terminal</b>. Chat is their work as a conversation: what they say, their steps in plain words (tap one for the command, output or diff),
        the pull request with QA's verdict. 💬 Chat at the top turns chat mode on for every desk.
      </>
    ),
    done: () => useChatMode.getState().on,
    minMs: 3000,
  },
  {
    title: 'React to them',
    body: () => (
      <>
        Hold a message or step in their chat (or hover it and press ☺) to react. 👍 carry on, 👎 rethink, 🤔 explain and ⚠️ stop and check reach them as a short note after their current step; ❤️ 🎉 👀
        only show. Their 👀 ⏳ ✅ on your messages say they've seen it, are on it, and answered.
      </>
    ),
    minMs: 4000,
  },
  {
    title: 'Find anything',
    body: () => (
      <>
        Press <kbd>Ctrl</kbd> <kbd>K</kbd> (or 🔍 at the top right) to search floors, agents, issues, pull requests and settings, or to ask the CEO to plan or research. Try it now.
      </>
    ),
    done: () => useFinder.getState().search,
  },
  {
    title: 'Get the most out of it',
    body: () => (
      <>
        The ✅ at the top right is a checklist that ticks itself: charters, QA briefs, notifications, Telegram, a mandate for the CEO, an experiment. Each open item has a <b>Do it</b>. Every screen's ⓘ says
        what you can do there.
      </>
    ),
    done: () => useFinder.getState().guide,
  },
  {
    title: 'Your office',
    body: (c) => (
      <>
        Your glass office in the lobby (back left) has the manager's console: projects, the team, and the CEO's settings. Press <Key action="help" /> any time for help. Enjoy running {c.company}!
      </>
    ),
  },
];

export function Tutorial() {
  const step = useStore((s) => s.settings.tutorialStep);
  const setupDone = useStore((s) => s.settings.setupDone);
  const started = useStore((s) => s.started);
  const company = useStore((s) => s.settings.companyName);
  const ceo = useStore((s) => s.agents[CEO_ID]?.name ?? 'the CEO');
  const repo = useStore((s) => s.repos[0]?.fullName.split('/')[1] ?? null);
  const [cheer, setCheer] = useState(false);
  const moving = useRef(false);
  const shownAt = useRef(Date.now());

  const active = started && setupDone && step >= 0 && step < STEPS.length;
  const go = (to: number) => {
    if (moving.current) return;
    moving.current = true;
    void api
      .updateSettings({ tutorialStep: to >= STEPS.length ? -1 : to })
      .catch(() => undefined)
      .finally(() => {
        moving.current = false;
        setCheer(false);
      });
  };

  useEffect(() => {
    shownAt.current = Date.now();
    setCheer(false);
  }, [step]);

  // Move on by itself once the thing the step asks for has happened.
  useEffect(() => {
    if (!active) return;
    const s = STEPS[step];
    if (!s.done) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = () => {
      if (timer || moving.current) return;
      const st = useStore.getState();
      if (!s.done!(st)) return;
      const wait = Math.max(0, (s.minMs ?? 0) - (Date.now() - shownAt.current));
      timer = setTimeout(() => {
        if (!s.done!(useStore.getState())) {
          timer = null;
          return;
        }
        setCheer(true);
        timer = setTimeout(() => go(step + 1), 900);
      }, wait);
    };
    check();
    const unsub = useStore.subscribe(check);
    const poll = setInterval(check, 1000); // locked / minMs can flip without a store change we see
    return () => {
      unsub();
      clearInterval(poll);
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, step]);

  if (!active) return null;
  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  return (
    <div className={`tour ${cheer ? 'tour-cheer' : ''}`}>
      <div className="tour-head">
        <span className="tour-count">
          🧭 Tour · {step + 1}/{STEPS.length}
        </span>
        <span className="spacer" />
        <button className="linkish small" onClick={() => go(STEPS.length)}>
          Skip tour
        </button>
      </div>
      <div className="tour-title">{cheer ? `✅ ${s.title}` : s.title}</div>
      <div className="tour-body">{s.body({ ceo, company: company || 'the company', repo })}</div>
      <div className="tour-nav">
        {step > 0 && (
          <button className="btn btn-small btn-ghost" onClick={() => go(step - 1)}>
            ← Back
          </button>
        )}
        <span className="spacer" />
        <button className="btn btn-small btn-good" onClick={() => go(step + 1)}>
          {last ? 'Finish the tour' : s.done ? 'Skip this step' : 'Next →'}
        </button>
      </div>
    </div>
  );
}
