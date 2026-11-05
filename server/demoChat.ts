// The demo CEO's chat (#51): its thoughts and reply streamed into the live bubble as the real one's would be, and a
// made-up NOTES.md, so "What the CEO remembers" has something to show in --demo.
import fs from 'node:fs';
import path from 'node:path';
import { HOME_DIR } from './config.ts';
import type { LogEntry, SessionCallbacks, SessionOptions } from './agentRunner.ts';

const NOTES = `# Company notes

## The manager
- Prefers short replies on the phone; the long version goes in an artifact.
- Wants a heads-up before any team grows past 4 agents on a floor.

## Floors
- **Floor 1**: the web shop. QA checks the checkout on a phone first.
- **Floor 2**: the API. Breaking changes need a migration note in the PR.

## Lessons
1. Issues that touch the same file collide: file them with \`Depends on #N\`.
2. A red check on Windows is usually a path built by hand: use \`path.join\`.
`;

/** Writes the demo's notes once (the CEO's own edits, if any, stay). */
export function seedDemoNotes() {
  const file = path.join(HOME_DIR, 'ceo', 'NOTES.md');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, NOTES, { flag: 'wx' });
  } catch {
    // already there
  }
}

/** A demo CEO step's log lines; its thoughts (text lines) also go to the live bubble. */
export function logStreamed(entries: LogEntry[], opts: SessionOptions, cb: SessionCallbacks) {
  cb.log(entries);
  if (opts.stream) for (const e of entries) if (e.kind === 'text') cb.text?.(e.text.replace(/^● /, ''), true);
}

/** The reply as it is written, a few words at a time, in about five seconds at most (the real one comes a block at a time), then logged as the turn's reply. */
export async function writeReply(reply: string, opts: SessionOptions, cb: SessionCallbacks, stopped: () => boolean) {
  const words = reply.split(/(?<=\s)/);
  const n = Math.max(4, Math.ceil(words.length / 40));
  for (let i = n; opts.stream && i < words.length + n; i += n) {
    if (stopped()) throw new Error('Stopped by manager');
    cb.text?.(words.slice(0, i).join(''), i >= words.length);
    await new Promise((r) => setTimeout(r, 120));
  }
  cb.log([{ kind: 'text', text: `● ${reply}` }]);
  cb.turn?.(reply);
}
