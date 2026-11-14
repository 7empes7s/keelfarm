// Runs the Jarvis voice on a call (#534, docs/voice.md "ElevenLabs Agents"): one ElevenLabs conversation over its
// signed URL (from the office; the key never reaches the browser), the mic as PCM 16 kHz into it, its voice out of
// the call's audio context, all inside voiceCall.ts's machine, so the call screens, captions, Mute, Pause, Skip,
// Speaker and End work as before. The office's LLM answers each turn (server/swarm/voiceAgent.ts); the CEO's replies
// and progress lines are said on the same voice through markers. "That's all" ends the conversation (the call stays:
// tap the orb to talk again); a hidden tab ends it too and the next visit starts a new one.
// Who listens (#658, shared/voiceAgent.ts agentListener): the browser's own recognition wherever it has one, else the
// agent's own listening on the mic's audio, else the office's OpenAI transcription, else a clip per turn (mic.ts); a
// listener that breaks or never hears hands over to the next, said once on the call screen and in the trace.
import { CEO_ID } from '../../../shared/types';
import { agentListener, DEFAULT_VOICE_AGENT, LISTENER_WORDS, nextListener, type ListenCaps } from '../../../shared/voiceAgent';
import { browserEars, relayEars, type Ears } from './agentEars';
import { echoOf, micProcessingOff } from './callEcho';
import { cameraWords } from './agentCameraStore';
import { marker, wantsToEnd } from '../../../shared/voiceBrain';
import { api } from '../api';
import { useStore } from '../store';
import { afterClose, agentEvent, closeWords, deafWhy, encodeMic, eventType, initMessage, inputFormat, level, pcmToFloat, replyLeftMs, TALK_LEVEL, type AgentMode } from './agentCall';
import { nonZeroPcmBytes } from '../../../shared/callTrace';
import { ctxLabel, trace, traceChunk, traceLevel, traceNote, traceReply, traceTrack, traceTranscript, traceUtterance, traceWs, turnHearing, turnSession, turnStep } from './callTrace';
import { callAudio, onAgentRelay, releaseCallAudio, useAgentCall } from './agentCallStore';
import { SILENT_LEVEL, SILENT_MIC_MS } from './micSilence';
import { AUDIO_ASLEEP, MIC_QUIET, micErrorLine } from './micText';
import { micCaps, recognitionClass } from './mic';
import { wantsMic } from './voiceCall';
import { callOn, dispatchCall, useCall } from './voiceCallStore';

let inRaw = ''; // ElevenLabs' user_input_audio_format, as it said it (#656)
let inFmt = inputFormat(''); // what the mic is sent as: its rate and codec (pcm_16000 until it says otherwise)
const talk = { first: 0, last: 0, shown: false }; // the manager talking since the last user_transcript (#656)
/** The turn is handed back this long after the voice's last audio, unless more comes. */
const DONE_MS = 300;

// The mic's samples into the page, from the audio thread (an AudioWorklet module from a blob: no extra file to serve),
// a stereo mic (a laptop's array, #656) mixed down to mono.
const WORKLET = `registerProcessor('cubefarm-mic', class extends AudioWorkletProcessor {
  process(inputs) {
    const chs = inputs[0] || [];
    if (!chs.length) return true;
    const out = chs[0].slice(0);
    for (let c = 1; c < chs.length; c++) for (let i = 0; i < out.length; i++) out[i] += chs[c][i];
    if (chs.length > 1) for (let i = 0; i < out.length; i++) out[i] /= chs.length;
    this.port.postMessage(out);
    return true;
  }
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
let mic: { stream: MediaStream; node: AudioWorkletNode; src: MediaStreamAudioSourceNode; rate: number; buf: Float32Array[]; len: number; heard: boolean; check: ReturnType<typeof setTimeout> } | null = null;
let wasLive = false; // the conversation was on when the tab was hidden: it starts again on return
let drops = 0; // conversations ElevenLabs closed in this call (#650)
let stt = false; // the office can relay the mic to OpenAI (it has a key)
let ears: Ears | null = null; // the browser's recognition, while the call wants the mic
let sttRelay: ReturnType<typeof relayEars> | null = null; // the office's OpenAI transcription
let activity: ReturnType<typeof setInterval> | null = null; // user_activity, so the agent's turn timeout never talks over the browser's listening
let activityAt = 0;
let noteTimer: ReturnType<typeof setTimeout> | null = null;
/** How often the agent hears the manager is there while someone else listens: its turn timeout is 7 s. */
const ACTIVITY_MS = 5_000;
/** A switch's words stay on the call screen this long. */
const NOTE_MS = 8_000;

/** What the probe shows (window.__swarmCall.agent): the mode, the last turn's timing, the events seen. */
const probe = { session: '', sentAt: 0, firstAudioAt: 0, said: [] as string[], heard: [] as string[], interrupted: 0, mic: { ctx: '', blocks: 0, chunks: 0, peak: 0, track: '' } };

const setMode = (mode: AgentMode) => useAgentCall.setState({ mode });
const mode = () => useAgentCall.getState().mode;
const listener = () => useAgentCall.getState().listener;
const caps = (): ListenCaps => {
  const m = micCaps();
  return { recognition: m.recognition, stream: typeof AudioWorkletNode !== 'undefined' && !!navigator.mediaDevices?.getUserMedia, stt, recorder: m.recorder };
};
const send = (m: unknown) => ws?.readyState === WebSocket.OPEN && ws.send(typeof m === 'string' ? m : JSON.stringify(m));

/** Starts a conversation (the call's first, or after "that's all" from a tap on the orb). Falls back to today's voice mode on failure. */
export async function connectAgent(fallback: (why: string) => void) {
  if (ws) return;
  setMode('connecting');
  const ctx = callAudio();
  trace({ audio: ctxLabel(ctx) });
  if (!ctx) return fail(fallback, "This browser can't play the Jarvis voice");
  let start: { session: string; url: string; stt?: boolean };
  try {
    const r = await api.startVoiceAgent();
    if ('unreachable' in r) return fail(fallback, r.unreachable); // #682: never a call that hangs on "thinking"
    start = r;
  } catch (err) {
    return fail(fallback, (err as Error).message);
  }
  if (!callOn()) {
    endSession(start.session);
    return;
  }
  session = probe.session = start.session;
  turnSession(session);
  stt = !!start.stt;
  const setting = (useStore.getState().settings.voice.agent ?? DEFAULT_VOICE_AGENT).listen;
  const first = agentListener(setting, caps());
  useAgentCall.setState({ listener: first });
  trace({ listen: first });
  traceNote(`listening: ${first}`);
  if (first !== 'browser' && first !== setting) note(LISTENER_WORDS[first]); // Firefox: said once (a listener picked for testing isn't news)
  const url = start.url.startsWith('/') ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${start.url}` : start.url;
  const sock = new WebSocket(url);
  ws = sock;
  sock.onopen = () => send(initMessage(session));
  sock.onmessage = (e) => onMessage(String(e.data));
  sock.onclose = (e) => {
    if (ws !== sock) return; // the office hung up itself
    trace({ close: { code: e.code, reason: e.reason } });
    const words = closeWords(e.code, e.reason);
    const dialling = mode() === 'connecting';
    const next = afterClose({ dialling, ending: endAfterReply, drops });
    traceNote(`${words}: ${next === 'redial' ? 'dialling again' : next === 'idle' ? 'resting after "that\'s all"' : "today's voice takes the call"}`);
    if (next === 'redial') drops++;
    closeConversation(next === 'idle' ? 'idle' : 'off');
    if (next === 'redial' && callOn()) {
      if (useCall.getState().call.phase === 'speaking') dispatchCall({ type: 'reply-ended' });
      return void connectAgent(fallback);
    }
    if (next === 'fallback') fail(fallback, dialling ? `${words}: it didn't take the call` : words);
  };
  if (first === 'browser' || first === 'clip') return; // the browser's recognition starts once the agent is ready; a clip is mic.ts's
  try {
    await startMic(ctx);
  } catch (err) {
    const name = (err as Error).name || 'Error';
    traceNote(`the Jarvis mic failed: ${name} ${(err as Error).message ?? ''}`.trim());
    closeConversation('off');
    return fail(fallback, name === 'NotAllowedError' ? (micErrorLine(name) ?? name) : `The microphone couldn't start (${name})`);
  }
}

function fail(fallback: (why: string) => void, why: string) {
  if (mode() !== 'off') traceNote(`Jarvis off: ${why}`);
  setMode('off');
  if (callOn()) fallback(why);
}

/** Hangs up the conversation: 'idle' keeps the call on (tap the orb to talk), 'off' leaves it to today's voice mode or the end. */
export function closeConversation(next: 'idle' | 'off') {
  const sock = ws;
  ws = null;
  sock?.close();
  stopMic();
  stopEars();
  if (activity) clearInterval(activity);
  activity = null;
  stopPlayback();
  if (session) endSession(session);
  session = '';
  turnSession('');
  markers = [];
  endAfterReply = false;
  droppedUpTo = -1; // a new conversation counts its audio events from 1 again: none of them was skipped
  lastEvent = 0;
  useAgentCall.setState({ mode: next, input: 0, output: 0, micWhy: '', listener: '' });
  if (callOn() && next === 'idle') dispatchCall({ type: 'reply-ended' });
}

/** The call ended: the conversation and the iPhone audio session go too. */
export function releaseAgent() {
  wasLive = false;
  drops = 0;
  closeConversation('off');
  useAgentCall.setState({ saying: '' });
  releaseCallAudio();
}

const endSession = (id: string) => {
  fetch(`/api/voice/agent/${encodeURIComponent(id)}/end`, { method: 'POST', keepalive: true }).catch(() => undefined);
};

// ---------- the socket ----------

function onMessage(raw: string) {
  traceWs(eventType(raw) || 'other');
  const ev = agentEvent(raw);
  switch (ev.kind) {
    case 'ready':
      rate = ev.rate;
      inRaw = ev.inFormat;
      inFmt = inputFormat(ev.inFormat);
      talk.first = talk.last = 0;
      talk.shown = false;
      trace({ inFormat: ev.inFormat || '(none: pcm_16000)', sentRate: inFmt.rate });
      if (!inFmt.ok) traceNote(`the agent wants ${ev.inFormat} audio, which this call can't send: it sends pcm_16000`);
      setMode('live');
      dispatchCall({ type: 'connected', tapToTalk: '' });
      if (listener() !== 'elevenlabs') startActivity();
      syncEars();
      return;
    case 'audio':
      return play(ev.event, ev.pcm);
    case 'said':
      traceReply();
      probe.said.push(ev.text);
      useAgentCall.setState({ saying: ev.text });
      return;
    case 'heard':
      traceTranscript();
      if (listener() !== 'elevenlabs') return; // its echo of a user_message the call sent: heard already
      if (echoOf(ev.text, replies())) return traceNote("ElevenLabs heard the voice's own reply: its echo, not shown");
      probe.heard.push(ev.text);
      turnStep('transcript', 'elevenlabs');
      turnStep('sent', 'elevenlabs'); // the agent has the words already
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
  talk.first = talk.last = 0;
  if (talk.shown) useAgentCall.setState({ micWhy: '' });
  talk.shown = false;
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
  turnStep('sent', listener() || 'typed');
  heard(text);
}

/** An utterance the browser, OpenAI or a clip heard: one user_message, unless it's the voice's own echo while it talks. */
export function sendHeard(text: string) {
  if (mode() !== 'live' || !text.trim()) return;
  if (useCall.getState().call.phase === 'speaking') return traceNote('words heard while the voice talked, with no barge-in: its echo, dropped');
  if (echoOf(text, replies())) return traceNote("words heard matching the voice's reply: its echo, dropped");
  traceUtterance();
  turnStep('transcript', listener());
  sayToAgent(text);
}

/** The words being said now: shown live, and talking over the voice interrupts it (voiceCall.ts's barge-in rules). */
function interim(text: string) {
  useCall.setState({ heard: text, managerSpeaking: !!text }); // the CEO's lines wait while the manager talks (flush)
  if (!text) return;
  turnHearing(listener());
  const now = performance.now();
  if (now - activityAt > 1000) {
    activityAt = now;
    send({ type: 'user_activity' });
  }
  if (useCall.getState().call.phase === 'speaking' && !echoOf(text, replies())) dispatchCall({ type: 'speech', now, text });
}

/** What the voice is saying now and said last: words heard that match them are its echo (#682). */
const replies = () => [useAgentCall.getState().saying, ...probe.said.slice(-2)];

/** The listener broke or never heard (`why`): the next one takes over, said once; none left and the call says why. */
function switchListener(why: string) {
  const cur = listener();
  const next = cur ? nextListener(cur, caps()) : null;
  traceNote(`${cur} stopped hearing: ${why}${next ? `: ${next} takes over` : ': nothing left to listen with'}`);
  if (!cur || !next) {
    useAgentCall.setState({ micWhy: `I can't hear you: ${why}` });
    void api.voiceProblem(`The Jarvis call can't hear the manager: ${why}`).catch(() => undefined);
    return;
  }
  stopEars();
  useAgentCall.setState({ listener: next });
  trace({ listen: next });
  note(LISTENER_WORDS[next]);
  if (next !== 'elevenlabs') startActivity();
  if (next === 'clip') return stopMic(); // mic.ts records each turn (voiceCallEngine.ts opens it)
  const ctx = callAudio();
  if (!mic && ctx) void startMic(ctx).catch((err: Error) => switchListener(`the microphone couldn't start (${err.name || 'Error'})`));
  syncEars();
}

/** A switch, in plain words on the call screen for a moment. */
function note(words: string) {
  useAgentCall.setState({ micWhy: `${words}.` });
  if (noteTimer) clearTimeout(noteTimer);
  noteTimer = setTimeout(() => useAgentCall.getState().micWhy === `${words}.` && useAgentCall.setState({ micWhy: '' }), NOTE_MS);
}

function startActivity() {
  if (activity) clearInterval(activity);
  activity = setInterval(() => mode() === 'live' && wantsMic(useCall.getState().call) && send({ type: 'user_activity' }), ACTIVITY_MS);
}

/** The browser's recognition or the OpenAI relay on while the call wants the mic (never muted, paused or away). */
function syncEars() {
  const l = listener();
  const want = mode() === 'live' && wantsMic(useCall.getState().call);
  if (ears && (!want || l !== 'browser')) stopEars();
  if (sttRelay && (!want || l !== 'openai')) stopEars();
  if (!want) return;
  const hooks = { interim, utterance: sendHeard, failed: (why: string) => switchListener(micErrorLine(why) ?? why) };
  if (l === 'browser' && !ears) {
    const R = recognitionClass();
    if (!R) return switchListener("this browser can't recognise speech");
    try {
      ears = browserEars(R, hooks, navigator.language || 'en-US');
    } catch {
      ears = null;
      switchListener('the speech recognition would not start');
    }
  } else if (l === 'openai' && !sttRelay) {
    sttRelay = relayEars(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/voice-stt?session=${encodeURIComponent(session)}`, hooks);
  }
}

function stopEars() {
  const e = ears;
  const r = sttRelay;
  ears = sttRelay = null;
  e?.stop();
  r?.stop();
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
  turnStep('firstAudio', listener()); // a turn's first audio, once (the greeting or a CEO line after it: ignored)
  turnStep('playback', listener(), (playHead - ctx.currentTime) * 1000);
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
/** Barge-in or End: stop talking now, the rest of this reply dropped, and the agent told the manager has the turn. */
export function stopAgentVoice() {
  droppedUpTo = Math.max(droppedUpTo, lastEvent);
  stopPlayback();
  send({ type: 'user_activity' });
}

// ---------- the mic ----------

async function startMic(ctx: AudioContext) {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  } catch (err) {
    trace({ gum: (err as Error).name || 'Error' });
    throw err;
  }
  trace({ gum: 'ok' });
  const track = stream.getAudioTracks()[0];
  traceTrack(track);
  const off = micProcessingOff(track?.getSettings?.() ?? {});
  traceNote(off.length ? `the browser didn't apply ${off.join(', ')} to the mic: the voice may hear itself` : 'the mic has echo cancellation, noise suppression and auto gain on');
  if (!ws) {
    for (const t of stream.getTracks()) t.stop(); // hung up while asking
    return;
  }
  if (ctx.state !== 'running') void ctx.resume().catch(() => undefined); // iPhones can stop the call's audio as the mic opens
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
  try {
    await ctx.audioWorklet.addModule(url);
    trace({ worklet: 'ok' });
  } catch (err) {
    trace({ worklet: `${(err as Error).name}: ${(err as Error).message}` });
    for (const t of stream.getTracks()) t.stop();
    throw err;
  } finally {
    URL.revokeObjectURL(url);
  }
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'cubefarm-mic');
  const t = stream.getAudioTracks()[0];
  probe.mic = { ctx: `${ctx.state} ${ctx.sampleRate}`, blocks: 0, chunks: 0, peak: 0, track: t ? `${t.readyState}${t.muted ? ' muted' : ''}` : 'none' };
  // A mic that gives only silence (#645, #648): the call screen says so and the office hears why, but the Jarvis voice
  // stays on (a quiet room or a mic that wakes late is no reason to drop it); the first sound clears the line.
  const check = setTimeout(() => {
    if (!mic || mic.heard || mode() !== 'live') return;
    const why = ctx.state === 'running' ? MIC_QUIET : AUDIO_ASLEEP; // a stopped audio clock runs no mic: a tap wakes it
    trace({ audio: ctxLabel(ctx) });
    traceNote(`silent mic after ${SILENT_MIC_MS} ms (${probe.mic.blocks} blocks, audio ${ctx.state}): the Jarvis voice stays, the call says "${why}"`);
    useAgentCall.setState({ micWhy: why });
    void api.voiceProblem(`${why} (the Jarvis voice's mic: ${probe.mic.blocks} blocks, audio ${ctx.state})`).catch(() => undefined);
  }, SILENT_MIC_MS);
  mic = { stream, node, src, rate: ctx.sampleRate, buf: [], len: 0, heard: false, check };
  trace({ audio: ctxLabel(ctx) });
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    traceLevel(rmsOf(e.data), true);
    onMic(e.data);
  };
  src.connect(node);
  node.connect(ctx.destination); // silent: it outputs nothing, but Safari only runs a node something pulls on
}

function onMic(samples: Float32Array) {
  if (!mic) return;
  const c = useCall.getState().call;
  const open = mode() === 'live' && wantsMic(c);
  const heard = level(samples);
  probe.mic.blocks++;
  probe.mic.peak = Math.max(probe.mic.peak, heard);
  if (heard >= SILENT_LEVEL && !mic.heard) {
    mic.heard = true;
    traceNote('the mic hears sound');
    const why = useAgentCall.getState().micWhy;
    if (why === MIC_QUIET || why === AUDIO_ASLEEP) useAgentCall.setState({ micWhy: '' }); // a switch's words stay (#658)
  }
  useAgentCall.setState({ input: open ? heard : 0 });
  const l = listener();
  if (!open || (l !== 'elevenlabs' && l !== 'openai')) return; // muted, paused or away (or the browser listens): nothing leaves the phone
  mic.buf.push(samples);
  mic.len += samples.length;
  if (mic.len < mic.rate / 10) return; // 100 ms of audio per message, resampled as one so no block edge drifts
  const all = new Float32Array(mic.len);
  let o = 0;
  for (const b of mic.buf) all.set(b, (o += b.length) - b.length);
  mic.buf = [];
  mic.len = 0;
  if (l === 'openai') return sttRelay?.push(all, mic.rate);
  const chunk = encodeMic(all, mic.rate, inFmt);
  probe.mic.chunks++;
  traceChunk(chunk.samples.length * (inFmt.codec === 'pcm' ? 2 : 1), nonZeroPcmBytes(chunk.samples));
  send({ user_audio_chunk: chunk.b64 });
  checkHearing(level(chunk.samples));
}

/** The manager talked and no user_transcript came back (#656): the call says so, once a conversation, never silent. */
function checkHearing(loud: number) {
  const now = performance.now();
  if (loud >= TALK_LEVEL && useCall.getState().call.phase !== 'speaking') {
    // not while the voice talks: its own echo is never a turn
    talk.first ||= now;
    talk.last = now;
    turnHearing('elevenlabs');
  }
  if (talk.shown) return;
  const why = deafWhy({ firstTalk: talk.first, lastTalk: talk.last, now, format: inRaw, sent: inFmt });
  if (!why) return;
  talk.shown = true;
  traceNote(`no user_transcript ${Math.round(now - talk.first)} ms after the manager talked (sent ${inFmt.codec} ${inFmt.rate} Hz, agent wants ${inRaw || 'its default'})`);
  if (nextListener('elevenlabs', caps())) return switchListener(`ElevenLabs sent no words back for ${Math.round((now - talk.first) / 1000)} s of your talking`);
  useAgentCall.setState({ micWhy: why });
  void api.voiceProblem(why).catch(() => undefined);
}

/** A block's loudness (RMS, 0..1), for the trace. */
function rmsOf(samples: Float32Array): number {
  let sum = 0;
  for (const x of samples) sum += x * x;
  return Math.sqrt(sum / Math.max(1, samples.length));
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
      traceNote('the tab is hidden: the Jarvis conversation rests');
      closeConversation('idle'); // never listens in the background, and an idle hour isn't billed
    } else if (!v.call.away && prev.call.away && wasLive && callOn()) {
      wasLive = false;
      void connectAgent(() => setMode('idle'));
    }
    if (prev.call.phase === 'speaking' && v.call.phase !== 'speaking') flush();
    if (v.call !== prev.call) syncEars();
  });
  // AirPods, a car or the earpiece: a new route gets a new mic stream.
  navigator.mediaDevices?.addEventListener?.('devicechange', () => {
    const ctx = callAudio();
    if (!mic || !ctx) return;
    traceNote('a new audio route: the mic starts again');
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
