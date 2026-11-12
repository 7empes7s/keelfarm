import { beforeEach, expect, it, vi } from 'vitest';

// Settings → Voice's Test with ElevenLabs (#545): the tap unlocks the <audio> element before the line is fetched (iOS
// plays only from inside a tap), the line then plays on that same element, and failures come back in plain words.

const mocks = vi.hoisted(() => ({
  sample: vi.fn<(voiceId: string) => Promise<Blob>>(),
  unlockAudio: vi.fn(),
}));
vi.mock('../api', () => ({ api: { voiceSample: mocks.sample } }));
vi.mock('../store', () => ({ useStore: { getState: () => ({ settings: { voice: { provider: 'elevenlabs' } } }) } }));
vi.mock('./music', () => ({ holdMusicDuck: () => () => undefined }));
vi.mock('./sfx', () => ({ audioUnlocked: () => false, getAudioPrefs: () => ({}), subscribeAudio: () => () => undefined, unlockAudio: mocks.unlockAudio }));
vi.mock('./voicePicker', () => ({ playbackVolume: () => 1 }));

/** A fake <audio>: every play() is recorded with the source it played; `refuse` makes the browser block it. */
class FakeAudio {
  static made: FakeAudio[] = [];
  static refuse = false;
  plays: string[] = [];
  src = '';
  volume = 1;
  paused = true;
  preload = '';
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeAudio.made.push(this);
  }
  setAttribute() {}
  pause() {
    this.paused = true;
  }
  play() {
    this.plays.push(this.src.startsWith('data:') ? 'silence' : 'clip');
    if (FakeAudio.refuse && !this.src.startsWith('data:')) return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
    this.paused = false;
    if (!this.src.startsWith('data:')) setTimeout(() => this.onended?.(), 0);
    return Promise.resolve();
  }
}

let testElevenLabs: (voiceId: string) => Promise<string | null>;

beforeEach(async () => {
  vi.resetModules();
  FakeAudio.made = [];
  FakeAudio.refuse = false;
  mocks.sample.mockReset();
  mocks.unlockAudio.mockReset();
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('window', { addEventListener: () => undefined });
  ({ testElevenLabs } = await import('./voiceTest'));
});

it('unlocks the audio inside the tap, then plays the line on that same element', async () => {
  let arrive: (b: Blob) => void = () => undefined;
  mocks.sample.mockReturnValue(new Promise<Blob>((r) => (arrive = r)));
  const done = testElevenLabs('voice1');
  // Still inside the tap: nothing awaited yet, and the element has already played (silence).
  expect(mocks.unlockAudio).toHaveBeenCalled();
  expect(FakeAudio.made).toHaveLength(1);
  expect(FakeAudio.made[0].plays).toEqual(['silence']);
  expect(mocks.sample).toHaveBeenCalledWith('voice1');
  arrive(new Blob(['RIFF'], { type: 'audio/wav' }));
  expect(await done).toBeNull();
  expect(FakeAudio.made).toHaveLength(1); // no new element: a fresh one would be blocked on iOS
  expect(FakeAudio.made[0].plays).toEqual(['silence', 'clip']);
});

it("says in plain words when the office couldn't make the line", async () => {
  mocks.sample.mockRejectedValue(new Error('ElevenLabs rejected the key. Set a new one in the voice settings.'));
  expect(await testElevenLabs('voice1')).toBe("Couldn't make the test: ElevenLabs rejected the key. Set a new one in the voice settings.");
  mocks.sample.mockRejectedValue(new TypeError('Failed to fetch'));
  expect(await testElevenLabs('voice1')).toBe("Couldn't make the test: the office didn't answer");
});

it('says in plain words when the browser blocks the sound', async () => {
  FakeAudio.refuse = true;
  mocks.sample.mockResolvedValue(new Blob(['RIFF']));
  expect(await testElevenLabs('voice1')).toMatch(/^Couldn't play the test: the browser blocked the sound\./);
});
