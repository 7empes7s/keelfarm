import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MIN_MEM_KB, ciRun, decide, healthProblem, memAvailableKb, prunable } from './demoUpdateSteps.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const green = { id: 7, status: 'completed', conclusion: 'success' };
const plenty = MIN_MEM_KB + 1;

describe('decide', () => {
  it('does nothing when the demo already runs main', () => {
    expect(decide({ target: A, current: A, failed: false, ci: green, memKb: plenty }).action).toBe('idle');
  });

  it('updates a new sha once CI passed and memory allows', () => {
    const d = decide({ target: B, current: A, failed: false, ci: green, memKb: plenty });
    expect(d).toEqual({ action: 'update', key: 'update', message: 'update aaaaaaa -> bbbbbbb (CI run 7 success)' });
  });

  it('never retries a sha whose update failed', () => {
    expect(decide({ target: B, current: A, failed: true, ci: green, memKb: plenty })).toMatchObject({ action: 'skip', key: 'failed' });
  });

  it('waits for CI to start and to finish', () => {
    expect(decide({ target: B, current: A, failed: false, ci: null, memKb: plenty })).toMatchObject({ action: 'wait', key: 'no-run' });
    const running = { id: 7, status: 'in_progress', conclusion: null };
    expect(decide({ target: B, current: A, failed: false, ci: running, memKb: plenty })).toMatchObject({ action: 'wait', key: 'ci-in_progress' });
  });

  it('skips red CI, and waits on a run a newer push cancelled', () => {
    const red = { id: 7, status: 'completed', conclusion: 'failure' };
    expect(decide({ target: B, current: A, failed: false, ci: red, memKb: plenty })).toMatchObject({ action: 'skip', key: 'ci-failure' });
    const cancelled = { id: 7, status: 'completed', conclusion: 'cancelled' };
    expect(decide({ target: B, current: A, failed: false, ci: cancelled, memKb: plenty }).action).toBe('wait');
  });

  it('waits instead of building when memory is under 2 GB', () => {
    const d = decide({ target: B, current: A, failed: false, ci: green, memKb: MIN_MEM_KB - 1 });
    expect(d).toMatchObject({ action: 'wait', key: 'memory' });
    expect(d.message).toContain('< 2048 MB');
  });
});

describe('ciRun', () => {
  it('takes the newest push or manual run and ignores pull-request runs', () => {
    const runs = {
      workflow_runs: [
        { id: 1, event: 'push', status: 'completed', conclusion: 'failure', created_at: '2026-11-06T10:00:00Z' },
        { id: 2, event: 'workflow_dispatch', status: 'completed', conclusion: 'success', created_at: '2026-11-06T11:00:00Z' },
        { id: 3, event: 'pull_request', status: 'completed', conclusion: 'failure', created_at: '2026-11-06T12:00:00Z' },
      ],
    };
    expect(ciRun(runs)).toEqual({ id: 2, status: 'completed', conclusion: 'success' });
    expect(ciRun({ workflow_runs: [] })).toBeNull();
    expect(ciRun(null)).toBeNull();
  });
});

describe('memAvailableKb', () => {
  it('reads MemAvailable, and 0 when it is missing', () => {
    expect(memAvailableKb('MemTotal:  7931136 kB\nMemFree:  690000 kB\nMemAvailable:  3775488 kB\n')).toBe(3775488);
    expect(memAvailableKb('MemTotal: 1 kB\n')).toBe(0);
  });
});

describe('healthProblem', () => {
  const ok = { rootStatus: 200, rootBody: '<html>cubefarm</html>', stateStatus: 200, stateBody: '{"demo":true,"machinesRoot":"~/demo/machines"}' };

  it('passes a demo that answers without host paths', () => {
    expect(healthProblem(ok)).toBeNull();
  });

  it('fails on a bad status, a real office or a leaked host path', () => {
    expect(healthProblem({ ...ok, rootStatus: 502 })).toBe('GET / answered 502');
    expect(healthProblem({ ...ok, stateStatus: 0 })).toBe('GET /api/state answered 0');
    expect(healthProblem({ ...ok, stateBody: '{"demo":false}' })).toBe('/api/state is not in demo mode');
    expect(healthProblem({ ...ok, stateBody: '<html>' })).toBe('/api/state is not JSON');
    expect(healthProblem({ ...ok, stateBody: '{"demo":true,"home":"/var/lib/cubefarm-demo"}' })).toBe('/api/state shows a host path (/var/lib)');
    expect(healthProblem({ ...ok, rootBody: 'see /root/x' })).toBe('/ shows a host path (/root)');
  });
});

describe('prunable', () => {
  it('keeps the newest releases and never the running or previous one', () => {
    const releases = [1, 2, 3, 4, 5].map((n) => ({ name: `r${n}`, mtimeMs: n }));
    expect(prunable(releases, { keep: 3, protect: ['r5', 'r4'] })).toEqual(['r2', 'r1']);
    expect(prunable(releases, { keep: 3, protect: ['r5', 'r1'] })).toEqual(['r2']);
  });
});

describe('the CLI the shell script calls', () => {
  const steps = path.join(path.dirname(fileURLToPath(import.meta.url)), 'demoUpdateSteps.mjs');

  it('prints a tab-separated decision, and waits when GitHub did not answer', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'demo-update-'));
    try {
      const meminfo = path.join(dir, 'meminfo');
      const runs = path.join(dir, 'runs.json');
      writeFileSync(meminfo, `MemAvailable: ${plenty} kB\n`);
      writeFileSync(runs, JSON.stringify({ workflow_runs: [{ id: 9, event: 'push', status: 'completed', conclusion: 'success', created_at: 'x' }] }));
      const out = (file: string) => execFileSync(process.execPath, [steps, 'decide', B, A, '0', file, meminfo], { encoding: 'utf8' });
      expect(out(runs)).toBe('update\tupdate\tupdate aaaaaaa -> bbbbbbb (CI run 9 success)\n');
      expect(out(path.join(dir, 'missing.json')).split('\t').slice(0, 2)).toEqual(['wait', 'no-run']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
