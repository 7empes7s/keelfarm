// The demo CEO's notes file (#51): a made-up NOTES.md, so "What the CEO remembers" has something to show in --demo.
import fs from 'node:fs';
import path from 'node:path';
import { HOME_DIR } from './config.ts';

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
