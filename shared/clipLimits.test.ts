import { describe, expect, it } from 'vitest';
import { CLIP_MAX_BYTES, CLIP_MAX_MS, CLIP_SLACK_MS, CLIP_TOO_BIG, clipExtension, clipProblem, clipType, sniffClip } from './clipLimits.ts';

describe('clipType', () => {
  it("drops the codec and takes what browsers record", () => {
    expect(clipType('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(clipType('Audio/Ogg; codecs=opus')).toBe('audio/ogg');
    expect(clipType('audio/mp4')).toBe('audio/mp4');
  });

  it("refuses anything that isn't audio we know", () => {
    expect(clipType('video/webm')).toBe('');
    expect(clipType('application/json')).toBe('');
    expect(clipType(undefined)).toBe('');
  });

  it('names the file by its type', () => {
    expect(clipExtension('audio/webm;codecs=opus')).toBe('webm');
    expect(clipExtension('audio/mpeg')).toBe('mp3');
    expect(clipExtension('audio/x-wav')).toBe('wav');
  });
});

describe('clipProblem', () => {
  const ok = { bytes: 40_000, ms: 4_000, type: 'audio/webm;codecs=opus' };

  it('takes a short clip', () => {
    expect(clipProblem(ok)).toBeNull();
    expect(clipProblem({ ...ok, bytes: CLIP_MAX_BYTES, ms: CLIP_MAX_MS })).toBeNull();
  });

  it('refuses a clip over 5 MB with a 413', () => {
    expect(clipProblem({ ...ok, bytes: CLIP_MAX_BYTES + 1 })).toEqual({ status: 413, message: CLIP_TOO_BIG });
  });

  it('refuses a clip over 60 s, allowing a late timer', () => {
    expect(clipProblem({ ...ok, ms: CLIP_MAX_MS + CLIP_SLACK_MS })).toBeNull();
    expect(clipProblem({ ...ok, ms: CLIP_MAX_MS + CLIP_SLACK_MS + 1 })?.status).toBe(413);
    expect(clipProblem({ ...ok, ms: Number.NaN })).toBeNull(); // no length given: the size still caps it
  });

  it('refuses an empty clip and an unknown type', () => {
    expect(clipProblem({ ...ok, bytes: 0 })?.status).toBe(400);
    expect(clipProblem({ ...ok, type: 'text/plain' })).toMatchObject({ status: 415, message: expect.stringContaining('"text/plain"') });
    expect(clipProblem({ ...ok, type: undefined })?.status).toBe(415);
  });
});

describe('sniffClip (#658)', () => {
  const box = (type: string, body = 0) => {
    const b = Buffer.alloc(8 + body, 1);
    b.writeUInt32BE(8 + body, 0);
    b.write(type, 4, 'ascii');
    return b;
  };
  it('names the container by its bytes and says what a broken one lacks', () => {
    expect(sniffClip(Buffer.concat([box('ftyp', 12), box('moov', 40), box('moof', 20), box('mdat', 400)]))).toEqual({ type: 'audio/mp4', problem: '' });
    expect(sniffClip(Buffer.concat([box('ftyp', 12), box('moov', 40)])).problem).toMatch(/no audio/);
    expect(sniffClip(Buffer.concat([box('ftyp', 12), box('mdat', 400)])).problem).toMatch(/no moov/);
    expect(sniffClip(Buffer.concat([box('moof', 20), box('mdat', 400)])).problem).toMatch(/missing its start/);
    expect(sniffClip(Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(400)]))).toEqual({ type: 'audio/webm', problem: '' });
    expect(sniffClip(Buffer.from('OggS0000')).type).toBe('audio/ogg');
    expect(sniffClip(Buffer.from('<html>')).problem).toMatch(/isn't audio/);
  });
});
