// The voice call's screens (docs/voice.md), all drawing the one call in useCall (voiceCallEngine.ts runs it): on a
// phone a call screen like a phone call's, which folds into a pill at the top while you use the app; on a desktop or
// tablet a CEO orb that follows across every page, drags to a corner, and opens into a small call card. Unmounting
// any of them (a page change, the 3D/pocket switch) never touches the call. App.tsx loads this once a call starts.
// Open, both show a live view of the meeting room the call happens in (world/MeetingTile.tsx, #369), the CEO at its
// table; folded, or while you sit at that table yourself, it isn't drawn. The orb is ElevenLabs UI's (AgentOrb.tsx);
// with the Jarvis voice (#534) it leads the phone's call screen, and after "that's all" a tap on it talks again.
import { lazy, Suspense, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { turnParts, turnWords } from '../../../shared/callTrace';
import { CEO_ID } from '../../../shared/types';
import { LISTENER_NAMES } from '../../../shared/voiceAgent';
import { useStore } from '../store';
import { Icon } from './Icon';
import type { IconName } from './icons';
import { orbState } from './agentCall';
import { toggleCallDetails, useAgentCall } from './agentCallStore';
import { toggleCamera, useCamera } from './agentCameraStore';
import { agentStatus, useCallCaptions } from './callCaptions';
import { callClock, callStatus, inCall, type Call } from './voiceCall';
import { endCall, setMinimised, skipSentence, talkOnce, tapOrb, toggleCaptions, toggleMute, togglePause, toggleSpeaker } from './voiceCallEngine';
import { CALL_NARROW, useCall } from './voiceCallStore';
import './voiceCall.css';

const MeetingTile = lazy(() => import('../world/MeetingTile'));
const AgentOrb = lazy(() => import('./AgentOrb'));

function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(CALL_NARROW).matches);
  useEffect(() => {
    const mq = window.matchMedia(CALL_NARROW);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

/** The call's clock, ticking once a second. */
function useClock(startedAt: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return callClock(now - startedAt);
}

export default function CallScreens() {
  const view = useCall();
  const narrow = useNarrow();
  if (!inCall(view.call)) return null;
  return narrow ? <PhoneCall /> : <CallOrb />;
}

// ---------- the controls ----------

interface Key {
  id: string;
  icon: IconName;
  label: string;
  on?: boolean;
  disabled?: boolean;
  act: () => void;
}

function useKeys(): Key[] {
  const { call, captions, speaker } = useCall();
  return [
    { id: 'mute', icon: 'mic', label: call.muted ? 'Unmute' : 'Mute', on: call.muted, act: toggleMute },
    { id: 'speaker', icon: speaker ? 'volume-2' : 'volume-1', label: 'Speaker', on: speaker, act: toggleSpeaker },
    { id: 'pause', icon: call.paused ? 'play' : 'pause', label: call.paused ? 'Resume' : 'Pause', on: call.paused, act: togglePause },
    { id: 'skip', icon: 'skip-forward', label: 'Skip', disabled: call.phase !== 'speaking' || call.paused, act: skipSentence },
    { id: 'captions', icon: 'scroll-text', label: 'Captions', on: captions, act: toggleCaptions },
  ];
}

function Keys({ small }: { small?: boolean }) {
  const keys = useKeys();
  return (
    <div className={`vcall-keys ${small ? 'vcall-keys-small' : ''}`}>
      {keys.map((k) => (
        <div key={k.id} className="vcall-key-cell">
          <button type="button" className={`ds-btn ds-btn-icon vcall-key ${k.on ? 'vcall-key-on' : ''}`} aria-pressed={k.on} disabled={k.disabled} aria-label={k.label} data-key={k.id} onClick={k.act}>
            <Icon name={k.icon} />
            {k.id === 'mute' && k.on && <span className="vcall-slash" aria-hidden />}
          </button>
          <span className="vcall-key-label">{k.label}</span>
        </div>
      ))}
      <div className="vcall-key-cell">
        <button type="button" className="ds-btn ds-btn-icon vcall-key vcall-end" aria-label="End call" data-key="end" onClick={endCall}>
          <Icon name="phone" />
        </button>
        <span className="vcall-key-label">End</span>
      </div>
    </div>
  );
}

/** Live captions: the CEO's sentence, or what you're saying. */
function CaptionsLine() {
  const captions = useCall((s) => s.captions);
  const { line } = useCallCaptions();
  if (!captions) return null;
  return (
    <p className="vcall-captions" aria-live="polite">
      {line || ' '}
    </p>
  );
}

/** "Call details" (#665): who listens on the Jarvis call, and the last turn's timings, for finding what's slow. */
function CallDetails() {
  const { details, mode, listener, turn } = useAgentCall();
  if (!details || mode === 'off') return null;
  const total = turn ? turnParts(turn).total : null;
  return (
    <p className="vcall-details" data-testid="call-details" aria-live="polite">
      <span className="vcall-details-who">Listening: {listener ? LISTENER_NAMES[listener] : 'nobody yet'}</span>
      <span>{turn ? `Turn ${turn.n}: ${turnWords(turn)}` : 'Say something to time a turn'}</span>
      {total !== null && turn?.playback ? <span>{(total / 1000).toFixed(1)} s from your last word to the voice</span> : null}
    </p>
  );
}

/** The gauge button that shows or hides the call's details, on a Jarvis call. */
function DetailsButton() {
  const { details, mode } = useAgentCall();
  if (mode === 'off') return null;
  return (
    <button type="button" className={`ds-btn ds-btn-ghost ds-btn-icon ${details ? 'vcall-key-on' : ''}`} aria-pressed={details} aria-label="Call details" title="Call details: who listens and how long each turn takes" data-key="details" onClick={toggleCallDetails}>
      <Icon name="gauge" />
    </button>
  );
}

/** The mic can't listen by itself: why, and a Talk button. The Jarvis voice's silent mic only says why (#648). */
function TapToTalk() {
  const why = useCall((s) => s.call.tapToTalk);
  const quiet = useAgentCall((s) => (s.mode === 'live' ? s.micWhy : ''));
  if (!why)
    return quiet ? (
      <p className="vcall-why" role="status">
        {quiet}
      </p>
    ) : null;
  return (
    <div className="vcall-tap">
      <p className="vcall-why">{why}</p>
      <button type="button" className="ds-btn" onClick={talkOnce}>
        <Icon name="mic" /> Talk
      </button>
    </div>
  );
}

/** The live view of the meeting room, `fallback` while it loads (or while you sit in the room yourself). */
function RoomView({ ceo, fallback }: { ceo: string; fallback: ReactNode }) {
  const atTable = useCall((s) => s.atTable);
  if (atTable) return fallback;
  return (
    <Suspense fallback={fallback}>
      <MeetingTile label={`${ceo} at the meeting room's table`} />
    </Suspense>
  );
}

/** The orb: ElevenLabs UI's over the CSS one (which shows while it loads, or without WebGL2). A button after "that's all". */
function Orb({ call, initial, size, tap = true }: { call: Call; initial: string; size: 'big' | 'small'; tap?: boolean }) {
  const mode = useAgentCall((s) => s.mode);
  const state = call.paused ? 'paused' : call.phase;
  const face = (
    <>
      <span>{initial}</span>
      <Suspense fallback={null}>
        <AgentOrb state={orbState(call.phase, call.paused, mode)} />
      </Suspense>
    </>
  );
  if (mode === 'idle' && tap)
    return (
      <button type="button" className={`vcall-orb vcall-orb-${size} vcall-orb-tap`} data-state="idle" aria-label="Talk again" title="Tap to talk" onClick={tapOrb}>
        {face}
      </button>
    );
  return (
    <div className={`vcall-orb vcall-orb-${size}`} data-state={state} data-agent={mode === 'off' ? undefined : mode} aria-hidden>
      {face}
    </div>
  );
}

/** The status under the name: the Jarvis voice's own, else the call's. */
function useStatus(call: Call, ceo: string) {
  const mode = useAgentCall((s) => s.mode);
  return agentStatus(mode) ?? callStatus(call, ceo);
}

/** The 📷 button (#539): asks the CEO to turn their camera on, or off again. */
function CameraButton({ ceo }: { ceo: string }) {
  const on = useCamera((s) => s.agent === CEO_ID);
  return (
    <button type="button" className={`ds-btn ds-btn-ghost ds-btn-icon ${on ? 'vcall-key-on' : ''}`} aria-pressed={on} aria-label={on ? `Turn off ${ceo}'s camera` : `Ask ${ceo} to turn on their camera`} title={on ? 'Camera off' : 'Camera on'} data-key="camera" onClick={() => toggleCamera(CEO_ID)}>
      <Icon name="video" />
    </button>
  );
}

function openChat() {
  setMinimised(true);
  useCall.setState({ chatTucked: false });
  useStore.getState().openOverlay({ kind: 'phone', tab: 'chat' });
}

// ---------- the phone: a call screen, and its pill ----------

function PhoneCall() {
  const { call, minimised } = useCall();
  const ceo = useStore((s) => s.agents[CEO_ID]?.name ?? 'CEO');
  const clock = useClock(call.startedAt);
  const status = useStatus(call, ceo);
  const jarvis = useAgentCall((s) => s.mode !== 'off');
  if (minimised)
    return (
      <button type="button" className="vcall-pill" onClick={() => setMinimised(false)} aria-label={`Back to the call with ${ceo}, ${clock}`}>
        <Icon name="phone" />
        <span className="vcall-pill-name">{ceo}</span>
        <span className="vcall-pill-status">{status}</span>
        <span className="vcall-clock">{clock}</span>
      </button>
    );
  return (
    <div className="vcall-screen" role="dialog" aria-label={`Call with ${ceo}`}>
      <header className="vcall-top">
        <button type="button" className="ds-btn ds-btn-ghost ds-btn-icon" aria-label="Minimise the call" title="Use the app; the call goes on" onClick={() => setMinimised(true)}>
          <Icon name="chevron-down" />
        </button>
        <span className="vcall-clock">{clock}</span>
        <span className="vcall-top-end">
          <DetailsButton />
          <CameraButton ceo={ceo} />
          <button type="button" className="ds-btn ds-btn-ghost ds-btn-icon" aria-label="Open chat" title="The chat, while the call goes on" onClick={openChat}>
            <Icon name="message-circle" />
          </button>
        </span>
      </header>
      <div className={`vcall-middle ${jarvis ? 'vcall-middle-agent' : ''}`}>
        {jarvis && <Orb call={call} initial={ceo.charAt(0)} size="big" />}
        <RoomView ceo={ceo} fallback={jarvis ? null : <Orb call={call} initial={ceo.charAt(0)} size="big" />} />
        <h2 className="vcall-name">{ceo}</h2>
        <p className="vcall-status">{status}</p>
        <TapToTalk />
        <CaptionsLine />
        <CallDetails />
      </div>
      <Keys />
    </div>
  );
}

// ---------- the desktop: the orb and its card ----------

type Corner = 'br' | 'bl' | 'tr' | 'tl';
const CORNER_KEY = 'cubefarm:call-corner';

function savedCorner(): Corner {
  try {
    const c = localStorage.getItem(CORNER_KEY);
    return c === 'bl' || c === 'tr' || c === 'tl' ? c : 'br';
  } catch {
    return 'br';
  }
}

function CallOrb() {
  const { call, minimised } = useCall();
  const ceo = useStore((s) => s.agents[CEO_ID]?.name ?? 'CEO');
  const clock = useClock(call.startedAt);
  const status = useStatus(call, ceo);
  const [corner, setCorner] = useState<Corner>(savedCorner);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const press = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const dragged = useRef(false); // the click that ends a drag doesn't open the card

  const down = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.currentTarget.tagName !== 'BUTTON' && (e.target as HTMLElement).closest('button')) return; // the card's own buttons
    press.current = { x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const p = press.current;
    if (!p) return;
    if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6) return;
    p.moved = true;
    setDrag({ x: e.clientX, y: e.clientY });
  };
  const up = (e: ReactPointerEvent<HTMLElement>) => {
    const p = press.current;
    press.current = null;
    if (!p?.moved) return;
    dragged.current = true;
    setDrag(null);
    // Snaps to the nearest corner (clear of the panels' headers, so it never covers a ✕).
    const c: Corner = `${e.clientY < window.innerHeight / 2 ? 't' : 'b'}${e.clientX < window.innerWidth / 2 ? 'l' : 'r'}` as Corner;
    setCorner(c);
    try {
      localStorage.setItem(CORNER_KEY, c);
    } catch {
      // remembered for this visit only
    }
  };
  const open = () => {
    if (dragged.current) dragged.current = false;
    else setMinimised(false);
  };
  const style = drag ? { left: drag.x, top: drag.y, right: 'auto', bottom: 'auto', transform: 'translate(-50%, -50%)' } : undefined;

  return (
    <div className={`vcall-float vcall-${corner}`} style={style} data-dragging={drag ? '' : undefined}>
      {minimised ? (
        <button type="button" className="vcall-bubble" aria-label={`Call with ${ceo}, ${status}: open the call card`} title="Drag to a corner" onPointerDown={down} onPointerMove={move} onPointerUp={up} onClick={open}>
          <Orb call={call} initial={ceo.charAt(0)} size="small" tap={false} />
          <span className="vcall-clock">{clock}</span>
        </button>
      ) : (
        <section className="vcall-card" role="dialog" aria-label={`Call with ${ceo}`}>
          <header className="vcall-card-head" onPointerDown={down} onPointerMove={move} onPointerUp={up}>
            <Orb call={call} initial={ceo.charAt(0)} size="small" />
            <div className="vcall-card-who">
              <strong className="vcall-name">{ceo}</strong>
              <span className="vcall-status">
                {status} · <span className="vcall-clock">{clock}</span>
              </span>
            </div>
            <DetailsButton />
            <CameraButton ceo={ceo} />
            <button type="button" className="ds-btn ds-btn-ghost ds-btn-icon" aria-label="Fold the call card" title="Fold to the orb; the call goes on" onClick={() => setMinimised(true)}>
              <Icon name="chevron-down" />
            </button>
          </header>
          <RoomView ceo={ceo} fallback={null} />
          <TapToTalk />
          <CaptionsLine />
          <CallDetails />
          <Keys small />
          <button type="button" className="ds-btn" onClick={openChat}>
            <Icon name="message-circle" /> Open chat
          </button>
        </section>
      )}
    </div>
  );
}
