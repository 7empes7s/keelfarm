import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// A call's speech to text through the office (#645): a recorded clip against the demo's fake provider gives words;
// a failure says why, and the office files an IT ticket with the real error, never the key.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cubefarm-callstt-'));
process.env.SWARM_HOME = home;
const { createDemoBackend } = await import('./demo.ts');
const { Swarm } = await import('./swarm.ts');
const { VoiceApiError } = await import('./voice.ts');
const { elevenLabs } = await import('./elevenlabs.ts');
afterAll(() => fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 }));

/** A real fragmented-MP4 recording of a spoken sentence (AAC, 48 kHz mono), as Safari's MediaRecorder makes. */
const safariMp4 = fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'safari-recording.mp4'));
/** Where each top-level MP4 box starts. */
function mp4Boxes(b: Buffer): { type: string; at: number }[] {
  const out: { type: string; at: number }[] = [];
  for (let o = 0; o + 8 <= b.length; o += b.readUInt32BE(o)) out.push({ type: b.toString('ascii', o + 4, o + 8), at: o });
  return out;
}

/** One second of a 440 Hz tone, 16 kHz mono WAV: what a phone's recorder might send. */
function toneWav(): Buffer {
  const n = 16_000;
  const wav = Buffer.alloc(44 + n * 2);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + n * 2, 4);
  wav.write('WAVEfmt ', 8, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16_000, 24);
  wav.writeUInt32LE(32_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) wav.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / 16_000) * 8000), 44 + i * 2);
  return wav;
}

describe("a call's speech to text (#645)", () => {
  const key = 'sk_demo_stt_secret_4321';
  let failing: Error | null = null;
  const backend = createDemoBackend();
  const fake = backend.voice;
  const types: string[] = [];
  backend.voice = { ...fake, transcribe: (k, req, signal) => (types.push(req.type), failing ? Promise.reject(failing) : fake.transcribe(k, req, signal)) };
  const swarm = new Swarm(backend);
  const tickets = () => swarm.snapshot().itTickets ?? [];

  beforeAll(async () => {
    await swarm.voice.setKey(key);
    swarm.updateSettings({ listen: { provider: 'elevenlabs', autoSend: true, handsFree: false } });
  });

  it('turns a recorded clip into the words', async () => {
    expect(await swarm.voice.transcribe(toneWav(), 'audio/wav', 1000)).toBe("What's everyone working on?");
    expect(tickets()).toEqual([]);
  });

  it("an iPhone's recording (Safari's MediaRecorder: audio/mp4) is taken and sent to ElevenLabs as an MP4 file (#648)", async () => {
    // What Safari's recorder makes: a fragmented MP4 (ftyp, moov, then moof + mdat pairs) of AAC, labelled with its codec.
    const mp4 = safariMp4;
    types.length = 0;
    swarm.updateSettings({ listen: { provider: 'browser', autoSend: true, handsFree: false } });
    expect(await swarm.voice.transcribe(mp4, 'audio/mp4;codecs=mp4a.40.2', 2400, true)).toBe("What's everyone working on?");
    expect(types).toEqual(['audio/mp4']);
    swarm.updateSettings({ listen: { provider: 'elevenlabs', autoSend: true, handsFree: false } });

    const sent: FormData[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => (sent.push(init.body as FormData), new Response(JSON.stringify({ text: ' Ship it ' }), { status: 200 })));
    try {
      expect(await elevenLabs.transcribe(key, { audio: mp4, type: types[0] }, AbortSignal.timeout(5000))).toBe(' Ship it ');
    } finally {
      vi.unstubAllGlobals();
    }
    const file = sent[0].get('file') as File;
    expect([file.name, file.type, file.size]).toEqual(['speech.mp4', 'audio/mp4', mp4.length]);
  });

  it("a recording that isn't playable is refused before ElevenLabs, and one labelled wrong goes as what it is (#658)", async () => {
    types.length = 0;
    const boxes = mp4Boxes(safariMp4);
    const initOnly = safariMp4.subarray(0, boxes[2].at); // ftyp + moov: a recording with no audio
    const noStart = safariMp4.subarray(boxes[2].at); // moof + mdat only: slices joined without their init segment
    for (const bad of [initOnly, noStart, Buffer.from('<html>not audio</html>')]) {
      const err = (await swarm.voice.transcribe(bad, 'audio/mp4', 2000, true).catch((e: unknown) => e)) as { status?: number; message: string };
      expect([err.status, err.message]).toEqual([400, expect.stringMatching(/^The recording isn't playable audio \(/)]);
    }
    expect(types).toEqual([]); // ElevenLabs never saw them
    expect(await swarm.voice.transcribe(safariMp4, 'audio/webm;codecs=opus', 4200, true)).toBe("What's everyone working on?");
    expect(types).toEqual(['audio/mp4']); // the bytes, not the label
  });

  it('a failure surfaces with a message and becomes an IT ticket, without the key', async () => {
    failing = new VoiceApiError(500, `500: upstream timeout for ${key}`);
    const err = (await swarm.voice.transcribe(toneWav(), 'audio/wav', 1000).catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/speech|text|ElevenLabs/i);
    const t = tickets().find((x) => x.what === "A call can't hear the manager");
    expect(t?.evidence.join(' ')).toMatch(/Speech to text failed \(\d+\)/);
    expect(JSON.stringify(tickets())).not.toContain(key);
    failing = null;
  });

  it("a call's turn is heard through the office even when Talk instead of type is the browser's", async () => {
    swarm.updateSettings({ listen: { provider: 'browser', autoSend: true, handsFree: false } });
    expect(await swarm.voice.transcribe(toneWav(), 'audio/wav', 1000, true)).toBe("What's everyone working on?");
    expect(await swarm.voice.transcribe(toneWav(), 'audio/wav', 1000).catch((e: { status?: number }) => e.status)).toBe(409);
    swarm.updateSettings({ listen: { provider: 'elevenlabs', autoSend: true, handsFree: false } });
  });

  it("the clip's own problems aren't tickets", async () => {
    const before = tickets().length;
    await swarm.voice.transcribe(Buffer.alloc(0), 'audio/wav', 0).catch(() => undefined);
    await swarm.voice.transcribe(toneWav(), 'text/html', 1000).catch(() => undefined);
    expect(tickets()).toHaveLength(before);
  });

  it("the browser's report of a silent mic is a ticket too, its secrets masked", () => {
    swarm.voiceProblem(`I can't hear you: the microphone is silent. ${key}`);
    expect(tickets().some((t) => t.evidence.some((e) => e.includes('the microphone is silent')))).toBe(true);
    expect(JSON.stringify(tickets())).not.toContain(key);
    expect(() => swarm.voiceProblem('  ')).toThrow(/Say what went wrong/);
  });
});
