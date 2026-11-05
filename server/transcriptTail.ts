// The CEO's text as it writes it (#51): Claude Code adds each finished message block to the session's transcript
// (JSONL), so the office reads the file's new lines while the session runs. No extra model calls: the file is there anyway.
import fs from 'node:fs';

const POLL_MS = 1000;

/**
 * The main thread's assistant text blocks in `chunk` (whole JSONL lines) written at or after `since` (epoch ms): a
 * resumed conversation's file starts with the old ones. `seen`: line ids already passed on, updated.
 */
export function assistantTexts(chunk: string, since: number, seen: Set<string>): string[] {
  const out: string[] = [];
  for (const line of chunk.split('\n')) {
    if (!line.trim()) continue;
    let e: { type?: string; isSidechain?: boolean; uuid?: string; timestamp?: string; message?: { content?: unknown } };
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type !== 'assistant' || e.isSidechain || !Array.isArray(e.message?.content)) continue;
    if (e.uuid) {
      if (seen.has(e.uuid)) continue;
      seen.add(e.uuid);
    }
    const at = Date.parse(e.timestamp ?? '');
    if (Number.isFinite(at) && at < since) continue;
    for (const b of e.message.content as { type?: string; text?: unknown }[]) {
      if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) out.push(b.text);
    }
  }
  return out;
}

/** Follows one session's transcript: `watch` it once a hook names the file; every new text block goes to `onText`. */
export class TranscriptTail {
  private file = '';
  private offset = 0;
  private timer: NodeJS.Timeout | undefined;
  private readonly seen = new Set<string>();

  constructor(
    private readonly since: number,
    private readonly onText: (text: string) => void,
  ) {}

  watch(file: string) {
    if (file !== this.file) {
      this.file = file;
      this.offset = 0;
    }
    this.timer ??= setInterval(() => this.read(), POLL_MS).unref();
    this.read();
  }

  /** Reads the whole lines added since last time; a line still being written waits for the next read. */
  read() {
    if (!this.file) return;
    let fd: number | undefined;
    try {
      fd = fs.openSync(this.file, 'r');
      const size = fs.fstatSync(fd).size;
      if (size < this.offset) this.offset = 0; // rewritten
      if (size === this.offset) return;
      const buf = Buffer.alloc(size - this.offset);
      fs.readSync(fd, buf, 0, buf.length, this.offset);
      const end = buf.lastIndexOf(0x0a) + 1;
      this.offset += end;
      for (const t of assistantTexts(buf.subarray(0, end).toString('utf8'), this.since, this.seen)) this.onText(t);
    } catch {
      // not written yet, or gone
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
