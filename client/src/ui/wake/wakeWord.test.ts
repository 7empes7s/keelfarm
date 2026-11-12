import { describe, expect, it } from 'vitest';
import { batterySaver, DEFAULT_WAKE, parseWakePrefs, REFRACTORY_FRAMES, WakeGate, wakePause, wakeThreshold } from './wakeWord';

const listening = { on: true, inCall: false, hidden: false, batterySaver: false, micRefused: false };

describe('wake word prefs', () => {
  it('is off by default, and keeps what was saved', () => {
    expect(parseWakePrefs(null)).toEqual(DEFAULT_WAKE);
    expect(DEFAULT_WAKE.on).toBe(false);
    expect(parseWakePrefs('{"on":true,"word":"hey-jarvis","sensitivity":0.8}')).toEqual({ on: true, word: 'hey-jarvis', sensitivity: 0.8 });
  });

  it('reads nonsense as the defaults', () => {
    expect(parseWakePrefs('not json')).toEqual(DEFAULT_WAKE);
    expect(parseWakePrefs('{"on":"yes","word":"hey-alexa","sensitivity":7}')).toEqual({ ...DEFAULT_WAKE, sensitivity: 1 });
  });

  it('wakes more easily as the sensitivity goes up', () => {
    expect(wakeThreshold(0)).toBeCloseTo(0.8);
    expect(wakeThreshold(0.5)).toBeCloseTo(0.5);
    expect(wakeThreshold(1)).toBeCloseTo(0.2);
  });
});

describe('when it listens', () => {
  it('listens when on, with no call, on screen and not on low battery', () => {
    expect(wakePause(listening)).toBe('');
  });

  it('pauses during a call, in a hidden tab and on battery saver', () => {
    expect(wakePause({ ...listening, inCall: true })).toBe('call');
    expect(wakePause({ ...listening, hidden: true })).toBe('hidden');
    expect(wakePause({ ...listening, batterySaver: true })).toBe('battery');
    expect(wakePause({ ...listening, on: false, inCall: true })).toBe('off');
    expect(wakePause({ ...listening, micRefused: true })).toBe('no-mic');
  });

  it('counts unplugged at 20% or less as battery saver', () => {
    expect(batterySaver({ charging: false, level: 0.15 })).toBe(true);
    expect(batterySaver({ charging: true, level: 0.15 })).toBe(false);
    expect(batterySaver({ charging: false, level: 0.6 })).toBe(false);
    expect(batterySaver(null)).toBe(false);
  });
});

describe('WakeGate', () => {
  const run = (gate: WakeGate, scores: number[]) => scores.filter((s) => gate.push(s)).length;

  it('wakes once per phrase however many frames score high', () => {
    expect(run(new WakeGate(0.5), [0, 0.1, 0.7, 0.99, 0.98, 0.95, 0.6, 0.2, 0])).toBe(1);
  });

  it('never wakes under the threshold', () => {
    expect(run(new WakeGate(0.5), [0.3, 0.49, 0.45, 0.1])).toBe(0);
  });

  it('wakes again for a second phrase, 2 s later and after the score dropped', () => {
    const gate = new WakeGate(0.5);
    const phrase = [0.9, 0.95, 0.9];
    const gap = (n: number) => Array(n).fill(0);
    expect(run(gate, [...phrase, ...gap(5), ...phrase])).toBe(1); // too soon: the same phrase
    expect(run(gate, [...gap(REFRACTORY_FRAMES), ...phrase])).toBe(1);
  });

  it("doesn't re-arm while the score stays high", () => {
    expect(run(new WakeGate(0.5), Array(REFRACTORY_FRAMES * 3).fill(0.9))).toBe(1);
  });
});
