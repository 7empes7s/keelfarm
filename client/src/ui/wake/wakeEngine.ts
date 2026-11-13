// Listens for the wake word in the browser (#537, docs/voice.md "Wake word"), loaded only once it's turned on: the mic
// through an AudioWorklet, down to 16 kHz, into wakePipeline.ts on onnxruntime-web (WASM, one thread). Nothing
// leaves the device. On a wake: a soft chime, then the call starts as if Call was tapped.
// WakeRunner (WakeRunner.tsx) decides when it listens; this only starts and stops.
import { callAudio } from '../agentCallStore';
import { downsample } from '../agentCall';
import { listenChime } from '../sfx';
import { startCall } from '../voiceCallEngine';
import { callOn } from '../voiceCallStore';
import { loadWakeModels } from './wakeModels';
import { WakePipeline, WAKE_RATE } from './wakePipeline';
import { onWakeStop, useWake } from './wakeStore';
import { wakeThreshold, wakeWord, type WakePrefs, type WakeWordId } from './wakeWord';

// The mic's samples in blocks of 2048 (about 43 ms at 48 kHz), so the page wakes ~23 times a second, not ~375.
const WORKLET = `registerProcessor('cubefarm-wake', class extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) { this.buf.set(ch, this.n); this.n += ch.length; if (this.n >= 2048) { this.port.postMessage(this.buf.slice(0, this.n)); this.n = 0; } }
    return true;
  }
});`;

let pipeline: { word: WakeWordId; p: WakePipeline } | null = null;
let mic: { stream: MediaStream; src: MediaStreamAudioSourceNode; node: AudioWorkletNode } | null = null;
const worklets = new WeakSet<AudioContext>();
let run = 0; // the latest listen(); an older one that finishes late gives up
let waitingTap: (() => void) | null = null;

const set = (status: ReturnType<typeof useWake.getState>['status']) => useWake.setState({ status });

async function models(word: WakeWordId) {
  const ort = await import('onnxruntime-web/wasm');
  ort.env.wasm.numThreads = 1; // no SharedArrayBuffer without cross-origin isolation, and one thread is plenty
  const base = import.meta.env.BASE_URL;
  return loadWakeModels(ort, async (file) => new Uint8Array(await (await fetch(`${base}wake/${file}`)).arrayBuffer()), wakeWord(word).model);
}

/** Starts listening (or changes the word or sensitivity while it does). */
export async function listen(prefs: WakePrefs) {
  const me = ++run;
  if (pipeline?.word === prefs.word) pipeline.p.threshold = wakeThreshold(prefs.sensitivity);
  if (mic && pipeline?.word === prefs.word) return set('');
  set('starting');
  try {
    if (pipeline?.word !== prefs.word) pipeline = { word: prefs.word, p: new WakePipeline(await models(prefs.word), wakeThreshold(prefs.sensitivity)) };
  } catch (err) {
    if (me === run) useWake.setState({ status: 'error', why: (err as Error).message ?? String(err) });
    return;
  }
  const ctx = callAudio();
  if (me !== run) return;
  if (!ctx) return useWake.setState({ status: 'error', why: "this browser can't run audio" });
  if (!mic) {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    } catch (err) {
      if (me === run) useWake.setState({ status: 'no-mic', micRefused: (err as Error).name === 'NotAllowedError' });
      return;
    }
    if (me !== run) {
      for (const t of stream.getTracks()) t.stop();
      return;
    }
    if (!worklets.has(ctx)) {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
      try {
        await ctx.audioWorklet.addModule(url);
        worklets.add(ctx);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    const src = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'cubefarm-wake');
    node.port.onmessage = (e: MessageEvent<Float32Array>) => void hear(downsample(e.data, ctx.sampleRate, WAKE_RATE));
    src.connect(node);
    node.connect(ctx.destination); // silent: it outputs nothing, but Safari only runs a node something pulls on
    mic = { stream, src, node };
    if (me !== run) return stopMic();
  }
  if (ctx.state === 'running') return set('');
  // The browser wants a tap before audio runs (a reload, an iPhone): the first one anywhere starts it.
  set('tap');
  waitingTap?.();
  const go = () => {
    waitingTap?.();
    void ctx.resume().then(() => me === run && mic && set(''));
  };
  window.addEventListener('pointerdown', go, { once: true, capture: true });
  window.addEventListener('keydown', go, { once: true, capture: true });
  waitingTap = () => {
    window.removeEventListener('pointerdown', go, { capture: true });
    window.removeEventListener('keydown', go, { capture: true });
    waitingTap = null;
  };
}

async function hear(samples: Float32Array) {
  const p = pipeline?.p;
  if (!p || !mic) return;
  const fires = await p.push(samples);
  useWake.setState({ score: p.stats.score });
  if (fires && mic) wake();
}

function wake() {
  useWake.setState({ wakes: useWake.getState().wakes + 1 });
  listenChime(true);
  if (!callOn()) startCall();
}

function stopMic() {
  if (!mic) return;
  mic.node.port.onmessage = null;
  mic.src.disconnect();
  mic.node.disconnect();
  for (const t of mic.stream.getTracks()) t.stop(); // the browser's (and the iPhone's) mic light goes off
  mic = null;
}

/** Stops listening: the mic is released, the models stay loaded for next time. */
export function stopWake() {
  run++;
  waitingTap?.();
  stopMic();
  pipeline?.p.reset();
}
onWakeStop(stopWake);

/** What the probe shows (window.__swarmWake.stats): chunks heard, quiet, scored, wakes, the last score. */
export const wakeStats = () => (pipeline ? { word: pipeline.word, ...pipeline.p.stats } : null);
