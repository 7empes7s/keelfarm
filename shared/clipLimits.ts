// How much of the manager's speech one ElevenLabs transcription takes: the browser stops recording at these limits and
// the server refuses anything over them, with the same words on both sides.

/** The longest clip: the recorder stops here. */
export const CLIP_MAX_MS = 60_000;
/** The biggest upload the server reads. */
export const CLIP_MAX_BYTES = 5 * 1024 * 1024;
/** Timers run a little late: a clip may say it's this much over the limit and still be taken. */
export const CLIP_SLACK_MS = 3_000;

/** What MediaRecorder makes in Chromium, Firefox and Safari, plus the usual audio files, by file extension. */
const TYPES: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

export const CLIP_TOO_BIG = 'That recording is too long to transcribe: keep it under 60 seconds.';

/** A Content-Type's audio type without its parameters ('audio/webm;codecs=opus' → 'audio/webm'), or '' when it isn't one we take. */
export function clipType(contentType: string | undefined): string {
  const t = (contentType ?? '').split(';')[0].trim().toLowerCase();
  return t in TYPES ? t : '';
}

/** The file extension ElevenLabs is told for a clip of this type. */
export const clipExtension = (type: string) => TYPES[clipType(type)] ?? 'webm';

/** Why a clip can't be transcribed (an HTTP status and words for the manager), or null when it can. */
export function clipProblem(clip: { bytes: number; ms: number; type: string | undefined }): { status: 400 | 413 | 415; message: string } | null {
  if (!clipType(clip.type)) return { status: 415, message: `The office can't transcribe ${clip.type ? `"${clip.type.split(';')[0]}"` : 'that'} audio: send WebM, Ogg, MP4, MP3 or WAV.` };
  if (!(clip.bytes > 0)) return { status: 400, message: 'The recording was empty.' };
  if (clip.bytes > CLIP_MAX_BYTES || (Number.isFinite(clip.ms) && clip.ms > CLIP_MAX_MS + CLIP_SLACK_MS)) return { status: 413, message: CLIP_TOO_BIG };
  return null;
}

// ---------- what the clip really is (#658) ----------

/** An MP4's top-level boxes: [type, size], stopping at a box that runs past the end. */
function mp4Boxes(b: Uint8Array): [string, number][] {
  const out: [string, number][] = [];
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let o = 0; o + 8 <= b.length && out.length < 4096; ) {
    let size = v.getUint32(o);
    const type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
    if (size === 1 && o + 16 <= b.length) size = Number(v.getBigUint64(o + 8));
    else if (size === 0) size = b.length - o; // to the end
    if (size < 8) break;
    out.push([type, Math.min(size, b.length - o)]);
    o += size;
  }
  return out;
}

const ascii = (b: Uint8Array, at: number, s: string) => [...s].every((c, i) => b[at + i] === c.charCodeAt(0));

/**
 * The clip's container from its bytes, whatever it was labelled (a recording posted as audio/webm that's an MP4), and
 * why it isn't playable audio ('' when it may be): an MP4 needs its ftyp first, its moov (the init segment, which
 * joined recorder slices can lose) and audio data (an mdat with something in it), as ElevenLabs' decoder does.
 */
export function sniffClip(b: Uint8Array): { type: string; problem: string } {
  if (b.length >= 12 && ascii(b, 4, 'ftyp')) {
    const boxes = mp4Boxes(b);
    const has = (t: string) => boxes.some(([x]) => x === t);
    if (!has('moov')) return { type: 'audio/mp4', problem: 'the MP4 has no moov box (its header)' };
    if (!boxes.some(([x, size]) => x === 'mdat' && size > 16)) return { type: 'audio/mp4', problem: 'the MP4 has no audio in it' };
    return { type: 'audio/mp4', problem: '' };
  }
  if (b.length >= 8 && (ascii(b, 4, 'moof') || ascii(b, 4, 'mdat') || ascii(b, 4, 'styp'))) return { type: 'audio/mp4', problem: 'the MP4 is missing its start (ftyp and moov)' };
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { type: 'audio/webm', problem: b.length < 200 ? 'the WebM has no audio in it' : '' };
  if (ascii(b, 0, 'OggS')) return { type: 'audio/ogg', problem: '' };
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WAVE')) return { type: 'audio/wav', problem: b.length <= 44 ? 'the WAV has no audio in it' : '' };
  if (ascii(b, 0, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { type: 'audio/mpeg', problem: '' };
  return { type: '', problem: "it isn't audio the office knows (not MP4, WebM, Ogg, WAV or MP3)" };
}

/** The words for a clip that isn't playable audio, before it costs a transcription. */
export const clipBroken = (why: string) => `The recording isn't playable audio (${why}). Try again; if it keeps happening, the office's IT desk has the details.`;
