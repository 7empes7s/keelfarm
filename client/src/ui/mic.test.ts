// The 🎙's listening session with the fake recognition (window.__swarmMic): a phone browser that stops recognising
// by itself mid-sentence doesn't cut the message in two.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Mic from './mic';

type Probe = { fake(on?: boolean): void; say(text: string, final?: boolean): boolean; browserStops(error?: string): boolean; readonly state: string; history: { outcome: string | null }[] };

let mic: typeof Mic;
let probe: Probe;
let sent: string[];
let box: string;
let unregister: () => void;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'queueMicrotask'] });
  vi.stubGlobal('window', { addEventListener() {} });
  vi.stubGlobal('document', { addEventListener() {}, visibilityState: 'visible' });
  vi.stubGlobal('navigator', { language: 'en-US' });
  const { useStore } = await import('../store');
  const st = useStore.getState();
  useStore.setState({ settings: { ...st.settings, listen: { provider: 'browser', autoSend: true, handsFree: false } } });
  mic = await import('./mic');
  probe = (window as unknown as { __swarmMic: Probe }).__swarmMic;
  probe.fake(true);
});

afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  unregister?.();
  sent = [];
  box = '';
  unregister = mic.registerTarget({ id: 'box', kind: 'phone', form: () => null, text: () => box, setText: (t) => void (box = t), send: (t) => void sent.push(t), disabled: () => false });
});

/** Taps the 🎙 and waits for the (fake) mic to come on. */
function tap() {
  mic.listen('box', 'tap');
  vi.advanceTimersByTime(50);
  expect(probe.state).toBe('listening');
}

describe('the browser stopping by itself', () => {
  it('listens on and sends one message with both parts, no word twice', () => {
    tap();
    probe.say('Clicking on the settings', false);
    probe.say('Clicking on the settings', true);
    vi.advanceTimersByTime(1000);
    expect(probe.browserStops()).toBe(true); // a phone's recognition gives up after a short quiet
    vi.advanceTimersByTime(100); // it ends, and a new one starts
    expect(probe.state).toBe('listening');
    expect(sent).toEqual([]);
    probe.say('button breaks the page');
    vi.advanceTimersByTime(2500);
    expect(sent).toEqual([]); // 2.5 s of quiet: still listening
    vi.advanceTimersByTime(700);
    expect(sent).toEqual(['Clicking on the settings button breaks the page']);
    expect(probe.state).toBe('idle');
  });

  it("waits longer on a filler, and doesn't send it", () => {
    tap();
    probe.say('It breaks the page, uh');
    vi.advanceTimersByTime(5000);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(4100);
    expect(sent).toEqual(['It breaks the page']);
  });

  it('an error ends it cleanly, with nothing sent', () => {
    tap();
    probe.say('Clicking on the');
    probe.browserStops('not-allowed');
    vi.advanceTimersByTime(100);
    expect(sent).toEqual([]);
    expect(probe.history.at(-1)?.outcome).toBe('error');
    expect(probe.browserStops()).toBe(false); // nothing started again
    vi.advanceTimersByTime(3000); // the error state clears
  });

  it('starts again a limited number of times, then sends what it heard', () => {
    tap();
    probe.say('Ship it');
    for (let i = 0; i < mic.MAX_RESTARTS; i++) {
      probe.browserStops();
      vi.advanceTimersByTime(60);
      expect(probe.state).toBe('listening');
    }
    probe.browserStops();
    vi.advanceTimersByTime(60);
    expect(probe.state).toBe('idle');
    expect(sent).toEqual(['Ship it']);
  });
});
