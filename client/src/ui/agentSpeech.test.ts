import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A clicked agent's line arrives after a fetch (and a decode): if the CEO starts talking or a replay starts
// meanwhile, the line is dropped quietly, never played over them nor babbled instead.

const state = {
  settings: { voice: { agentsSpeak: true, provider: 'browser' as 'browser' | 'elevenlabs', voiceName: '', speed: 1 } },
  voiceKeySet: false,
  demo: true,
  replaying: false,
  voiceSpeaking: null as number | null,
  agents: { a1: { name: 'Ada' }, a2: { name: 'Bo' }, a3: { name: 'Cy' }, a4: { name: 'Di' }, a5: { name: 'Ed' } } as Record<string, { name: string }>,
};
const decode = vi.fn();
const sample = vi.fn();
const playClip = vi.fn(async () => true);
const speakLine = vi.fn(async () => true);
const captionSaid = vi.fn();

vi.mock('../store', () => ({ useStore: { getState: () => state } }));
vi.mock('./captions', () => ({ captionSaid }));
vi.mock('./music', () => ({ holdMusicDuck: () => () => {} }));
vi.mock('./voicePlayback', () => ({ playClip, speakLine }));
vi.mock('./sfx', () => ({
  audio: () => ({ ctx: { decodeAudioData: decode } }),
  getAudioPrefs: () => ({ muted: false }),
  sample,
  subscribeAudio: () => () => {},
}));

const { speakAgent } = await import('./agentSpeech');

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const lineResponse = (clip: boolean) => ({ ok: true, json: async () => ({ text: 'Morning!', clip }) }) as Response;
const clipResponse = () => ({ ok: true, blob: async () => ({ arrayBuffer: async () => new ArrayBuffer(8) }) }) as unknown as Response;
const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  Object.assign(state, { voiceKeySet: false, demo: true, replaying: false, voiceSpeaking: null });
  state.settings.voice.provider = 'browser';
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('speakAgent', () => {
  it("drops the browser voice's line when the CEO starts talking while it's fetched", async () => {
    const line = deferred<Response>();
    fetchMock.mockReturnValueOnce(line.promise);
    const said = speakAgent('a1');
    await tick();
    state.voiceSpeaking = 7;
    line.resolve(lineResponse(false));
    expect(await said).toBe(true); // true: no babble
    expect(speakLine).not.toHaveBeenCalled();
    expect(captionSaid).not.toHaveBeenCalled();
  });

  it("drops an ElevenLabs clip when the CEO starts talking while it's downloaded", async () => {
    Object.assign(state, { voiceKeySet: true, demo: false });
    state.settings.voice.provider = 'elevenlabs';
    const clip = deferred<Response>();
    fetchMock.mockResolvedValueOnce(lineResponse(true)).mockReturnValueOnce(clip.promise);
    const said = speakAgent('a2', () => null);
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    state.voiceSpeaking = 7;
    clip.resolve(clipResponse());
    expect(await said).toBe(true);
    expect(playClip).not.toHaveBeenCalled();
    expect(captionSaid).not.toHaveBeenCalled();
  });

  it('drops a 3D clip when a replay starts while it decodes', async () => {
    Object.assign(state, { voiceKeySet: true, demo: false });
    state.settings.voice.provider = 'elevenlabs';
    const decoded = deferred<{ duration: number }>();
    decode.mockReturnValueOnce(decoded.promise);
    fetchMock.mockResolvedValueOnce(lineResponse(true)).mockResolvedValueOnce(clipResponse());
    const said = speakAgent('a3', () => [0, 1, 0]);
    await tick();
    expect(decode).toHaveBeenCalled();
    state.replaying = true;
    decoded.resolve({ duration: 1 });
    expect(await said).toBe(true);
    expect(sample).not.toHaveBeenCalled();
  });

  it('plays both ways when nothing changed meanwhile', async () => {
    fetchMock.mockResolvedValueOnce(lineResponse(false));
    expect(await speakAgent('a4')).toBe(true);
    expect(speakLine).toHaveBeenCalledWith('Morning!', '', 1);

    Object.assign(state, { voiceKeySet: true, demo: false });
    state.settings.voice.provider = 'elevenlabs';
    decode.mockResolvedValueOnce({ duration: 1 });
    fetchMock.mockResolvedValueOnce(lineResponse(true)).mockResolvedValueOnce(clipResponse());
    expect(await speakAgent('a5', () => [0, 1, 0])).toBe(true);
    expect(sample).toHaveBeenCalledOnce();
  });
});
