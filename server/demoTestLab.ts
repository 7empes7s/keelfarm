// The demo's test lab runner (#56): no browser and no commands. Screenshots are small made-up pictures, checks pass,
// runs print a passing suite after a few seconds, so the lab desk and the lab_* tools work in --demo.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { SessionCallbacks, SessionOptions } from './agentRunner.ts';
import { labFile, type LabRunner } from './testLab.ts';

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A width × height PNG: a header bar over a page, in the theme's colours. */
export function fakeShot(width: number, height: number, dark: boolean): Buffer {
  const [bg, bar] = dark ? [[24, 26, 32], [80, 120, 220]] : [[246, 244, 238], [60, 110, 220]];
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    const c = y < height / 8 ? bar : bg;
    for (let x = 0; x < width; x++) row.set(c, 1 + x * 3);
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function demoLabRunner(): LabRunner {
  let up = false;
  const write = (outDir: string, name: string, width: number, dark: boolean) => {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, '..', '.gitignore'), '*\n');
    const file = labFile(outDir, name);
    fs.writeFileSync(file, fakeShot(Math.round(width / 4), Math.round((width < 800 ? width * 2 : 800) / 4), dark));
    return file;
  };
  return {
    browserUp: () => up,
    async screenshot(o) {
      up = true;
      await pause(1500);
      const shots = o.viewports.map((w) => {
        const label = `${o.profile}-${w}-${o.theme}${o.graphics === 'full' ? '-full' : ''}`;
        return { label, file: write(o.outDir, `${label}.png`, w, o.theme === 'dark') };
      });
      return { shots, consoleErrors: [], pageErrors: [], failedRequests: [] };
    },
    async check(o) {
      up = true;
      await pause(2000 + Math.min(60_000, o.steps.reduce((ms, s) => ms + (s.do === 'wait' ? (s.ms ?? s.value ?? 0) : 0), 0))); // its waits, so a check can run long (#333)
      return { steps: o.steps.map((s) => ({ step: [s.do, s.selector, s.text ?? s.url].filter(Boolean).join(' '), ok: true })), consoleErrors: [], pageErrors: [], failedRequests: [] };
    },
    checkout: async (o) => o.worktree,
    async run(o) {
      await pause(4000);
      return { code: 0, ms: 4000, timedOut: false, artifacts: [], tail: [`> ${o.argv.join(' ')}`, '', ' ✓ 128 tests passed (demo)', '', 'Done in 4.0s'] };
    },
    installBrowser: async () => true,
    warm: async () => false,
    browserMb: async () => (up ? 420 : null),
    close: async () => void (up = false),
  };
}

/** A fake build or QA session on the test lab asks it for screenshots a few seconds in, the way a real one would. */
export function withLab(opts: SessionOptions, cb: SessionCallbacks): SessionCallbacks {
  const lab = opts.office;
  // Builds of odd issues skip it: their screenshot is one without an address (demo.ts issueScript, #230).
  if (!lab || (opts.task !== 'issue' && opts.task !== 'qa') || (opts.task === 'issue' && Number(opts.prompt.match(/#(\d+):/)?.[1] ?? 0) % 2)) return cb;
  setTimeout(() => {
    cb.log([{ kind: 'tool', tool: 'mcp__office__lab_screenshot', text: '⏺ 🧪 lab_screenshot 390, 1280' }]);
    void lab
      .call('lab_screenshot', { preview: false, url: 'http://localhost:5173/', viewports: [390, 1280] })
      .then((r) => cb.log([{ kind: 'result', text: `  ⎿ ${r.split('\n')[0]}` }]))
      .then(() => {
        // A PR that changes 3D code (qaPrompt.ts fullQualityLine): one full-quality pass after the lab checks.
        if (opts.task !== 'qa' || !opts.prompt.includes('graphics: "full"')) return;
        cb.log([{ kind: 'tool', tool: 'mcp__office__lab_screenshot', text: '⏺ 🧪 lab_screenshot 1280, full quality' }]);
        return lab.call('lab_screenshot', { preview: false, url: 'http://localhost:5173/', viewports: [1280], graphics: 'full' }).then((r) => cb.log([{ kind: 'result', text: `  ⎿ ${r.split('\n')[0]} at full quality` }]));
      });
  }, 4000);
  return cb;
}
