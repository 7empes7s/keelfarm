import { describe, expect, it } from 'vitest';
import type { VoiceOption } from './types/voice.ts';
import { agentVoice, clampSpeed, cleanFavourites, groupVoices, isV4Voice, pickVoice, toggleFavourite, voicePool } from './voices.ts';

const v = (id: string, extra: Partial<VoiceOption> = {}): VoiceOption => ({ id, name: id, category: 'premade', labels: { accent: '', gender: '', age: '', description: '', use_case: '' }, previewUrl: null, recommended: false, ...extra });

describe('clampSpeed', () => {
  it('keeps 0.7–1.2 in steps of 0.05, 1 for anything unreadable', () => {
    expect([0.7, 1, 1.2, 0.85].map(clampSpeed)).toEqual([0.7, 1, 1.2, 0.85]);
    expect([0, 5, -1].map(clampSpeed)).toEqual([0.7, 1.2, 0.7]);
    expect(clampSpeed(1.02)).toBe(1);
    expect(clampSpeed(1.03)).toBe(1.05);
    expect(clampSpeed('0.9')).toBe(0.9);
    expect([undefined, null, '', 'x', NaN].map(clampSpeed)).toEqual([1, 1, 1, 1, 1]);
  });
});

describe('favourites', () => {
  it('are ElevenLabs ids, each once, at most 50', () => {
    expect(cleanFavourites(['a', 'a', '../x', '', 7, 'b'])).toEqual(['a', 'b']);
    expect(cleanFavourites('a')).toEqual([]);
    expect(cleanFavourites(Array.from({ length: 80 }, (_, i) => `v${i}`))).toHaveLength(50);
  });

  it('toggle on and off with the ☆', () => {
    expect(toggleFavourite(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleFavourite(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('agentVoice', () => {
  it("takes an id and a name, clears with '', refuses anything else", () => {
    expect(agentVoice({ voiceId: ' abc ', voiceName: ' Abby ' })).toEqual({ voiceId: 'abc', voiceName: 'Abby' });
    expect(agentVoice({ voiceId: '' })).toEqual({ voiceId: '', voiceName: '' });
    expect(agentVoice({ voiceId: 'no spaces' })).toBeNull();
  });
});

describe('groupVoices', () => {
  it('puts favourites first (in starred order), then v4, the shortlist and the rest', () => {
    const list = [v('old'), v('rec', { recommended: true }), v('new', { v4: true }), v('fav1'), v('fav2', { v4: true })];
    const g = groupVoices(list, ['fav2', 'fav1']);
    expect(g.favourites.map((x) => x.id)).toEqual(['fav2', 'fav1']);
    expect(g.latest.map((x) => x.id)).toEqual(['new']);
    expect(g.recommended.map((x) => x.id)).toEqual(['rec']);
    expect(g.others.map((x) => x.id)).toEqual(['old']);
  });

  it("knows a v4 voice by the API's model ids", () => {
    expect(isV4Voice(['eleven_multilingual_v2', 'eleven_v4_turbo'])).toBe(true);
    expect(isV4Voice(['eleven_flash_v2_5'])).toBe(false);
  });
});

describe('a voice for every agent', () => {
  it('draws from favourites, else v4 voices, else the shortlist', () => {
    const list = [v('old'), v('rec', { recommended: true }), v('n1', { v4: true }), v('n2', { v4: true })];
    expect(voicePool(list, ['old', 'gone'])).toEqual(['old']);
    expect(voicePool(list, [])).toEqual(['n1', 'n2']);
    expect(voicePool([v('old'), v('rec', { recommended: true })], [])).toEqual(['rec']);
    expect(voicePool([], [])).toEqual([]);
  });

  it("gives everyone on a floor a distinct voice while there are enough, the same one for the same seed", () => {
    const pool = ['a', 'b', 'c'];
    const used: string[] = [];
    for (const seed of ['x', 'y', 'z']) used.push(pickVoice(pool, used, seed)!);
    expect(new Set(used).size).toBe(3);
    expect(pickVoice(pool, [], 'x')).toBe(pickVoice(pool, [], 'x'));
    expect(pool).toContain(pickVoice(pool, used, 'w')); // all taken: any
    expect(pickVoice([], [], 'x')).toBeNull();
  });

  it('Shuffle never lands on the current voice unless it is the only one', () => {
    for (const seed of ['1', '2', '3', '4', '5']) expect(pickVoice(['a', 'b'], ['b'], seed, 'a')).toBe('b');
    expect(pickVoice(['a'], [], 's', 'a')).toBe('a');
  });
});
