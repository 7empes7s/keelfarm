// The demo's design proposal (#209): two mock screenshots per option of pixel-todo's list, written to a temp folder, as
// the CEO's propose_design would get them, so a fresh demo office opens with one waiting in Approvals.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ProposeDesignInput } from './designTool.ts';

const TODOS = ['Buy oat milk', 'Water the plants', 'Call the plumber', 'Book the dentist'];

/** A 390×560 phone screen of the todo list, flat rows or raised cards, light or dark. */
function shot(cards: boolean, dark: boolean): string {
  const bg = dark ? '#16181d' : '#f5f6f8', ink = dark ? '#e8eaee' : '#1d2129', card = dark ? '#22252c' : '#ffffff', line = dark ? '#30343c' : '#e3e6ea';
  const rows = TODOS.map((t, i) => {
    const y = 96 + i * (cards ? 92 : 64);
    const box = cards
      ? `<rect x="16" y="${y}" width="358" height="76" rx="14" fill="${card}" ${dark ? '' : 'filter="url(#s)"'}/>`
      : `<line x1="16" y1="${y + 60}" x2="374" y2="${y + 60}" stroke="${line}"/>`;
    const cy = y + (cards ? 38 : 30);
    return `${box}<circle cx="48" cy="${cy}" r="11" fill="none" stroke="#5b8def" stroke-width="3"/><text x="72" y="${cy + 6}" font-family="Segoe UI, Arial" font-size="17" fill="${ink}">${t}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="390" height="560" viewBox="0 0 390 560"><defs><filter id="s" x="-10%" y="-10%" width="120%" height="140%"><feDropShadow dx="0" dy="3" stdDeviation="5" flood-opacity=".12"/></filter></defs><rect width="390" height="560" fill="${bg}"/><text x="16" y="64" font-family="Segoe UI, Arial" font-size="28" font-weight="700" fill="${ink}">Today</text>${rows}</svg>`;
}

/** propose_design's input for the demo, its shots written under the temp folder (where the CEO may attach from). */
export async function demoDesign(): Promise<ProposeDesignInput> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cubefarm-design-'));
  const write = async (name: string, cards: boolean, dark: boolean) => {
    const p = path.join(dir, name);
    await fs.writeFile(p, shot(cards, dark));
    return p;
  };
  return {
    floor: 1,
    title: 'Todo list: flat rows or cards',
    question: 'Which look should the todo list ship with?',
    options: [
      { label: 'Flat rows with hairlines', shots: [await write('a-light.svg', false, false), await write('a-dark.svg', false, true)] },
      { label: 'Raised cards, soft shadow', shots: [await write('b-light.svg', true, false), await write('b-dark.svg', true, true)] },
    ],
  };
}
