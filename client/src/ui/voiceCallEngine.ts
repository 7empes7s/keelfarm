// Runs the voice call (docs/voice.md, "How a voice call behaves"): voiceCall.ts's machine, at app level, whatever is
// on screen. It opens the mic for every turn (mic.ts's 'call' mode, into a message box of its own that sends to the
// CEO), lets the manager talk over the CEO (barge-in), steers the voice (voiceMessages.ts: stop, pause, skip), keeps
// the office's sounds, toasts and notifications for after the call, holds back the office's new client, and takes
// Space, →, M and Esc. The call screens (CallScreens.tsx) only draw useCall. window.__swarmCall is the probe.
// With the Jarvis voice (#534, agentCallStore.ts) ElevenLabs Agents listens and talks instead (agentCallEngine.ts);
// without a key, over the monthly cap or when it can't connect, the call is exactly as before.
import { CEO_ID } from '../../../shared/types';
import { cameraWords } from './agentCameraStore';
import { report } from '../attention';
import { agentCallWhy, agentOn, callAudio, useAgentCall } from './agentCallStore';
import { sendWs } from '../net';
import { useStore } from '../store';
import { markBusy } from '../updateGate';
import { sendToCeo } from './chatSend';
import { CHIME_MS } from './handsFree';
import { callProvider, listen, micCaps, registerTarget, setCallEars, stopListening, useMic } from './mic';
import { cantListen } from './micText';
import { listenChime, setCallQuiet, unlockAudio } from './sfx';
import { inCall, wantsMic, type CallEffect } from './voiceCall';
import { callOn, dispatchCall, onCallStep, useCall } from './voiceCallStore';
import { releaseWakeMic } from './wake/wakeStore';

const TARGET = 'voice-call';
const voice = () => import('./voiceMessages');
const agent = () => import('./agentCallEngine');

let unregister: (() => void) | null = null;
/** A tap-to-talk turn is open: the call doesn't close it for not wanting the mic. */
let tapping = false;

/** Why the call can't listen by itself, or ''. */
function micReason(): string {
  return cantListen(callProvider(), micCaps(), useStore.getState().voiceKeySet);
}

// ---------- controls (the call screens and the keys) ----------

/** Starts a call, or brings the one that's on back to the front. Call it from a click: the browser lets sound start then. */
export function startCall() {
  releaseWakeMic(); // before the call's own mic opens, not when the wake word sees the call
  unlockAudio();
  if (!callOn() && !agentCallWhy(useStore.getState())) {
    callAudio(); // inside the tap: iPhones only start sound (and the mic's audio session) from one
    useAgentCall.setState({ mode: 'connecting', saying: '' });
  }
  useCall.setState({ minimised: false });
  dispatchCall({ type: 'start', now: Date.now(), id: Date.now() });
}

export const endCall = () => void dispatchCall({ type: 'end' });
export const toggleMute = () => void dispatchCall({ type: 'mute' });
export const togglePause = () => void dispatchCall({ type: 'pause' });
export const skipSentence = () => void dispatchCall({ type: 'skip' });
export const toggleCaptions = () => useCall.setState((s) => ({ captions: !s.captions }));
export const toggleSpeaker = () => useCall.setState((s) => ({ speaker: !s.speaker }));
export const setMinimised = (minimised: boolean) => useCall.setState({ minimised });

/** The orb, tapped after "that's all": the Jarvis voice listens again. */
export function tapOrb() {
  if (!callOn() || useAgentCall.getState().mode !== 'idle') return;
  callAudio();
  void agent().then((a) => a.connectAgent(() => useAgentCall.setState({ mode: 'idle' })));
}

/** Tap-to-talk, when the mic can't listen by itself: one turn, sent when you stop talking. */
export function talkOnce() {
  if (!callOn() || useMic.getState().state !== 'idle') return;
  tapping = true;
  listen(TARGET, 'call');
  if (useMic.getState().state === 'idle') tapping = false;
}

// ---------- the effects ----------

const EFFECTS: Record<CallEffect, () => void> = {
  greet: () => {
    setCallQuiet(true);
    markBusy(TARGET, 'call', true);
    useCall.setState({ heard: '', managerSpeaking: false, chatTucked: useStore.getState().chatDocked }); // a docked chat tucks away behind the call
    if (useStore.getState().overlay?.kind === 'phone') useStore.getState().openOverlay(null); // and so does the phone's
    report(sendWs, false, true);
    if (agentOn()) return void agent().then((a) => a.connectAgent(ownVoice));
    ownEars();
    listenChime(true);
    setTimeout(() => dispatchCall({ type: 'connected', tapToTalk: micReason() }), CHIME_MS);
  },
  'stop-voice': () => void (agentOn() ? agent().then((a) => a.stopAgentVoice()) : voice().then((v) => v.stopSpeaking())),
  'pause-voice': () => void (agentOn() ? agent().then((a) => a.pauseAgent()) : voice().then((v) => v.pauseVoice())),
  'resume-voice': () => void (agentOn() ? agent().then((a) => a.resumeAgent()) : voice().then((v) => v.resumeVoice())),
  'skip-voice': () => void (agentOn() ? agent().then((a) => a.skipAgent()) : voice().then((v) => v.skipSentence())),
  release: () => {
    if (agentOn()) void agent().then((a) => a.releaseAgent());
    tapping = false;
    stopListening(TARGET);
    unregister?.();
    unregister = null;
    setCallEars(null);
    setCallQuiet(false);
    markBusy(TARGET, 'call', false);
    listenChime(false);
    report(sendWs, false, true);
    useCall.setState({ chatTucked: false, managerSpeaking: false });
    useStore.getState().openOverlay({ kind: 'phone', tab: 'chat' }); // the chat comes back, with the call's turns in it
  },
};

/** Today's call: the mic through mic.ts into a message box of its own that sends to the CEO. */
function ownEars() {
  unregister?.();
  unregister = registerTarget({ id: TARGET, kind: 'call', form: () => null, text: () => '', setText: (heard) => useCall.setState({ heard }), send: turn, disabled: () => false });
  setCallEars(EARS);
}

/** The Jarvis voice couldn't take the call: today's voice mode carries it, and the manager hears why. */
function ownVoice(why: string) {
  ownEars();
  useStore.getState().pushToast('info', `Using the office's own voice: ${why}`);
  dispatchCall({ type: 'connected', tapToTalk: micReason() });
  soon();
}

onCallStep((step, ev) => {
  for (const e of step.effects) EFFECTS[e]();
  const { pushToast } = useStore.getState();
  for (const n of step.show) pushToast(n.level, n.text, n.notice as Parameters<typeof pushToast>[2]);
  if (ev.type === 'reply' && step.call.paused) void voice().then((v) => v.pauseVoice()); // a reply that came in while paused waits
  if (ev.type === 'reply') useCall.setState({ heard: '' }); // your words stay up until the CEO answers
  soon();
});

/** What the mic heard on a call turn. */
const EARS = {
  speech: (text: string) => {
    useCall.setState({ managerSpeaking: true });
    void voice().then((v) => v.stopLine()); // barge-in stops an ack or progress line too (#286)
    dispatchCall({ type: 'speech', now: performance.now(), text });
  },
  closed: () => {
    useCall.setState({ managerSpeaking: false });
    tapping = false;
    soon();
  },
  problem: (why: string) => {
    useCall.setState({ managerSpeaking: false });
    tapping = false;
    dispatchCall({ type: 'mic-problem', why });
  },
};

/** A turn heard to the end: sent to the CEO, unless the CEO was talking and nobody barged in (the CEO's own echo). */
function turn(text: string) {
  const c = useCall.getState().call;
  if (!inCall(c) || (c.phase === 'speaking' && !tapping)) return;
  useCall.setState({ heard: text });
  if (cameraWords(text, CEO_ID)) return; // "turn on your camera" (#539): the call goes on listening
  sendToCeo(text);
  dispatchCall({ type: 'sent' });
}

// ---------- the mic follows the call ----------

let timer: ReturnType<typeof setTimeout> | null = null;

/** Opens or closes the call's mic to match the call, a moment later (never from inside the mic's own close). */
function soon() {
  if (!timer) timer = setTimeout(sync, 120);
}

function sync() {
  timer = null;
  if (agentOn()) return; // the Jarvis voice has its own mic

  const want = wantsMic(useCall.getState().call);
  const m = useMic.getState();
  if (want && m.state === 'idle') listen(TARGET, 'call');
  else if (!want && !tapping && m.target === TARGET && m.state === 'listening') stopListening(TARGET);
}

if (typeof window !== 'undefined') {
  // Another 🎙 (a held V in a chat) closing gives the call its mic back.
  useMic.subscribe((m, prev) => m.state === 'idle' && prev.state !== 'idle' && callOn() && soon());
  // Never listen in the background: the tab hidden or the phone locked puts the call on hold; back, it carries on.
  document.addEventListener('visibilitychange', () => dispatchCall({ type: document.visibilityState === 'hidden' ? 'hidden' : 'visible' }));
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('pagehide', () => callOn() && dispatchCall({ type: 'end' }));
}

// ---------- keys ----------

/** Space talks or pauses, → skips, M mutes, Esc ends: never while typing or in a terminal; Esc only from the call's own screen, so it still closes panels. */
function onKey(e: KeyboardEvent) {
  if (!callOn() || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const el = e.target as HTMLElement | null;
  if (el?.closest?.('input, textarea, select, [contenteditable="true"], .xterm')) return;
  if (e.code === 'Space' && el?.closest?.('button, a, [role="button"]')) return; // Space presses the focused button
  const act: Record<string, (() => void) | undefined> = {
    Space: () => (useCall.getState().call.tapToTalk ? talkOnce() : togglePause()),
    ArrowRight: skipSentence,
    KeyM: toggleMute,
    Escape: el?.closest?.('.vcall-screen, .vcall-card, .vcall-bubble, .vcall-pill') ? endCall : undefined,
  };
  const fn = act[e.code];
  if (!fn) return;
  e.preventDefault();
  e.stopImmediatePropagation(); // M mutes the call, not the office; Space doesn't jump
  fn();
}

// ---------- the probe ----------

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__swarmCall = {
    get id() {
      return useCall.getState().call.id;
    },
    get phase() {
      return useCall.getState().call.phase;
    },
    get state() {
      const { call, heard, minimised } = useCall.getState();
      return { ...call, held: call.held.length, heard, minimised };
    },
    /** The reply being read and where it is: { id, sentence, ms }, or null. */
    position: () => voice().then((v) => v.voicePosition()),
    start: startCall,
    end: endCall,
    /** The Jarvis voice (#534): its mode, and a turn typed to it (the demo's fake mic); agentProbe() its timings. */
    get agent() {
      return useAgentCall.getState().mode;
    },
    say: (text: string) => agent().then((a) => a.sayToAgent(text)),
    agentProbe: () => agent().then((a) => a.agentProbe()),
  };
}
