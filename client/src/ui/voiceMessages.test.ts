import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PhoneMessage, VoiceLine } from '../../../shared/types';
import { replyEnded } from './mic';
import type * as VoiceMessages from './voiceMessages';

const mocks = vi.hoisted(() => ({
  state: {
    settings: { voice: { provider: 'browser', voiceName: '', speed: 1, talk: 'regular' } },
    voiceKeySet: true,
    voiceSpeaking: null as number | null,
    pushToast: vi.fn(),
  },
  mic: { state: 'idle' },
}));
vi.mock('../store', () => ({ useStore: { getState: () => mocks.state, setState: (s: object) => Object.assign(mocks.state, s) } }));
vi.mock('./mic', () => ({ useMic: { getState: () => mocks.mic }, replyEnded: vi.fn() }));
vi.mock('./music', () => ({ holdMusicDuck: () => () => undefined }));
vi.mock('./captions', () => ({ speechClip: vi.fn(), speechEnded: vi.fn(), speechStarted: vi.fn(), speechWord: vi.fn() }));
vi.mock('./sfx', () => ({
  audio: vi.fn(), chirp: vi.fn(), duckOthers: vi.fn(), groupOutput: vi.fn(), subscribeAudio: () => () => undefined,
  getAudioPrefs: () => ({ muted: false, volume: 1, voice: 1 }),
}));
vi.mock('./voiceCallStore', () => ({
  callOn: () => false, callVoice: (v: unknown) => v, dispatchCall: vi.fn(), useCall: { getState: () => ({ managerSpeaking: false }) },
}));
vi.mock('./voiceClaim', () => ({ wonVoice: () => true }));
vi.mock('./voiceTap', () => ({ elementPrimed: () => false, voiceElement: () => null, useReplay: { getState: () => ({ loading: null }), setState: vi.fn() } }));

interface Utterance {
  text: string;
  onstart?: () => void;
  onend?: () => void;
}
let player: typeof VoiceMessages;
let leadMs: number;
let durationMs: number;
let starts: string[];
let timer: ReturnType<typeof setTimeout> | undefined;

const message = (id: number, text: string): PhoneMessage => ({ id, text, from: 'ceo', at: Date.now() });
const line = (kind: VoiceLine['kind'] = 'ack'): VoiceLine => ({ id: 100, kind, text: 'Heard you, one moment.', at: Date.now() });

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  mocks.state.voiceSpeaking = null;
  mocks.state.settings.voice.provider = 'browser';
  mocks.mic.state = 'idle';
  vi.mocked(replyEnded).mockClear();
  leadMs = 0;
  durationMs = 1000;
  starts = [];
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
  vi.stubGlobal('window', {
    speechSynthesis: {
      getVoices: () => [{ name: 'Default' }],
      speak: (u: Utterance) => {
        timer = setTimeout(() => {
          starts.push(u.text);
          u.onstart?.();
          timer = setTimeout(() => u.onend?.(), durationMs);
        }, leadMs);
      },
      cancel: () => clearTimeout(timer),
    },
  });
  player = await import('./voiceMessages');
});

afterEach(() => {
  player.stopSpeaking();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('finishes an ack even when a reply arrives before synthesis starts', async () => {
  leadMs = 2000;
  player.speakLine(line(), Date.now(), 0);
  await vi.advanceTimersByTimeAsync(1500);
  player.speakMessage(message(1, 'I will check the footer.'), Date.now(), 0);
  await vi.advanceTimersByTimeAsync(1499);
  expect(starts).toEqual(['Heard you, one moment.']); // the reply waits through the ack's playback
  await vi.advanceTimersByTimeAsync(3001);
  expect(starts).toEqual(['Heard you, one moment.', 'I will check the footer.']);
});

it("says an ack whose claim wait ran late on a busy page, within the ack's longer life", async () => {
  player.speakLine(line(), Date.now() - 9000, 0); // the timer fired 9 s after the ack arrived (seen in the lab)
  await vi.advanceTimersByTimeAsync(2000);
  expect(starts).toEqual(['Heard you, one moment.']);
  player.speakLine({ ...line('progress'), id: 101 }, Date.now() - 9000, 0); // a progress line that old is stale
  await vi.advanceTimersByTimeAsync(2000);
  expect(starts).toEqual(['Heard you, one moment.']);
});

it('keeps an ack during existing speech and says it before a queued reply', async () => {
  durationMs = 3000;
  player.speakMessage(message(1, 'I am checking the tests.'), Date.now(), 0);
  await vi.advanceTimersByTimeAsync(500);
  player.speakLine(line(), Date.now(), 0);
  await vi.advanceTimersByTimeAsync(1000);
  player.speakMessage(message(2, 'I will check the footer.'), Date.now(), 0);
  await vi.advanceTimersByTimeAsync(8000);
  expect(starts).toEqual(['I am checking the tests.', 'Heard you, one moment.', 'I will check the footer.']);
});

it('still lets a reply cut a progress line short', async () => {
  leadMs = 2000;
  player.speakLine(line('progress'), Date.now(), 0);
  await vi.advanceTimersByTimeAsync(500);
  player.speakMessage(message(1, 'Here is what I found.'), Date.now(), 0);
  await vi.advanceTimersByTimeAsync(4000);
  expect(starts).toEqual(['Here is what I found.']);
});

it('drops a waiting ack on barge-in', async () => {
  durationMs = 3000;
  player.speakMessage(message(1, 'I am checking the tests.'), Date.now(), 0);
  await vi.advanceTimersByTimeAsync(500);
  player.speakLine(line(), Date.now(), 0);
  await vi.advanceTimersByTimeAsync(100);
  player.stopSpeaking();
  await vi.advanceTimersByTimeAsync(5000);
  expect(starts).toEqual(['I am checking the tests.']);
});

it('rechecks the mic before saying a queued ack', async () => {
  durationMs = 3000;
  player.speakMessage(message(1, 'I am checking the tests.'), Date.now(), 0);
  await vi.advanceTimersByTimeAsync(500);
  player.speakLine(line(), Date.now(), 0);
  await vi.advanceTimersByTimeAsync(500);
  mocks.mic.state = 'listening';
  await vi.advanceTimersByTimeAsync(4000);
  expect(starts).toEqual(['I am checking the tests.']);
});

it('expires an ack rather than saying it after a long reply', async () => {
  durationMs = 30_000;
  player.speakMessage(message(1, 'I am checking the tests.'), Date.now(), 0);
  await vi.advanceTimersByTimeAsync(500);
  player.speakLine(line(), Date.now(), 0);
  await vi.advanceTimersByTimeAsync(31_000);
  expect(starts).toEqual(['I am checking the tests.']);
});

it('does not delay a reply behind a cancelled progress clip download', async () => {
  mocks.state.settings.voice.provider = 'elevenlabs';
  let deliver: (response: Response) => void = () => undefined;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => (deliver = resolve))));
  player.speakLine(line('progress'), Date.now(), 0);
  await vi.advanceTimersByTimeAsync(500);
  mocks.state.settings.voice.provider = 'browser';
  player.speakMessage(message(1, 'Here is what I found.'), Date.now(), 0);
  await vi.advanceTimersByTimeAsync(100);
  expect(starts).toEqual(['Here is what I found.']);
  deliver(new Response(new Uint8Array([1, 2])));
  await vi.advanceTimersByTimeAsync(2000);
  expect(starts).toEqual(['Here is what I found.']);
});

it('does not start cancelled progress when browser voices finish loading', async () => {
  const synth = window.speechSynthesis;
  const voices = vi.spyOn(synth, 'getVoices').mockReturnValue([]);
  Object.assign(synth, { addEventListener: vi.fn() });
  player.speakLine(line('progress'), Date.now(), 0);
  await vi.advanceTimersByTimeAsync(500);
  voices.mockReturnValue([{ name: 'Default' } as SpeechSynthesisVoice]);
  player.speakMessage(message(1, 'Here is what I found.'), Date.now(), 0);
  await vi.advanceTimersByTimeAsync(2000);
  expect(starts).toEqual(['Here is what I found.']);
});

it('says an ack waiting behind a slow progress line before the reply that cuts it', async () => {
  leadMs = 2000;
  player.speakLine({ ...line('progress'), text: 'Reading the tests.' }, Date.now(), 0);
  await vi.advanceTimersByTimeAsync(500);
  player.speakLine({ ...line(), id: 101 }, Date.now(), 0);
  player.speakMessage(message(1, 'Here is what I found.'), Date.now(), 0);
  await vi.advanceTimersByTimeAsync(8000);
  expect(starts).toEqual(['Heard you, one moment.', 'Here is what I found.']);
});

it("downloads a waiting ack's clip while the reply ahead of it is still being read", async () => {
  durationMs = 3000;
  const fetch = vi.fn(() => new Promise<Response>(() => undefined));
  vi.stubGlobal('fetch', fetch);
  player.speakMessage(message(1, 'I am checking the tests.'), Date.now(), 0);
  await vi.advanceTimersByTimeAsync(500);
  mocks.state.settings.voice.provider = 'elevenlabs';
  player.speakLine(line(), Date.now(), 0);
  await vi.advanceTimersByTimeAsync(100);
  expect(fetch).toHaveBeenCalledWith('/api/voice/talk/100');
  await vi.advanceTimersByTimeAsync(4000);
  expect(fetch).toHaveBeenCalledTimes(1); // its turn uses the same download
});

it("opens hands-free's mic once, after an ack queued behind the last reply has been said", async () => {
  durationMs = 3000;
  player.speakMessage(message(1, 'I am checking the tests.'), Date.now(), 0);
  await vi.advanceTimersByTimeAsync(500);
  player.speakLine(line(), Date.now(), 0);
  await vi.advanceTimersByTimeAsync(4000); // the reply ended, the ack is being said
  expect(starts).toEqual(['I am checking the tests.', 'Heard you, one moment.']);
  expect(replyEnded).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(3000);
  expect(replyEnded).toHaveBeenCalledTimes(1);
});

it("doesn't open hands-free's mic after barge-in stops the ack behind the last reply", async () => {
  durationMs = 3000;
  player.speakMessage(message(1, 'I am checking the tests.'), Date.now(), 0);
  await vi.advanceTimersByTimeAsync(500);
  player.speakLine(line(), Date.now(), 0);
  await vi.advanceTimersByTimeAsync(4000);
  player.stopLine();
  await vi.advanceTimersByTimeAsync(5000);
  expect(replyEnded).not.toHaveBeenCalled();
});

it("opens hands-free's mic once when the ack behind the last reply expires unsaid", async () => {
  durationMs = 30_000;
  player.speakMessage(message(1, 'I am checking the tests.'), Date.now(), 0);
  await vi.advanceTimersByTimeAsync(500);
  player.speakLine(line(), Date.now(), 0);
  await vi.advanceTimersByTimeAsync(31_000);
  expect(starts).toEqual(['I am checking the tests.']);
  expect(replyEnded).toHaveBeenCalledTimes(1);
});
