// The demo CEO's chat (#51): its thoughts and reply streamed into the live bubble as the real one's would be, and a
// made-up NOTES.md, so "What the CEO remembers" has something to show in --demo, and an edited chat to open on (#125).
import fs from 'node:fs';
import path from 'node:path';
import { HOME_DIR } from './config.ts';
import type { LogEntry, SessionCallbacks, SessionOptions } from './agentRunner.ts';
import type { PhoneMessage } from '../shared/types.ts';

export { demoThreads } from './demoThreads.ts'; // the older threads beside the open chat (#132)

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

const MIN = 60_000;

/**
 * A fresh demo office's chat, edits of every kind (#125): the manager's, answered (the CEO got a note) and while still
 * queued (it got the new text), both shown as just the new text; the CEO's, struck through; and a long plan in three versions.
 */
export function demoEditedChat(now: number): Omit<PhoneMessage, 'id'>[] {
  const t = (ago: number) => now - ago * MIN;
  const plan = (n: string, extra: string) =>
    `Here is the plan for the dark mode work on floor 1: ${n} issues. First the colour tokens in design.css, so every screen picks the theme up from one place. Then the settings toggle, saved per browser.${extra} QA checks every screen at 390 px in both themes.`;
  return [
    { from: 'manager', text: 'How is floor 2 doing this morning?', at: t(52), edited: t(49), versions: [{ text: 'How is floor 1 doing this morning?', at: t(52) }], delivery: 'replied' },
    { from: 'ceo', text: 'Floor 2 has two PRs in QA and one waiting on a fix. Nothing is stuck.', at: t(48), edited: t(46), versions: [{ text: 'Floor 2 has three PRs in QA and one waiting on a fix. Nothing is stuck.', at: t(48), reason: 'miscounted the PRs' }] },
    { from: 'manager', text: 'Add dark mode to the settings screen, and keep the old colours as an option.', at: t(30), edited: t(30) + 20_000, versions: [{ text: 'Add dark mode to the settings screen.', at: t(30) }], delivery: 'replied' },
    {
      from: 'ceo',
      text: plan('three', ' Last, the old colours stay as a "Classic" option, as you asked.'),
      at: t(27),
      edited: t(20),
      versions: [
        { text: plan('two', ''), at: t(27), reason: 'you asked to keep the old colours' },
        { text: plan('three', ' Last, the old colours stay as an option.'), at: t(24), reason: 'named the option' },
      ],
    },
  ];
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
