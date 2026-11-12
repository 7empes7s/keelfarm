// The wake word's detection end to end on the real models (client/public/wake/, onnxruntime-web's WASM build in
// Node): synthetic voices (Piper TTS clips of other speakers than the training's, made by
// scripts/wakeword/train_hey_mimoun.py, in fixtures/) and sounds made here. Also the CPU check: listening to an idle
// room has to stay well under 5% of a core.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as ort from 'onnxruntime-web';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadWakeModels } from './wakeModels';
import { WAKE_RATE, WakePipeline, type WakeModels } from './wakePipeline';
import { DEFAULT_WAKE, wakeThreshold, wakeWord } from './wakeWord';

const MODELS = path.join('client', 'public', 'wake');
const FIXTURES = path.join('client', 'src', 'ui', 'wake', 'fixtures');
const threshold = wakeThreshold(DEFAULT_WAKE.sensitivity);

function wav(name: string): Float32Array {
  const buf = readFileSync(path.join(FIXTURES, `${name}.wav`));
  const pcm = new Int16Array(buf.buffer, buf.byteOffset + 44, (buf.length - 44) >> 1);
  return Float32Array.from(pcm, (v) => v / 32768);
}

const join = (...parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) out.set(p, (at += p.length) - p.length);
  return out;
};
const silence = (s: number) => new Float32Array(Math.round(s * WAKE_RATE));

/** A seeded room: steady noise at `level` RMS, a little hum, nobody talking. */
function room(seconds: number, level: number, seed = 1): Float32Array {
  let x = seed;
  const rand = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
  const out = new Float32Array(Math.round(seconds * WAKE_RATE));
  for (let i = 0; i < out.length; i++) out[i] = level * (rand() * 1.2 + 0.5 * Math.sin((2 * Math.PI * 100 * i) / WAKE_RATE));
  return out;
}

/** Feeds audio the way the browser does (blocks of ~43 ms) and counts the wakes. */
async function wakes(models: WakeModels, audio: Float32Array) {
  const p = new WakePipeline(models, threshold);
  let n = 0;
  for (let i = 0; i < audio.length; i += 683) n += await p.push(audio.subarray(i, i + 683));
  return { n, stats: p.stats };
}

let mimoun: WakeModels;
let jarvis: WakeModels;

beforeAll(async () => {
  ort.env.wasm.numThreads = 1;
  const load = async (file: string) => readFileSync(path.join(MODELS, file));
  mimoun = await loadWakeModels(ort, load, wakeWord('hey-mimoun').model);
  jarvis = await loadWakeModels(ort, load, wakeWord('hey-jarvis').model);
}, 60_000);

describe('the wake word pipeline', () => {
  it('wakes once on "Hey Mimoun" in voices it never trained on', async () => {
    for (const clip of ['hey-mimoun-lessac', 'hey-mimoun-alan']) expect((await wakes(mimoun, wav(clip))).n, clip).toBe(1);
  });

  it("doesn't wake on near-misses, the other wake word or ordinary talk", async () => {
    for (const clip of ['hey-simon-lessac', 'hey-moon-alan', 'hey-jarvis-lessac', 'sentence-lessac']) expect((await wakes(mimoun, wav(clip))).n, clip).toBe(0);
  });

  it('runs the stock "Hey Jarvis" model too, which ignores "Hey Mimoun"', async () => {
    expect((await wakes(jarvis, wav('hey-jarvis-lessac'))).n).toBe(1);
    expect((await wakes(jarvis, wav('hey-mimoun-lessac'))).n).toBe(0);
  });

  it('wakes once per phrase: twice when said twice', async () => {
    const phrase = wav('hey-mimoun-lessac');
    expect((await wakes(mimoun, join(phrase, silence(1), phrase))).n).toBe(2);
  });

  it('hears it over a noisy room', async () => {
    const phrase = wav('hey-mimoun-alan');
    const noise = room(phrase.length / WAKE_RATE, 0.01, 7);
    expect((await wakes(mimoun, phrase.map((v, i) => v + noise[i]))).n).toBe(1);
  });

  it('runs no model at all in a quiet room', async () => {
    const { n, stats } = await wakes(mimoun, room(10, 0.0005));
    expect(n).toBe(0);
    expect(stats.scored).toBe(0);
    expect(stats.quiet).toBe(stats.chunks);
  });

  it('stays under 5% of a core listening to an idle room (quiet, and with a fan on)', async () => {
    const seconds = 30;
    for (const [what, level] of [
      ['quiet', 0.0005],
      ['fan on', 0.02],
    ] as const) {
      const audio = room(seconds, level, 3);
      const t = performance.now();
      const { n } = await wakes(mimoun, audio);
      const cpu = (performance.now() - t) / 1000 / seconds;
      console.log(`wake word, idle room (${what}): ${(cpu * 100).toFixed(2)}% of a core`);
      expect(n).toBe(0);
      expect(cpu).toBeLessThan(0.05);
    }
  }, 60_000);
});
