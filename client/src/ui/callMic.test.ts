// A call's mic on an iPhone-like browser (#645): the wake word on, a call starts, and the manager's speech must reach
// the CEO. The fakes behave like iOS WebKit: a second mic stream is silent while an earlier one is live, an
// AudioContext made outside a tap stays suspended, and an AudioWorklet only runs when something pulls on it. With
// `interrupt` on, opening the mic stops the audio that's running (#648), as iOS does when it switches the audio session.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Store from '../store';
import type * as AgentStore from './agentCallStore';
import type * as Engine from './voiceCallEngine';
import type * as CallStore from './voiceCallStore';
import type * as Wake from './wake/wakeEngine';

vi.mock('onnxruntime-web/wasm', () => ({ env: { wasm: {} } }));
vi.mock('./voiceMessages', () => ({ stopSpeaking() {}, pauseVoice() {}, resumeVoice() {}, skipSentence() {}, stopLine() {}, voicePosition: () => null })); // the CEO's voice isn't under test
vi.mock('./wake/wakeModels', () => ({ loadWakeModels: async () => ({}) }));
vi.mock('./wake/wakePipeline', () => ({
  WAKE_RATE: 16_000,
  WakePipeline: class {
    threshold = 0.5;
    stats = { score: 0 };
    push = async () => wakeNow && !(wakeNow = false);
    reset() {}
  },
}));

let wakeNow = false;
let gesture = false;
/** Every stream's track is silent, whatever else holds the mic (a broken mic). */
let brokenMic = false;
/** The manager speaks between these times (performance.now()). */
let speech = { from: 0, to: 0 };
/** Opening the mic stops running audio (the first time for each context): 'capture' lets audio restart while the mic is live, 'tap' only from a tap. */
let interrupt: 'off' | 'capture' | 'tap' = 'off';
const contexts: Ctx[] = [];
const capturing = () => tracks.some((t) => t.readyState === 'live' && !t.muted);
let transcribeReply: { status: number; body: unknown } = { status: 200, body: { text: 'Ship the login page today' } };
const posts: { url: string; body: unknown; call?: string; type?: string }[] = [];

class Track {
  readyState: 'live' | 'ended' = 'live';
  constructor(public muted: boolean) {}
  stop() {
    this.readyState = 'ended';
  }
}
const tracks: Track[] = [];
const level = (t: Track | undefined, ctx: Ctx) => {
  if (!t || t.readyState !== 'live' || t.muted || ctx.state !== 'running') return 0;
  const now = performance.now();
  return now >= speech.from && now < speech.to ? 0.2 : 0.004;
};

class Node {
  source: Src | null = null;
  out: unknown[] = [];
  constructor(public ctx: Ctx) {}
  connect(to: unknown) {
    this.out.push(to);
    return to;
  }
  disconnect() {
    this.out = [];
  }
}
class Src extends Node {
  constructor(
    ctx: Ctx,
    public track: Track | undefined,
  ) {
    super(ctx);
  }
  override connect(to: Node) {
    to.source = this;
    return super.connect(to);
  }
}
class Analyser extends Node {
  fftSize = 1024;
  getFloatTimeDomainData(buf: Float32Array) {
    buf.fill(level(this.source?.track, this.ctx));
  }
}
const worklets: Worklet[] = [];
class Worklet extends Node {
  port: { onmessage: ((e: { data: Float32Array }) => void) | null } = { onmessage: null };
  constructor(ctx: Ctx) {
    super(ctx);
    worklets.push(this);
  }
}
class Ctx {
  state: 'running' | 'suspended' | 'closed' = gesture ? 'running' : 'suspended';
  sampleRate = 48_000;
  currentTime = 0;
  destination = { kind: 'destination' };
  audioWorklet = { addModule: async () => undefined };
  interrupted = false; // once per context: the audio session switches to talking both ways
  constructor() {
    contexts.push(this);
  }
  resume() {
    if ((gesture || (interrupt === 'capture' && capturing())) && this.state !== 'closed') this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
  createMediaStreamSource(s: { getTracks(): Track[] }) {
    return new Src(this, s.getTracks()[0]);
  }
  createAnalyser() {
    return new Analyser(this);
  }
  createGain() {
    return Object.assign(new Node(this), { gain: { value: 1 } });
  }
}

/** The audio thread: every 100 ms, each worklet something pulls on (wired to the speakers) gets the mic's samples. */
function audioThread() {
  for (const w of worklets) {
    if (!w.source || !w.out.includes(w.ctx.destination) || w.ctx.state !== 'running') continue;
    w.port.onmessage?.({ data: new Float32Array(4800).fill(level(w.source.track, w.ctx)) });
  }
}

class Recorder {
  static isTypeSupported = (t: string) => t === 'audio/mp4';
  state = 'inactive';
  mimeType = 'audio/mp4';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob([new Uint8Array(4000)], { type: 'audio/mp4' }) });
    this.onstop?.();
  }
}

const sockets: Sock[] = [];
class Sock {
  static OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor() {
    sockets.push(this);
    queueMicrotask(() => this.onopen?.());
  }
  send(m: string) {
    this.sent.push(m);
  }
  close() {}
}

async function fakeFetch(url: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) {
  const json = (status: number, body: unknown) => ({ ok: status < 300, status, statusText: '', json: async () => body }); // not undici's Response: it needs real microtasks
  if (init?.method === 'POST' && typeof init.body === 'string') posts.push({ url, body: JSON.parse(init.body) });
  else if (init?.method === 'POST') posts.push({ url, body: null, call: init.headers?.['X-Voice-Call'], type: init.headers?.['Content-Type'] });
  if (url === '/api/voice/transcribe') return json(transcribeReply.status, transcribeReply.body);
  if (url === '/api/voice/agent/start') return json(200, { session: 's1', url: '/fake-agent' });
  return json(200, {});
}

let engine: typeof Engine;
let wake: typeof Wake;
let store: typeof Store;
let call: typeof CallStore;
let agentStore: typeof AgentStore;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'queueMicrotask'] });
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {}, location: { search: '' } });
  vi.stubGlobal('document', { addEventListener() {}, visibilityState: 'visible' });
  vi.stubGlobal('location', { protocol: 'http:', host: 'office.test' });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} })); // pocket mode's pick, on store import
  vi.stubGlobal('navigator', {
    language: 'en-US',
    mediaDevices: {
      // iOS: a second capture while an earlier track is live comes back silent.
      getUserMedia: async () => {
        const t = new Track(brokenMic || tracks.some((x) => x.readyState === 'live'));
        tracks.push(t);
        if (interrupt !== 'off') for (const c of contexts) if (c.state === 'running' && !c.interrupted) Object.assign(c, { state: 'suspended', interrupted: true });
        return { getTracks: () => [t], getAudioTracks: () => [t] };
      },
    },
  });
  vi.stubGlobal('AudioContext', Ctx);
  vi.stubGlobal('AudioWorkletNode', Worklet);
  vi.stubGlobal('MediaRecorder', Recorder);
  vi.stubGlobal('WebSocket', Sock);
  vi.stubGlobal('fetch', fakeFetch);
  store = await import('../store');
  call = await import('./voiceCallStore');
  agentStore = await import('./agentCallStore');
  engine = await import('./voiceCallEngine');
  wake = await import('./wake/wakeEngine');
  await import('./agentCallEngine'); // loaded on a call: here, so fake time needn't wait for it
});

afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function settings(jarvis: boolean, listen: 'browser' | 'elevenlabs' = 'elevenlabs', keySet = true) {
  const st = store.useStore.getState();
  store.useStore.setState({
    voiceKeySet: keySet,
    voiceAgent: { ...st.voiceAgent, fake: true, minutesMonth: 0 },
    settings: { ...st.settings, listen: { provider: listen, autoSend: true, handsFree: false }, voice: { ...st.settings.voice, agent: { ...st.settings.voice.agent!, on: jarvis } } },
  });
}

/** Lets fake time pass, the audio thread running. */
async function wait(ms: number) {
  for (let t = 0; t < ms; t += 100) {
    audioThread();
    await vi.advanceTimersByTimeAsync(100);
  }
}

/** The wake word listening (turned on with a tap), then "Hey Mimoun". */
async function wakeWordStartsCall() {
  gesture = true;
  await wake.listen({ on: true, word: 'hey-mimoun', sensitivity: 0.5 });
  gesture = false;
  expect(tracks.filter((t) => t.readyState === 'live')).toHaveLength(1); // the wake word holds the mic
  wakeNow = true;
  await wait(200);
  expect(call.callOn()).toBe(true);
}

/** ElevenLabs says the conversation is on. */
const agentReady = () => sockets.at(-1)!.onmessage?.({ data: JSON.stringify({ type: 'conversation_initiation_metadata', conversation_initiation_metadata_event: { agent_output_audio_format: 'pcm_16000' } }) });
/** Some of the mic's audio sent to ElevenLabs isn't silence. */
const heardChunks = () =>
  sockets
    .at(-1)!
    .sent.filter((m) => m.includes('user_audio_chunk'))
    .some((m) => Buffer.from((JSON.parse(m) as { user_audio_chunk: string }).user_audio_chunk, 'base64').some((b) => b !== 0));
const ceoGot = () => posts.filter((p) => p.url === '/api/ceo/message').map((p) => (p.body as { text: string }).text);
const problems = () => posts.filter((p) => p.url === '/api/voice/problem').map((p) => (p.body as { problem: string }).problem);

beforeEach(async () => {
  engine.endCall();
  await wait(500);
  wake.stopWake();
  for (const t of tracks) t.stop();
  posts.length = 0;
  brokenMic = false;
  interrupt = 'off';
  for (const c of contexts) c.interrupted = false; // the call's audio lives on between calls
  transcribeReply = { status: 200, body: { text: 'Ship the login page today' } };
});

describe("a call's mic with the wake word on (#645)", () => {
  it('lets go of the wake word, hears the manager and sends the words to the CEO', async () => {
    settings(false);
    await wakeWordStartsCall();
    await wait(1500); // the chime, then the call's mic opens
    const now = performance.now();
    speech = { from: now + 600, to: now + 2600 };
    await wait(7000);
    expect(ceoGot()).toEqual(['Ship the login page today']);
    expect(problems()).toEqual([]);
  });

  it('the Jarvis voice hears the manager too: its mic reaches ElevenLabs', async () => {
    settings(true);
    await wakeWordStartsCall();
    const sock = sockets.at(-1)!;
    sock.onmessage?.({ data: JSON.stringify({ type: 'conversation_initiation_metadata', conversation_initiation_metadata_event: { agent_output_audio_format: 'pcm_16000' } }) });
    expect(agentStore.useAgentCall.getState().mode).toBe('live');
    const now = performance.now();
    speech = { from: now, to: now + 2000 };
    await wait(1000);
    const chunks = sock.sent.filter((m) => m.includes('user_audio_chunk')).map((m) => (JSON.parse(m) as { user_audio_chunk: string }).user_audio_chunk);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((c) => Buffer.from(c, 'base64').some((b) => b !== 0))).toBe(true); // not silence
  });
});

describe('a call listens through the office (#645)', () => {
  it("with the office's ElevenLabs key, even when Talk instead of type is on the browser", async () => {
    settings(false, 'browser');
    gesture = true;
    engine.startCall();
    gesture = false;
    await wait(1500);
    const now = performance.now();
    speech = { from: now + 600, to: now + 2600 };
    await wait(7000);
    expect(posts.filter((p) => p.url === '/api/voice/transcribe').map((p) => [p.call, p.type])).toEqual([['1', 'audio/mp4']]); // Safari's recorder makes MP4 (server/callStt.test.ts takes it from there)
    expect(ceoGot()).toEqual(['Ship the login page today']);
  });

  it("without a key, the browser's recognition that never starts says so", async () => {
    settings(false, 'browser', false);
    const w = window as unknown as Record<string, unknown>;
    w.webkitSpeechRecognition = class {
      start() {}
      stop() {}
      abort() {}
    };
    try {
      gesture = true;
      engine.startCall();
      gesture = false;
      await wait(13_000);
      expect(call.useCall.getState().call.tapToTalk).toMatch(/microphone didn't start/);
      expect(problems()).toEqual([expect.stringMatching(/microphone didn't start/)]);
    } finally {
      delete w.webkitSpeechRecognition;
    }
  });
});

describe('never failing silently (#645)', () => {
  it('a silent mic says so on the call screen and tells the office', async () => {
    settings(false);
    brokenMic = true;
    gesture = true;
    engine.startCall();
    gesture = false;
    const now = performance.now();
    speech = { from: now + 2000, to: now + 4000 };
    await wait(10_000);
    expect(call.useCall.getState().call.tapToTalk).toMatch(/can't hear you: the microphone is silent/);
    expect(problems()).toEqual([expect.stringMatching(/microphone is silent/)]);
    expect(ceoGot()).toEqual([]);
  });

  it('a silent Jarvis mic says so on the call screen and tells the office, but the Jarvis voice stays on (#648)', async () => {
    settings(true);
    brokenMic = true;
    gesture = true;
    engine.startCall();
    gesture = false;
    await wait(100);
    agentReady();
    await wait(6000);
    expect(agentStore.useAgentCall.getState().mode).toBe('live');
    expect(agentStore.useAgentCall.getState().micWhy).toMatch(/microphone is silent/);
    expect(problems()).toEqual([expect.stringMatching(/microphone is silent.*Jarvis/)]);
    expect(call.useCall.getState().call.tapToTalk).toBe('');
  });

  it('a failed transcription says the speech service failed, with its reason', async () => {
    settings(false);
    transcribeReply = { status: 502, body: { error: "ElevenLabs didn't answer" } };
    gesture = true;
    engine.startCall();
    gesture = false;
    await wait(1500);
    const now = performance.now();
    speech = { from: now + 600, to: now + 2600 };
    await wait(7000);
    expect(call.useCall.getState().call.tapToTalk).toBe("I can't hear you: the speech service failed (ElevenLabs didn't answer).");
    expect(ceoGot()).toEqual([]);
  });
});

describe("an iPhone stops the call's audio as the mic opens (#648)", () => {
  it('the Jarvis voice starts it again and its mic reaches ElevenLabs', async () => {
    settings(true);
    interrupt = 'capture';
    gesture = true;
    engine.startCall();
    gesture = false;
    await wait(100);
    agentReady();
    const now = performance.now();
    speech = { from: now, to: now + 2000 };
    await wait(6000);
    expect(agentStore.useAgentCall.getState().mode).toBe('live');
    expect(heardChunks()).toBe(true);
    // The manager talked and this fake ElevenLabs sends no user_transcript: the call says so, never silent (#656).
    expect(agentStore.useAgentCall.getState().micWhy).toMatch(/^The voice isn't hearing you: ElevenLabs gets your audio/);
    expect(problems()).toEqual([expect.stringMatching(/isn't hearing you/)]);
  });

  it('when only a tap starts it, the call says tap the screen, keeps the Jarvis voice, and a tap hears the manager', async () => {
    settings(true);
    interrupt = 'tap';
    gesture = true;
    engine.startCall();
    gesture = false;
    await wait(100);
    agentReady();
    await wait(6000);
    expect(agentStore.useAgentCall.getState().mode).toBe('live');
    expect(agentStore.useAgentCall.getState().micWhy).toMatch(/tap the screen/);
    gesture = true;
    agentStore.callAudio(); // the tap anywhere (agentCallEngine's pointerdown)
    gesture = false;
    const now = performance.now();
    speech = { from: now, to: now + 2000 };
    await wait(1000);
    expect(heardChunks()).toBe(true);
    expect(agentStore.useAgentCall.getState().micWhy).toBe('');
  });

  it("the office's own voice says tap, not a silent mic, and Talk hears the manager", async () => {
    settings(false);
    interrupt = 'tap';
    gesture = true;
    engine.startCall();
    gesture = false;
    await wait(10_000);
    expect(call.useCall.getState().call.tapToTalk).toMatch(/tap the screen/);
    expect(problems()).toEqual([expect.stringMatching(/tap the screen/)]);
    gesture = true;
    engine.talkOnce();
    gesture = false;
    const now = performance.now();
    speech = { from: now + 600, to: now + 2600 };
    await wait(7000);
    expect(ceoGot()).toEqual(['Ship the login page today']);
  });
});
