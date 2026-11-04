import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PROBATION_MS,
  clientPort,
  isOfficeState,
  isUpdateCommand,
  officeUrl,
  parseMarker,
  parseOfficeArgs,
  parseSymref,
  pendingAction,
  preflightOutcome,
  preflightSteps,
  probationVerdict,
  refusal,
  rollbackPlan,
  stepsFor,
  swarmHome,
} from './officeSteps.mjs';

describe('parseOfficeArgs', () => {
  it('is start mode, opening the browser, with no flags', () => {
    expect(parseOfficeArgs([])).toEqual({ dev: false, demo: false, open: true, help: false });
  });

  it('reads --dev, --demo and --no-open', () => {
    expect(parseOfficeArgs(['--dev', '--demo'])).toEqual({ dev: true, demo: true, open: true, help: false });
    expect(parseOfficeArgs(['--no-open'])).toMatchObject({ dev: false, open: false });
    expect(parseOfficeArgs(['-h']).help).toBe(true);
  });

  it('refuses unknown flags and stray arguments', () => {
    expect(() => parseOfficeArgs(['--prod'])).toThrow();
    expect(() => parseOfficeArgs(['demo'])).toThrow();
  });
});

describe('swarmHome and clientPort', () => {
  it('uses SWARM_HOME, else ~/.cubefarm', () => {
    expect(swarmHome({ SWARM_HOME: path.join('x', 'home') }, 'h')).toBe(path.join('x', 'home'));
    expect(swarmHome({}, path.join('users', 'me'))).toBe(path.join('users', 'me', '.cubefarm'));
  });

  it('uses SWARM_CLIENT_PORT, else 5317', () => {
    expect(clientPort({ SWARM_CLIENT_PORT: '4422' })).toBe(4422);
    expect(clientPort({})).toBe(5317);
    expect(clientPort({ SWARM_CLIENT_PORT: '' })).toBe(5317);
  });
});

describe('parseSymref', () => {
  it("reads origin's default branch", () => {
    expect(parseSymref('ref: refs/heads/main\tHEAD\n4f2c1d0a\tHEAD\n')).toBe('main');
    expect(parseSymref('ref: refs/heads/release/2.x\tHEAD\r\n')).toBe('release/2.x');
  });

  it('is null without a symref', () => {
    expect(parseSymref('')).toBeNull();
    expect(parseSymref('4f2c1d0a\tHEAD')).toBeNull();
  });
});

describe('refusal', () => {
  const ok = { branch: 'main', defaultBranch: 'main', dirty: false, ahead: 0 };

  it('allows a clean default branch', () => {
    expect(refusal(ok)).toBeNull();
  });

  it('refuses another branch or a detached HEAD', () => {
    expect(refusal({ ...ok, branch: 'feature-x' })).toMatch(/branch feature-x, not main/);
    expect(refusal({ ...ok, branch: '' })).toMatch(/detached HEAD/);
  });

  it('refuses local changes and local commits', () => {
    expect(refusal({ ...ok, dirty: true })).toMatch(/local changes/);
    expect(refusal({ ...ok, ahead: 2 })).toMatch(/2 local commits/);
  });
});

describe('stepsFor', () => {
  it('needs nothing when nothing changed', () => {
    expect(stepsFor([], { startMode: true })).toEqual({ install: false, build: false });
    expect(stepsFor([''], { startMode: true })).toEqual({ install: false, build: false });
  });

  it('installs when the root package.json or lockfile changed', () => {
    expect(stepsFor(['package-lock.json'], { startMode: false })).toEqual({ install: true, build: false });
    expect(stepsFor(['server/swarm.ts', 'package.json'], { startMode: false }).install).toBe(true);
  });

  it("ignores other folders' package files", () => {
    expect(stepsFor(['examples/app/package.json', 'docs\\package-lock.json'], { startMode: false }).install).toBe(false);
  });

  it('builds in start mode whenever anything changed', () => {
    expect(stepsFor(['client/src/store.ts'], { startMode: true })).toEqual({ install: false, build: true });
    expect(stepsFor(['client/src/store.ts'], { startMode: false }).build).toBe(false);
  });
});

describe('rollbackPlan', () => {
  it('undoes nothing when HEAD never moved (refused, fetch failed, no fast-forward)', () => {
    expect(rollbackPlan({ moved: false, installed: false, built: false })).toEqual({ reset: false, install: false, build: false });
  });

  it('resets without reinstalling when the dependencies were never touched', () => {
    expect(rollbackPlan({ moved: true, installed: false, built: false })).toEqual({ reset: true, install: false, build: false });
  });

  it('reinstalls the old dependencies after npm install ran', () => {
    expect(rollbackPlan({ moved: true, installed: true, built: false })).toEqual({ reset: true, install: true, build: false });
  });

  it('rebuilds the old version after a build ran', () => {
    expect(rollbackPlan({ moved: true, installed: true, built: true })).toEqual({ reset: true, install: true, build: true });
    expect(rollbackPlan({ moved: true, installed: false, built: true })).toEqual({ reset: true, install: false, build: true });
  });
});

describe('isUpdateCommand', () => {
  it('is u + Enter', () => {
    expect(isUpdateCommand('u')).toBe(true);
    expect(isUpdateCommand(' U \r')).toBe(true);
    expect(isUpdateCommand('update')).toBe(false);
    expect(isUpdateCommand('')).toBe(false);
  });
});

describe('preflight', () => {
  const start = preflightSteps({ startMode: true });
  const passed = (steps: string[]) => steps.map((step) => ({ step, ok: true }));

  it('installs, tests, builds and boots the target; --dev skips the build', () => {
    expect(start).toEqual(['install', 'test', 'build', 'boot']);
    expect(preflightSteps({ startMode: false })).toEqual(['install', 'test', 'boot']);
  });

  it('goes only when every step passed', () => {
    expect(preflightOutcome(start, passed(start))).toEqual({ go: true, error: null });
  });

  it('aborts on the first failure, saying which step', () => {
    const results = [{ step: 'install', ok: true }, { step: 'test', ok: false, error: 'npm test failed (exit 1)' }];
    expect(preflightOutcome(start, results)).toEqual({ go: false, error: 'tests failed (npm test failed (exit 1))' });
    expect(preflightOutcome(start, [...passed(['install', 'test', 'build']), { step: 'boot', ok: false, error: 'the demo office exited (1)' }]).error).toBe('the boot check failed (the demo office exited (1))');
    expect(preflightOutcome(start, [{ step: 'prepare', ok: false, error: 'git worktree failed' }]).error).toMatch(/^checking out the target commit failed/);
  });

  it('aborts when a step never ran', () => {
    expect(preflightOutcome(start, passed(['install', 'test', 'build']))).toEqual({ go: false, error: 'the boot check never ran' });
    expect(preflightOutcome(start, []).go).toBe(false);
  });

  it("recognises the office's state", () => {
    expect(isOfficeState({ repos: [], agents: [] })).toBe(true);
    expect(isOfficeState({ repos: [] })).toBe(false);
    expect(isOfficeState(null)).toBe(false);
  });
});

describe('probationVerdict', () => {
  const ok = { ok: true, error: null };
  const base = { exited: null, elapsedMs: 10_000, lastProbe: ok, everAnswered: true };

  it('keeps watching within the window', () => {
    expect(probationVerdict(base)).toEqual({ done: false, ok: false, error: null });
    expect(probationVerdict({ ...base, lastProbe: { ok: false, error: 'ECONNREFUSED' }, everAnswered: false }).done).toBe(false);
  });

  it('fails at once when the office exits', () => {
    expect(probationVerdict({ ...base, exited: 1 })).toEqual({ done: true, ok: false, error: 'the office exited (1) during its probation' });
    expect(probationVerdict({ ...base, exited: 0, elapsedMs: PROBATION_MS * 2 }).ok).toBe(false);
  });

  it('passes when the window ends with the office answering', () => {
    expect(probationVerdict({ ...base, elapsedMs: PROBATION_MS })).toEqual({ done: true, ok: true, error: null });
  });

  it('fails when the last probe failed', () => {
    const v = probationVerdict({ ...base, elapsedMs: PROBATION_MS, lastProbe: { ok: false, error: 'HTTP 500' } });
    expect(v).toEqual({ done: true, ok: false, error: 'the office stopped answering GET /api/state (HTTP 500)' });
  });

  it('fails when it never answered (a timeout)', () => {
    const v = probationVerdict({ exited: null, elapsedMs: 120_000, lastProbe: { ok: false, error: 'ECONNREFUSED' }, everAnswered: false, windowMs: 120_000 });
    expect(v).toEqual({ done: true, ok: false, error: 'the office never answered GET /api/state within 120 s (ECONNREFUSED)' });
    expect(probationVerdict({ exited: null, elapsedMs: PROBATION_MS, lastProbe: null, everAnswered: false }).ok).toBe(false);
  });
});

describe('the pending marker', () => {
  const marker = { from: 'aaa', to: 'bbb', startedAt: 5, rollingBack: false };

  it('parses update-pending.json', () => {
    expect(parseMarker(JSON.stringify({ from: 'aaa', to: 'bbb', startedAt: 5 }))).toEqual(marker);
    expect(parseMarker(JSON.stringify({ ...marker, rollingBack: true }))?.rollingBack).toBe(true);
    expect(parseMarker('not json')).toBeNull();
    expect(parseMarker('{"from":"aaa"}')).toBeNull();
  });

  it('does nothing without a marker', () => {
    expect(pendingAction(null, 'bbb')).toBe('none');
  });

  it('rolls back when the folder is still on the unconfirmed commit', () => {
    expect(pendingAction(marker, 'bbb')).toBe('rollback');
  });

  it('finishes a rollback that was cut short', () => {
    expect(pendingAction({ ...marker, rollingBack: true }, 'aaa')).toBe('rollback');
  });

  it('clears it when the folder is back on the old commit, or elsewhere', () => {
    expect(pendingAction(marker, 'aaa')).toBe('clear');
    expect(pendingAction(marker, 'ccc')).toBe('clear');
  });
});

describe('officeUrl', () => {
  it("is the launcher's way to the office", () => {
    expect(officeUrl({})).toBe('http://127.0.0.1:4317');
    expect(officeUrl({ SWARM_PORT: '5660', SWARM_HOST: '0.0.0.0' })).toBe('http://127.0.0.1:5660');
    expect(officeUrl({ SWARM_HOST: '192.168.1.5' })).toBe('http://192.168.1.5:4317');
    expect(officeUrl({ SWARM_HOST: '[::1]' })).toBe('http://[::1]:4317');
  });
});
