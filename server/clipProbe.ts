// A clip ffprobe can decode before it goes to ElevenLabs Speech to Text (#658: an iPhone's recording came back "File is
// corrupted"): written to a temp file (an MP4's moov may sit at the end, which a pipe can't seek to), probed, removed.
// Without ffprobe on this computer the header check (shared/clipLimits.ts sniffClip) is all there is.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Why ffprobe's JSON says the clip has no playable audio, or '' when it has some. Pure. */
export function probeVerdict(json: string): string {
  let r: { streams?: { codec_type?: string }[]; format?: { duration?: string } };
  try {
    r = JSON.parse(json);
  } catch {
    return "ffprobe couldn't read it";
  }
  if (!r.streams?.some((s) => s.codec_type === 'audio')) return 'it has no audio track';
  const d = Number(r.format?.duration);
  return Number.isFinite(d) && d <= 0 ? 'its audio is empty' : '';
}

/** Why ffprobe can't decode `audio` ('' when it can, or when there's no ffprobe here). */
export async function probeClip(audio: Buffer): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cubefarm-clip-'));
  const file = path.join(dir, 'clip');
  try {
    await fs.writeFile(file, audio);
    const out = await new Promise<{ code: string | number | null; stdout: string }>((resolve) =>
      execFile('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', file], { timeout: 10_000, windowsHide: true }, (err, stdout) => resolve({ code: err ? ((err as NodeJS.ErrnoException).code ?? 1) : 0, stdout: String(stdout) })),
    );
    if (out.code === 'ENOENT') return ''; // no ffprobe here
    return out.code === 0 ? probeVerdict(out.stdout) : "ffprobe couldn't decode it";
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 });
  }
}
