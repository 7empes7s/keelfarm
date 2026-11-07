import { describe, expect, it } from 'vitest';
import { voiceOption } from './elevenlabs.ts';

describe('voiceOption', () => {
  it("marks voices made for Eleven v4 from the API's model metadata", () => {
    expect(voiceOption({ voice_id: 'a', name: 'A', high_quality_base_model_ids: ['eleven_v4', 'eleven_flash_v2_5'] }).v4).toBe(true);
    expect(voiceOption({ voice_id: 'b', name: 'B', verified_languages: [{ language: 'en', model_id: 'eleven_v4_turbo' }] }).v4).toBe(true);
    expect(voiceOption({ voice_id: 'c', name: 'C', high_quality_base_model_ids: ['eleven_multilingual_v2'] }).v4).toBeUndefined();
    expect(voiceOption({ voice_id: 'd', name: 'D', high_quality_base_model_ids: 'eleven_v4' }).v4).toBeUndefined();
  });
});
