// The demo's voice (#257, docs/voice.md): no ElevenLabs, a chime for every message.
import { DEMO_VOICES } from '../demoVoices.ts';
import { VoiceApiError, type VoiceApi } from '../voice.ts';
import { registerDemo } from './registry.ts';

/**
 * A two-note chime as 8 kHz mono WAV: something to hear without ElevenLabs, longer for longer text (up to 6 s, so a
 * voice call can be paused, skipped and talked over mid-reply), and pitched by the voice, so a replayed clip is
 * audibly the one made in the voice of its day, and shorter when faster.
 */
function demoChime(chars: number, voiceId = '', speed = 1): Buffer {
  const rate = 8000;
  const seconds = Math.min(0.4 + chars / 40, 6) / speed;
  const n = Math.round(rate * seconds);
  const wav = Buffer.alloc(44 + n);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + n, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(n, 40);
  const pitch = 2 ** ([...voiceId].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 7, 0) / 12);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const f = (t < seconds / 2 ? 660 : 880) * pitch;
    const fade = Math.min(1, (seconds - t) * 8, t * 40);
    wav[44 + i] = Math.round(128 + 40 * fade * Math.sin(2 * Math.PI * f * t));
  }
  return wav;
}

/** What the demo's Speech to Text hears in any recording (docs/voice.md). */
const DEMO_TRANSCRIPT = "What's everyone working on?";

/** No network: any key works except one containing "bad", nine voices (six of them v4), a chime for every message, and one fixed transcript. */
const demoVoice: VoiceApi = {
  checkKey: async (key) => {
    if (/bad/i.test(key)) throw new VoiceApiError(401, '401: invalid_api_key (demo)');
  },
  listVoices: async () => DEMO_VOICES,
  synthesize: async (_key, { text, voiceId, speed }) => {
    await new Promise((r) => setTimeout(r, 300));
    return demoChime(text.length, voiceId, speed);
  },
  transcribe: async () => {
    await new Promise((r) => setTimeout(r, 400));
    return DEMO_TRANSCRIPT;
  },
};

registerDemo('voice', () => ({ voice: demoVoice }));
