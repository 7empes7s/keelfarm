import { expect, it } from 'vitest';
import { createDemoBackend } from './demo.ts';

it('keeps the exact synthesis input as a WAV comment in the demo TTS fake', async () => {
  const text = 'Heard you, one moment.';
  const wav = await createDemoBackend().voice.synthesize('demo-key', { text, voiceId: 'demoVoiceAvery00001', model: 'demo', speed: 1 }, new AbortController().signal);
  expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
  expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
  const dataEnd = 44 + wav.readUInt32LE(40);
  const offset = dataEnd + dataEnd % 2;
  expect(wav.toString('ascii', offset, offset + 4)).toBe('LIST');
  expect(wav.toString('ascii', offset + 8, offset + 16)).toBe('INFOICMT');
  expect(wav.subarray(offset + 20, offset + 20 + wav.readUInt32LE(offset + 16) - 1).toString('utf8')).toBe(text);
});
