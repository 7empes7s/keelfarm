import { beforeAll, describe, expect, it, vi } from 'vitest';
import { defaultBindings } from './keymap';
import { parseAudioPrefs } from './audioPrefs';
import { parseA11yPrefs } from './a11yPrefs';
import type * as QuickToggles from './quickToggleRules';
import type * as Sfx from './sfx';
import type { KeyPress } from './quickToggleRules';

// sfx.ts and a11y.ts touch the page when they load: a stand-in window, page and storage.
const stored = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v), removeItem: (k: string) => void stored.delete(k) });
vi.stubGlobal('window', { addEventListener: () => undefined });
vi.stubGlobal('document', { documentElement: { setAttribute: () => undefined, removeAttribute: () => undefined, style: { setProperty: () => undefined, removeProperty: () => undefined } } });

let q: typeof QuickToggles;
let sfx: typeof Sfx;
beforeAll(async () => {
  q = await import('./quickToggleRules');
  sfx = await import('./sfx');
});

const press = (code: string, more: Partial<KeyPress> = {}) => ({ code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, ...more });

describe('the Sound button', () => {
  it('mutes and unmutes keeping the volume and every level', () => {
    sfx.setAudioPrefs({ volume: 35, typing: 40 });
    expect(q.flip('mute', 'M')).toBe('Sound off (M to turn it back on)');
    expect(sfx.getAudioPrefs()).toMatchObject({ muted: true, volume: 35, typing: 40 });
    expect(parseAudioPrefs(stored.get('cubefarm:audio') ?? null)).toMatchObject({ muted: true, volume: 35, typing: 40 });
    expect(q.flip('mute', 'M')).toBe('Sound on');
    expect(sfx.getAudioPrefs()).toMatchObject({ muted: false, volume: 35, typing: 40 });
  });

  it("says nothing when the sound already was that way", () => {
    expect(q.setMuted(false, 'M')).toBeNull();
    expect(q.setMuted(true, 'M')).not.toBeNull();
    expect(q.setMuted(true, 'M')).toBeNull();
    q.setMuted(false, 'M');
  });
});

describe('the CC button', () => {
  it('turns captions on and off, saved in this browser', () => {
    expect(q.flip('captions', 'M')).toBe('Captions on');
    expect(parseA11yPrefs(stored.get('cubefarm:a11y') ?? null).captions).toBe(true);
    expect(q.setCaptions(true)).toBeNull();
    expect(q.flip('captions', 'M')).toBe('Captions off');
    expect(parseA11yPrefs(stored.get('cubefarm:a11y') ?? null).captions).toBe(false);
  });
});

describe('their keys', () => {
  const b = defaultBindings();

  it('are M and C, as rebound', () => {
    expect(q.quickKey(b, press('KeyM'), false, false)).toBe('mute');
    expect(q.quickKey(b, press('KeyC'), false, false)).toBe('captions');
    expect(q.quickKey(b, press('KeyX'), false, false)).toBeNull();
    expect(q.quickKey({ ...b, captions: ['KeyJ'] }, press('KeyJ'), false, false)).toBe('captions');
    expect(q.quickKey({ ...b, captions: ['KeyJ'] }, press('KeyC'), false, false)).toBeNull();
  });

  it("don't fire while typing, with a modifier or on auto-repeat", () => {
    expect(q.quickKey(b, press('KeyM'), true, false)).toBeNull();
    expect(q.quickKey(b, press('KeyC'), true, false)).toBeNull();
    expect(q.quickKey(b, press('KeyC', { ctrlKey: true }), false, false)).toBeNull();
    expect(q.quickKey(b, press('KeyM', { metaKey: true }), false, false)).toBeNull();
    expect(q.quickKey(b, press('KeyM', { repeat: true }), false, false)).toBeNull();
  });

  it('leave C to the photo camera, but M still mutes there', () => {
    expect(q.quickKey(b, press('KeyC'), false, true)).toBeNull();
    expect(q.quickKey(b, press('KeyM'), false, true)).toBe('mute');
  });
});
