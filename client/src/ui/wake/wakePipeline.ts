// The wake word's detection (#537): openWakeWord's streaming pipeline over 80 ms chunks of 16 kHz audio
// (melspectrogram → speech embedding → the wake word's classifier), with Silero VAD in front so the models only run
// around speech. A quiet room costs a level check per chunk; a sound wakes the VAD; speech replays the last 2 s
// through the models (enough for a whole window of real audio) and scores every chunk until 2 s after it ends. The models are behind WakeModels, so the
// browser (wakeModels.ts on onnxruntime-web) and the tests run the same code.
import { WakeGate } from './wakeWord';

export const WAKE_RATE = 16_000;
/** 80 ms: one embedding and one score per chunk. */
const CHUNK = 1280;
const MEL_CONTEXT = 480; // the melspectrogram needs 3 frames of the audio before the chunk
const MEL_WINDOW = 76; // mel frames per embedding
const MEL_BINS = 32;
const EMB = 96;
const WINDOW = 16; // embeddings per score (1.28 s)
const VAD_FRAME = 512;
/** Chunks kept for the replay when speech starts, and scored after it ends. */
const HOLD = 25;
/** Below this level (RMS, -1..1) a chunk is quiet and the VAD isn't asked (about -50 dBFS). */
const QUIET_RMS = 0.003;
const SPEECH = 0.5;

export interface WakeModels {
  /** Raw audio at int16 scale → mel frames (n x 32, openWakeWord's melspectrogram.onnx output). */
  mel(audio: Float32Array): Promise<Float32Array>;
  /** 76 x 32 mel frames → one 96-wide embedding. */
  embed(mel: Float32Array): Promise<Float32Array>;
  /** 16 x 96 embeddings → the wake word's score, 0..1. */
  score(window: Float32Array): Promise<number>;
  /** 512 samples (-1..1) → the chance it's speech; it keeps its own state. */
  vad(frame: Float32Array): Promise<number>;
  resetVad(): void;
}

export interface WakeStats {
  chunks: number;
  /** Chunks too quiet to ask the VAD. */
  quiet: number;
  /** Chunks that ran the wake word's models. */
  scored: number;
  fires: number;
  /** The last score, for the settings' meter. */
  score: number;
}

const rms = (x: Float32Array) => {
  let s = 0;
  for (const v of x) s += v * v;
  return Math.sqrt(s / Math.max(1, x.length));
};

export class WakePipeline {
  readonly stats: WakeStats = { chunks: 0, quiet: 0, scored: 0, fires: 0, score: 0 };
  private readonly gate: WakeGate;
  private pending = new Float32Array(0);
  private backlog: Float32Array[] = [];
  private hold = 0; // chunks left to score after the last speech
  private vadCarry = new Float32Array(0);
  private tail = new Float32Array(MEL_CONTEXT);
  private mel: Float32Array[] = [];
  private emb: Float32Array[] = [];
  private busy: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly models: WakeModels,
    threshold: number,
    private readonly opts: { vad?: boolean } = {},
  ) {
    this.gate = new WakeGate(threshold);
  }

  set threshold(t: number) {
    this.gate.threshold = t;
  }

  /** Feeds 16 kHz samples (-1..1, any length); resolves to how many wakes they held. Calls are run in order. */
  push(samples: Float32Array): Promise<number> {
    const run = this.busy.then(() => this.take(samples));
    this.busy = run.catch(() => undefined);
    return run;
  }

  /** Back to listening from scratch (after a call, or the tab coming back). */
  reset() {
    this.pending = new Float32Array(0);
    this.backlog = [];
    this.hold = 0;
    this.vadCarry = new Float32Array(0);
    this.restartFeatures();
    this.gate.reset();
    this.models.resetVad();
  }

  private async take(samples: Float32Array): Promise<number> {
    const all = new Float32Array(this.pending.length + samples.length);
    all.set(this.pending);
    all.set(samples, this.pending.length);
    let fires = 0;
    let at = 0;
    for (; at + CHUNK <= all.length; at += CHUNK) if (await this.chunk(all.slice(at, at + CHUNK))) fires++;
    this.pending = all.slice(at);
    return fires;
  }

  private async chunk(chunk: Float32Array): Promise<boolean> {
    this.stats.chunks++;
    const wasActive = this.hold > 0;
    if (this.opts.vad === false) this.hold = HOLD;
    else if (rms(chunk) < QUIET_RMS) {
      this.stats.quiet++;
      this.vadCarry = new Float32Array(0);
    } else if ((await this.speech(chunk)) >= SPEECH) this.hold = HOLD;
    if (this.hold === 0) {
      this.remember(chunk);
      return false;
    }
    if (!wasActive) {
      // speech just started: its beginning is in the last 2 s
      this.restartFeatures();
      for (const old of this.backlog) await this.features(old);
      this.backlog = [];
    }
    this.hold--;
    const score = await this.features(chunk);
    this.remember(chunk);
    if (score === null) return false;
    this.stats.scored++;
    this.stats.score = score;
    const fired = this.gate.push(score);
    if (fired) this.stats.fires++;
    return fired;
  }

  private remember(chunk: Float32Array) {
    this.backlog.push(chunk);
    if (this.backlog.length > HOLD) this.backlog.shift();
  }

  /** The VAD's highest speech chance over the chunk's 512-sample frames. */
  private async speech(chunk: Float32Array): Promise<number> {
    const buf = new Float32Array(this.vadCarry.length + chunk.length);
    buf.set(this.vadCarry);
    buf.set(chunk, this.vadCarry.length);
    let best = 0;
    let at = 0;
    for (; at + VAD_FRAME <= buf.length; at += VAD_FRAME) best = Math.max(best, await this.models.vad(buf.slice(at, at + VAD_FRAME)));
    this.vadCarry = buf.slice(at);
    return best;
  }

  private restartFeatures() {
    // Empty, not openWakeWord's ones: a score only ever sees real audio, as in training. The 2 s replay fills it.
    this.tail = new Float32Array(MEL_CONTEXT);
    this.mel = [];
    this.emb = [];
  }

  /** One chunk through the features; its score once there are 16 embeddings, else null. */
  private async features(chunk: Float32Array): Promise<number | null> {
    const input = new Float32Array(MEL_CONTEXT + CHUNK);
    input.set(this.tail);
    for (let i = 0; i < CHUNK; i++) input[MEL_CONTEXT + i] = chunk[i] * 32767;
    this.tail = input.slice(CHUNK);
    const frames = await this.models.mel(input);
    for (let f = 0; f + MEL_BINS <= frames.length; f += MEL_BINS) {
      const row = frames.slice(f, f + MEL_BINS);
      for (let i = 0; i < MEL_BINS; i++) row[i] = row[i] / 10 + 2; // openWakeWord's scaling for the embedding model
      this.mel.push(row);
    }
    if (this.mel.length > MEL_WINDOW) this.mel.splice(0, this.mel.length - MEL_WINDOW);
    if (this.mel.length < MEL_WINDOW) return null;
    const window = new Float32Array(MEL_WINDOW * MEL_BINS);
    this.mel.forEach((row, i) => window.set(row, i * MEL_BINS));
    this.emb.push(await this.models.embed(window));
    if (this.emb.length > WINDOW) this.emb.shift();
    if (this.emb.length < WINDOW) return null;
    const feats = new Float32Array(WINDOW * EMB);
    this.emb.forEach((e, i) => feats.set(e, i * EMB));
    return this.models.score(feats);
  }
}
