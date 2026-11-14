import { describe, expect, it } from 'vitest';
import { probeVerdict } from './clipProbe.ts';

// ffprobe's word on a clip before it costs a transcription (#658).
describe('probeVerdict', () => {
  it('takes a clip with an audio track and refuses one without, or an empty one', () => {
    expect(probeVerdict(JSON.stringify({ streams: [{ codec_type: 'audio' }], format: { duration: '4.2' } }))).toBe('');
    expect(probeVerdict(JSON.stringify({ streams: [{ codec_type: 'video' }], format: { duration: '4.2' } }))).toBe('it has no audio track');
    expect(probeVerdict(JSON.stringify({ streams: [{ codec_type: 'audio' }], format: { duration: '0.000' } }))).toBe('its audio is empty');
    expect(probeVerdict('not json')).toMatch(/couldn't read/);
  });
});
