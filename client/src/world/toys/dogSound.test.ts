import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOG_EVENT } from './dogBrain';
import { CLIP_WAIT, DOG_CLIPS, clipRate, clipUrl, createClipBank, voiceOf, type DogVoice } from './dogSound';

const root = path.resolve(__dirname, '../../../..');
const dir = path.join(root, 'client', 'public', 'sounds', 'dog');
const notices = readFileSync(path.join(root, 'docs', 'third-party-sounds.md'), 'utf8');
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("the dog's recorded voice", () => {
  it('ships every clip as .ogg and .mp3, small, each with a CC0 / public-domain row in the notices', () => {
    const files = readdirSync(dir);
    const names = Object.values(DOG_CLIPS).flat();
    expect(files.sort()).toEqual(names.flatMap((n) => [`${n}.mp3`, `${n}.ogg`]).sort());
    for (const n of names) {
      const row = notices.split('\n').find((l) => l.includes(`\`sounds/dog/${n}\``));
      expect(row, n).toMatch(/\|\s*(CC0|Public domain)\s*\|/i);
      expect(row, n).toMatch(/https:\/\//);
    }
    const total = files.reduce((s, f) => s + statSync(path.join(dir, f)).size, 0);
    expect(total).toBeLessThan(100_000);
  });

  it('maps each event to a voice with a clip, the bark first', () => {
    expect(voiceOf(DOG_EVENT.woof, DOG_EVENT)).toBe('woof');
    expect(voiceOf(DOG_EVENT.bark | DOG_EVENT.woof, DOG_EVENT)).toBe('bark');
    expect(voiceOf(DOG_EVENT.yip | DOG_EVENT.woof, DOG_EVENT)).toBe('yip');
    expect(voiceOf(DOG_EVENT.sniff, DOG_EVENT)).toBeNull();
    for (const k of ['woof', 'bark', 'yip'] as DogVoice[]) expect(DOG_CLIPS[k].length).toBeGreaterThan(0);
    expect(clipUrl('yip', true)).toBe('/sounds/dog/yip.ogg');
    expect(clipUrl('yip', false, '/x/')).toBe('/x/sounds/dog/yip.mp3');
    expect(clipRate(0)).toBeCloseTo(0.95);
    expect(clipRate(0.999)).toBeLessThanOrEqual(1.05);
  });

  it('loads on the first voice, waits briefly, then plays a random clip of that voice', async () => {
    const loaded: string[] = [];
    const bank = createClipBank(async (n) => (loaded.push(n), `buf:${n}`));
    expect(loaded).toEqual([]);
    expect(bank.voice('woof', 0, 0, 0.5)).toBe('wait');
    await flush();
    expect(loaded.sort()).toEqual(Object.values(DOG_CLIPS).flat().sort());
    expect(bank.voice('woof', 0, 0.1, 0)).toBe('buf:woof-1');
    expect(bank.voice('woof', 0, 0.1, 0.99)).toBe('buf:woof-3');
    expect(bank.voice('bark', 0, 0.1, 0.6)).toBe('buf:bark-2');
    expect(bank.voice('yip', 0, 0.1, 0.3)).toBe('buf:yip');
    expect(loaded).toHaveLength(6); // loaded once
  });

  it('falls back to the synthesized voice when a clip fails to load, or loading is slow', async () => {
    const bank = createClipBank(async (n) => {
      if (n === 'bark-2') throw new Error('404');
      return n;
    });
    expect(bank.voice('bark', 0, 0, 0)).toBe('wait');
    await flush();
    expect(bank.state).toBe('failed');
    expect(bank.voice('bark', 1, 1, 0)).toBe('synth');
    expect(bank.voice('woof', 2, 2, 0)).toBe('synth');

    const slow = createClipBank(() => new Promise<string>(() => undefined));
    expect(slow.voice('woof', 0, 0, 0)).toBe('wait');
    expect(slow.voice('woof', 0, CLIP_WAIT + 0.01, 0)).toBe('synth');
  });
});
