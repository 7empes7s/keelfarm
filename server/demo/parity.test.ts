// The demo parity rule (#257): every Backend member and every CEO tool has its demo fake, wherever the demo's modules
// put it, and every module that registers fakes is loaded.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { realBackend, realCloud } from '../backend.ts';
import { createDemoBackend } from '../demo.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const server = path.dirname(here);
const read = (file: string) => fs.readFileSync(file, 'utf8');
const kind = (v: unknown) => (v === null ? 'null' : typeof v);

describe('the demo fakes every Backend member', () => {
  const demo = createDemoBackend() as unknown as Record<string, unknown>;
  const real = realBackend as unknown as Record<string, unknown>;

  it.each(Object.keys(real))('%s', (key) => {
    expect(kind(demo[key])).toBe(kind(real[key]));
    // The services (previews, machines, voice…) fake every member of theirs too.
    if (kind(real[key]) === 'object') {
      const fake = demo[key] as Record<string, unknown>;
      for (const [member, value] of Object.entries(real[key] as Record<string, unknown>)) expect([member, kind(fake[member])]).toEqual([member, kind(value)]);
    }
  });

  it('and every member of the cloud', () => {
    const cloud = demo.cloud as Record<string, unknown>;
    for (const [member, value] of Object.entries(realCloud)) expect([member, kind(cloud[member])]).toEqual([member, kind(value)]);
  });
});

describe('every demo module is loaded', () => {
  const index = read(path.join(here, 'index.ts'));
  const modules = fs.readdirSync(here).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && /\bregister(Demo|CeoReply)\(/.test(read(path.join(here, f))) && f !== 'registry.ts');

  it('finds the modules', () => expect(modules.length).toBeGreaterThan(10));
  it.each(modules)('%s', (file) => expect(index.split(/\r?\n/)).toContain(`import './${file}';`));
});

/** CEO tools the demo CEO doesn't show yet: this list only shrinks; a new tool gets a demo (registerCeoReply) instead. */
const NOT_SHOWN = ['agent_detail', 'close_pull', 'configure_agent', 'define_experiment', 'session_history', 'set_dependencies', 'set_mandate'];

describe('the demo CEO shows every CEO tool', () => {
  const tools = ['ceo.ts', 'ceoWaitTools.ts', 'ceoReactTools.ts', 'ceoSetupTool.ts', 'ceoAskTools.ts'].flatMap((f) => [...read(path.join(server, f)).matchAll(/\btool\(\s*'([a-z_]+)'/g)].map((m) => m[1]));
  const demoFiles = [...fs.readdirSync(here).map((f) => path.join(here, f)), ...fs.readdirSync(server).filter((f) => /^demo[A-Z]\w*\.ts$/.test(f)).map((f) => path.join(server, f))].filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  const demoCode = demoFiles.map(read).join('\n');

  it('finds the tools', () => expect(tools.length).toBeGreaterThan(30));
  // Named where it's called or faked; a one-word tool (react, consult) only as a string, not in prose.
  const named = (tool: string) => new RegExp(tool.includes('_') ? `\\b${tool}\\b` : `['"\`]${tool}['"\`]`);
  it.each(tools.filter((t) => !NOT_SHOWN.includes(t)))('%s', (tool) => expect(demoCode).toMatch(named(tool)));
  it.each(NOT_SHOWN)('%s is still a tool (else drop it from NOT_SHOWN)', (tool) => {
    expect(tools).toContain(tool);
    expect(demoCode).not.toMatch(named(tool));
  });
});
