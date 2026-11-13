// Runs the Jarvis voice on a call (#534, docs/voice.md "ElevenLabs Agents"): one ElevenLabs conversation over its
// signed URL (from the office; the key never reaches the browser), the mic as PCM 16 kHz into it, its voice out of
// the call's audio context, all inside voiceCall.ts's machine, so the call screens, captions, Mute, Pause, Skip,
// Speaker and End work as before. The office's LLM answers each turn (server/swarm/voiceAgent.ts); the CEO's replies
// and progress lines are said on the same voice through markers. "That's all" ends the conversation (the call stays:
// tap the orb to talk again); a hidden tab ends it too and the next visit starts a new one.
import { CEO_ID } from '../../../shared/types';
import { cameraWords } from './agentCameraStore';
import { marker, wantsToEnd } from '../../../shared/voiceBrain';
import { api } from '../api';
import { useStore } from '../store';
import { agentEvent, downsample, floatToPcm, initMessage, level, pcmToFloat, replyLeftMs, type AgentMode } from './agentCall';
import { callAudio, onAgentRelay, releaseCallAudio, useAgentCall } from './agentCallStore';
import { SILENT_LEVEL, SILENT_MIC_MS } from './micSilence';
import { MIC_SILENT } from './micText';
import { wantsMic } from './voiceCall';
import { callOn, dispatchCall, useCall } from './voiceCallStore';

const MIC_RATE = 16_000;
const CHUNK = 1600; // 100 ms of 16 kHz audio per message
/** The turn is handed back this long after the voice's last audio, unless more comes. */
const DONE_MS = 300;

// The mic's samples into the page, from the audio thread (an AudioWorklet module from a blob: no extra file to serve).
const WORKLET = `registerProcessor('cubefarm-mic', class extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
});`;

let ws: WebSocket | null = null;
let session = '';
let rate = 16_000;
let out: GainNode | null = null;
let playHead = 0;
let playing: { src: AudioBufferSourceNode; event: number }[] = [];
let droppedUpTo = -1; // audio events interrupted or skipped
let lastEvent = 0;
let doneTimer: ReturnType<typeof setTimeout> | null = null;
let backstop: ReturnType<typeof setTimeout> | null = null; // ends the reply when onended never comes
let wallEnd = 0; // when the queued audio ends, on the wall clock
let clockAt = 0; // the audio clock at the last look: one that stands still isn't playing
let endAfterReply = false;
let markers: string[] = []; // the CEO's replies and progress lines, said when the voice is free
let mic: { stream: MediaStream; node: AudioWorkletNode; src: MediaStreamAudioSourceNode; buf: Float32Array[]; len: number; heard: boolean; check: ReturnType<typeof setTimeout> } | null = null;
let fallbackTo: ((why: string) => void) | null = null; // today's voice mode, when this conversation can't hear
let wasLive = false; // the conversation was on when the tab was hidden: it starts again on return

/** What the probe shows (window.__swarmCall.agent): the mode, the last turn's timing, the events seen. */
const probe = { session: '', sentAt: 0, firstAudioAt: 0, said: [] as string[], heard: [] as string[], interrupted: 0 };

const setMode = (mode: AgentMode) => useAgentCall.setState({ mode });
const mode = () => useAgentCall.getState().mode;
const send = (m: unknown) => ws?.readyState === WebSocket.OPEN && ws.send(typeof m === 'string' ? m : JSON.stringify(m));

/** Starts a conversation (the call's first, or after "that's all" from a tap on the orb). Falls back to today's voice mode on failure. */
export async function connectAgent(fallback: (why: string) => void) {
  if (ws) return;
  fallbackTo = fallback;
  setMode('connecting');
  const ctx = callAudio();
  if (!ctx) return fail(fallback, "This browser can't play the Jarvis voice");
  let start: { session: string; url: string };
  try {
    start = await api.startVoiceAgent();
  } catch (err) {
    return fail(fallback, (err as Error).message);
  }
  if (!callOn()) {
    endSession(start.session);
    return;
  }
  session = probe.session = start.session;
  const url = start.url.startsWith('/') ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${start.url}` : start.url;
  const sock = new WebSocket(url);
  ws = sock;
  sock.onopen = () => send(initMessage(session));
  sock.onmessage = (e) => onMessage(String(e.data));
  sock.onclose = () => {
    if (ws !== sock) return;
    const dialling = mode() === 'connecting';
    closeConversation(dialling ? 'off' : 'idle');
    if (dialling) fail(fallback, "ElevenLabs didn't take the call");
  };
  try {
    await startMic(ctx);
  } catch (err) {
    closeConversation('off');
    return fail(fallback, (err as Error).name === 'NotAllowedError' ? 'The microphone was refused' : "The microphone couldn't start");
  }
}

function fail(fallback: (why: string) => void, why: string) {
  setMode('off');
  if (callOn()) fallback(why);
}

/** Hangs up the conversation: 'idle' keeps the call on (tap the orb to talk), 'off' leaves it to today's voice mode or the end. */
export function closeConversation(next: 'idle' | 'off') {
  const sock = ws;
  ws = null;
  sock?.close();
  stopMic();
  stopPlayback();
  if (session) endSession(session);
  session = '';
  markers = [];
  endAfterReply = false;
  useAgentCall.setState({ mode: next, input: 0, output: 0 });
  if (callOn() && next === 'idle') dispatchCall({ type: 'reply-ended' });
}

/** The call ended: the conversation and the iPhone audio session go too. */
export function releaseAgent() {
  wasLive = false;
  closeConversation('off');
  useAgentCall.setState({ saying: '' });
  releaseCallAudio();
}

const endSession = (id: string) => {
  fetch(`/api/voice/agent/${encodeURIComponent(id)}/end`, { method: 'POST', keepalive: true }).catch(() => undefined);
};

// ---------- the socket ----------

function onMessage(raw: string) {
  const ev = agentEvent(raw);
  switch (ev.kind) {
    case 'ready':
      rate = ev.rate;
      setMode('live');
      dispatchCall({ type: 'connected', tapToTalk: '' });
      return;
    case 'audio':
      return play(ev.event, ev.pcm);
    case 'said':
      probe.said.push(ev.text);
      useAgentCall.setState({ saying: ev.text });
      return;
    case 'heard':
      probe.heard.push(ev.text);
      return heard(ev.text);
    case 'interrupted':
      probe.interrupted++;
      droppedUpTo = Math.max(droppedUpTo, ev.event);
      stopPlayback();
      if (useCall.getState().call.phase === 'speaking') dispatchCall({ type: 'reply-ended' });
      return;
    case 'ping':
      return void send({ type: 'pong', event_id: ev.event });
    case 'vad':
      useCall.setState({ managerSpeaking: ev.score > 0.5 });
      return;
  }
}

/** The manager's turn, as ElevenLabs heard it (or typed by the demo's probe): captions, thinking, and "that's all". */
function heard(text: string) {
  useCall.setState({ heard: text });
  cameraWords(text, CEO_ID); // "turn on your camera" (#539)
  if (wantsToEnd(text)) endAfterReply = true;
  if (useCall.getState().call.phase === 'listening') dispatchCall({ type: 'sent' });
}

/** Sends a typed turn, as the demo and QA's fake mic do (`__swarmCall.say`); talking over the voice interrupts it. */
export function sayToAgent(text: string) {
  if (mode() !== 'live' || !text.trim()) return;
  probe.sentAt = performance.now();
  probe.firstAudioAt = 0;
  send({ type: 'user_message', text });
  heard(text);
}

/** The CEO's reply or a progress line, said by the Jarvis voice once it's free. */
function relay(kind: 'msg' | 'line', id: number) {
  markers.push(marker(kind, id));
  flush();
}

function flush() {
  const c = useCall.getState().call;
  if (!markers.length || mode() !== 'live' || c.phase === 'speaking' || c.paused || useCall.getState().managerSpeaking) return;
  send({ type: 'user_message', text: markers.shift()! });
}

// ---------- the voice ----------

function play(event: number, pcm: string) {
  const ctx = callAudio();
  if (!ctx || event <= droppedUpTo || !pcm) return;
  if (!probe.firstAudioAt && probe.sentAt) probe.firstAudioAt = performance.now();
  lastEvent = event;
  out ??= ctx.createGain();
  out.gain.value = useCall.getState().speaker ? 1 : 0.35;
  out.connect(ctx.destination);
  const samples = pcmToFloat(pcm);
  const buf = ctx.createBuffer(1, samples.length, rate);
  buf.getChannelData(0).set(samples);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(out);
  playHead = Math.max(playHead, ctx.currentTime + 0.02);
  src.start(playHead);
  playHead += buf.duration;
  playing.push({ src, event });
  useAgentCall.setState({ output: level(samples) });
  src.onended = () => {
    playing = playing.filter((p) => p.src !== src);
    if (!playing.length) finishSoon();
  };
  if (doneTimer) clearTimeout(doneTimer);
  doneTimer = null;
  const now = performance.now();
  clockAt = ctx.currentTime;
  wallEnd = Math.max(wallEnd, now + 20) + buf.duration * 1000;
  armBackstop(wallEnd - now + DONE_MS);
  if (useCall.getState().call.phase !== 'speaking') dispatchCall({ type: 'reply', id: -event, sentences: 1 });
}

/** If the call's audio context isn't running its clock stands still and onended never fires: the reply ends on time anyway. */
function armBackstop(ms: number) {
  if (backstop) clearTimeout(backstop);
  backstop = setTimeout(() => {
    backstop = null;
    const ctx = out?.context;
    const running = !!ctx && ctx.state === 'running' && ctx.currentTime > clockAt;
    if (ctx) clockAt = ctx.currentTime;
    const wait = replyLeftMs({ paused: useCall.getState().call.paused, running, left: ctx ? playHead - ctx.currentTime : 0 });
    if (wait) return armBackstop(wait);
    if (!playing.length) return;
    stopPlayback();
    finishSoon();
  }, ms);
}

/** The voice went quiet: the turn is the manager's again (and "that's all" ends the conversation). */
function finishSoon() {
  if (doneTimer) clearTimeout(doneTimer);
  doneTimer = setTimeout(() => {
    doneTimer = null;
    if (playing.length) return;
    useAgentCall.setState({ output: 0 });
    if (useCall.getState().call.phase === 'speaking') dispatchCall({ type: 'reply-ended' });
    if (endAfterReply) return closeConversation('idle');
    flush();
  }, DONE_MS);
}

function stopPlayback() {
  for (const p of playing) {
    p.src.onended = null;
    try {
      p.src.stop();
    } catch {
      // not started yet
    }
  }
  playing = [];
  playHead = 0;
  wallEnd = 0;
  if (doneTimer) clearTimeout(doneTimer);
  doneTimer = null;
  if (backstop) clearTimeout(backstop);
  backstop = null;
  useAgentCall.setState({ output: 0 });
}

/** Skip: the rest of what it's saying now goes. */
export function skipAgent() {
  droppedUpTo = Math.max(droppedUpTo, lastEvent);
  stopPlayback();
  finishSoon();
}

/** Pause holds the voice where it is (and the mic, which wantsMic closes); Resume carries on. */
export const pauseAgent = () => void callAudio()?.suspend();
export const resumeAgent = () => void callAudio()?.resume();
/** Barge-in or End: stop talking now. */
export const stopAgentVoice = () => stopPlayback();

// ---------- the mic ----------

async function startMic(ctx: AudioContext) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  if (!ws) {
    for (const t of stream.getTracks()) t.stop(); // hung up while asking
    return;
  }
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'cubefarm-mic');
  // A mic that gives only silence (#645): the office's own voice takes the call, and the office hears why.
  const check = setTimeout(() => {
    if (!mic || mic.heard || mode() !== 'live') return;
    void api.voiceProblem(`${MIC_SILENT} (the Jarvis voice's mic)`).catch(() => undefined);
    closeConversation('off');
    if (fallbackTo) fail(fallbackTo, MIC_SILENT);
  }, SILENT_MIC_MS);
  mic = { stream, node, src, buf: [], len: 0, heard: false, check };
  node.port.onmessage = (e: MessageEvent<Float32Array>) => onMic(downsample(e.data, ctx.sampleRate, MIC_RATE));
  src.connect(node);
  node.connect(ctx.destination); // silent: it outputs nothing, but Safari only runs a node something pulls on
}

function onMic(samples: Float32Array) {
  if (!mic) return;
  const c = useCall.getState().call;
  const open = mode() === 'live' && wantsMic(c);
  const heard = level(samples);
  if (heard >= SILENT_LEVEL) mic.heard = true;
  useAgentCall.setState({ input: open ? heard : 0 });
  if (!open) return; // muted, paused or away: nothing leaves the phone
  mic.buf.push(samples);
  mic.len += samples.length;
  if (mic.len < CHUNK) return;
  const all = new Float32Array(mic.len);
  let o = 0;
  for (const b of mic.buf) all.set(b, (o += b.length) - b.length);
  mic.buf = [];
  mic.len = 0;
  send({ user_audio_chunk: floatToPcm(all) });
}

function stopMic() {
  if (!mic) return;
  clearTimeout(mic.check);
  mic.node.port.onmessage = null;
  mic.src.disconnect();
  mic.node.disconnect();
  for (const t of mic.stream.getTracks()) t.stop();
  mic = null;
}

// ---------- the call around it ----------

onAgentRelay(relay);

if (typeof window !== 'undefined') {
  // Speaker, and a pause, mute or hidden tab, follow the call as it changes.
  useCall.subscribe((v, prev) => {
    if (out && v.speaker !== prev.speaker) out.gain.value = v.speaker ? 1 : 0.35;
    if (v.call.away && !prev.call.away && ws) {
      wasLive = true;
      closeConversation('idle'); // never listens in the background, and an idle hour isn't billed
    } else if (!v.call.away && prev.call.away && wasLive && callOn()) {
      wasLive = false;
      void connectAgent(() => setMode('idle'));
    }
    if (prev.call.phase === 'speaking' && v.call.phase !== 'speaking') flush();
  });
  // AirPods, a car or the earpiece: a new route gets a new mic stream.
  navigator.mediaDevices?.addEventListener?.('devicechange', () => {
    const ctx = callAudio();
    if (!mic || !ctx) return;
    stopMic();
    void startMic(ctx).catch(() => dispatchCall({ type: 'mic-problem', why: "The microphone couldn't switch" }));
  });
  // iOS suspends ("interrupted") the audio on a phone call or Siri: the next tap wakes it.
  const wake = () => {
    if (callOn() && mode() !== 'off' && !useCall.getState().call.paused) callAudio();
  };
  window.addEventListener('pointerdown', wake, true);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && wake());
}

/** For the probe. */
export const agentProbe = () => ({ mode: mode(), saying: useAgentCall.getState().saying, ...probe, ackMs: probe.firstAudioAt && probe.sentAt ? Math.round(probe.firstAudioAt - probe.sentAt) : null, pending: markers.length, playing: playing.length, audio: out ? { state: out.context.state, time: out.context.currentTime } : null, store: useStore.getState().voiceAgent });
