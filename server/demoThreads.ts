// The demo's older CEO chat threads (#132): five across the floors and the Company, with artifacts, a screenshot and a
// chart in them, so the threads list, a project's header and Files & artifacts have something to show in --demo.
import { crc32, deflateSync } from 'node:zlib';
import type { DemoThread } from './ceoChat.ts';

const HOUR = 3600_000;

function chunk(type: string, body: Buffer) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}

/** A made-up bar chart as an RGB PNG: a light background with one bar per value (0..1). */
function barsPng(values: readonly number[], w = 320, h = 200): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  const bar = Math.floor(w / (values.length * 2 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = Math.floor(x / bar);
      const on = i % 2 === 1 && (i - 1) / 2 < values.length && y >= h - 10 - values[(i - 1) / 2] * (h - 30) && y < h - 10;
      const at = y * (w * 3 + 1) + 1 + x * 3;
      raw.set(on ? [91, 108, 255] : y >= h - 10 ? [210, 205, 225] : [250, 247, 240], at);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const artifact = (title: string, markdown: string) => ({ id: '', title, lead: markdown.split('\n').find((l) => l.trim() && !l.startsWith('#'))?.replace(/[*|#]/g, '').trim().slice(0, 120) ?? '', markdown });

/** Older threads, from a day to three weeks ago; the first floors get one each, the rest are the Company's. */
export function demoThreads(repos: readonly { id: string; floor: number }[], now: number): DemoThread[] {
  const [one, two] = repos;
  const t = (hours: number) => now - hours * HOUR;
  const floorRef = (repoId: string, floor: number, text: string) => [{ kind: 'floor' as const, repoId, start: text.indexOf(`floor ${floor}`), end: text.indexOf(`floor ${floor}`) + `floor ${floor}`.length }];
  const threads: DemoThread[] = [];
  if (one) {
    const ask = `Why did checkout break on floor ${one.floor} last night?`;
    threads.push({
      repoId: one.id,
      pinned: true,
      messages: [
        { from: 'manager', text: ask, at: t(20), delivery: 'replied', refs: floorRef(one.id, one.floor, ask) },
        { from: 'ceo', text: 'A config change skipped QA. The incident report is below, and the screenshot shows the broken button.', at: t(19.5), image: { name: 'checkout-broken.png', png: barsPng([0.2, 0.9, 0.4]) }, artifacts: [artifact('Checkout incident report', '# Checkout incident\n\nThe pay button stopped working for 40 minutes.\n\n## What happened\n\n1. A config change merged without QA\n2. The button lost its click handler\n\n| When | What |\n| --- | --- |\n| 21:10 | merged |\n| 21:50 | rolled back |\n')] },
      ],
    });
  }
  if (two) {
    const ask = `Plan the API v2 for floor ${two.floor}.`;
    threads.push({
      repoId: two.id,
      messages: [
        { from: 'manager', text: ask, at: t(50), delivery: 'replied', refs: floorRef(two.id, two.floor, ask) },
        { from: 'ceo', text: 'Here is the plan, in three milestones.', at: t(49), artifacts: [artifact('API v2 plan', '# API v2\n\nThree milestones, each shippable.\n\n1. Versioned routes\n2. Pagination everywhere\n3. Deprecation notices\n')] },
        { from: 'manager', text: 'Good. Start with milestone 1.', at: t(48), delivery: 'replied' },
      ],
    });
  }
  threads.push(
    {
      repoId: null,
      messages: [
        { from: 'manager', text: 'How much did we spend this week?', at: t(80), delivery: 'replied' },
        { from: 'ceo', text: 'About a third of the plan, most of it on builds. The chart has it per day.', at: t(79), image: { name: 'spend-per-day.png', png: barsPng([0.3, 0.5, 0.45, 0.8, 0.6, 0.2, 0.35]) }, artifacts: [artifact('Weekly spend', '# Weekly spend\n\nAbout a third of the plan.\n\n| Kind | Share |\n| --- | --- |\n| Builds | 60% |\n| QA | 30% |\n| CEO | 10% |\n')] },
      ],
    },
    {
      repoId: null,
      messages: [
        { from: 'manager', text: 'Ideas for the next quarter?', at: t(200), delivery: 'replied' },
        { from: 'ceo', text: 'Three, ranked by what they would save you. The table compares them.', at: t(199), artifacts: [artifact('Next quarter ideas', '# Ideas\n\nRanked by the time they save.\n\n| Idea | Saves |\n| --- | --- |\n| Nightly QA sweep | 2 h/week |\n| Shared design tokens | 1 h/week |\n| Faster previews | 30 min/week |\n')] },
      ],
    },
    {
      repoId: null,
      archived: true,
      messages: [
        { from: 'manager', text: 'Welcome note for the new floor', at: t(500), delivery: 'replied' },
        { from: 'ceo', text: 'Done: it is pinned on the floor’s whiteboard.', at: t(499) },
      ],
    },
  );
  return threads;
}
