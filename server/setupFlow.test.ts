import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { NoticeView, ServerEvent } from '../shared/types.ts';
import type { OfficeTools } from './ceo.ts';
import type { PersistedAgent, PersistedRepo } from './swarm/model.ts';

// The setup advisor in a demo office (#366). Its own folder: the demo's provider keys are files in SWARM_HOME.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cubefarm-setup-'));
process.env.SWARM_HOME = home;
const { createDemoBackend } = await import('./demo.ts');
const { Swarm } = await import('./swarm.ts');
afterAll(() => fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 }));

type Inside = {
  broadcast(ev: ServerEvent): void;
  initProviders(): Promise<void>;
  reviewNew: boolean;
  refreshFloorSetup(): void;
  floorGaps: Map<string, unknown[]>;
  isFree(a: PersistedAgent): boolean;
  ensureCeo(interrupted: unknown[]): void;
  officeTools(): OfficeTools;
  state: { repos: PersistedRepo[]; agents: PersistedAgent[]; notices: NoticeView[] };
};

async function office() {
  const swarm = new Swarm(createDemoBackend());
  const inside = swarm as unknown as Inside;
  const events: ServerEvent[] = [];
  inside.broadcast = (ev) => void events.push(ev);
  await Promise.all([swarm.accounts.init(), inside.initProviders()]);
  swarm.setCompanyUseCases(['web-app', 'api']);
  inside.reviewNew = true; // as init does
  const view = await swarm.connectRepo('demo-co/star-hopper');
  const repo = () => inside.state.repos.find((r) => r.id === view.id)!;
  await vi.waitFor(() => expect(repo().setup?.useCase).toBe('game-3d'));
  const setup = () => swarm.snapshot().repos.find((r) => r.id === view.id)!.setup!;
  return { swarm, inside, id: view.id, repo, setup, events };
}

describe('the setup advisor in the office', () => {
  it('guesses a new three.js floor, shows its checklist, and keeps every key out of the snapshot', async () => {
    const { swarm, setup } = await office();
    expect(setup()).toMatchObject({ useCase: 'game-3d', guessed: true, guessWhy: 'three in package.json', review: true });
    expect(setup().gaps.map((g) => g.id)).toEqual(expect.arrayContaining(['qa-brief', 'company']));
    const snap = JSON.stringify(swarm.snapshot());
    for (const secret of swarm.providers.secretValues()) expect(snap).not.toContain(secret);
    expect(swarm.providers.secretValues().length).toBeGreaterThan(0);
  });

  it("leaves a floor not guessed yet with nothing to fix out of the snapshot (#228's budget)", async () => {
    const { swarm, inside, id, repo } = await office();
    repo().setup = undefined;
    inside.floorGaps.delete(id);
    expect(swarm.snapshot().repos.find((r) => r.id === id)).not.toHaveProperty('setup');
  });

  it('applies a fix, remembers Not now, and notifies once per gap', async () => {
    const { swarm, inside, id, repo, setup } = await office();
    swarm.applyFloorSetup(id, 'qa-brief', 0);
    expect(repo().qaBrief).toMatch(/Frame rate stays smooth/);
    expect(setup().gaps.map((g) => g.id)).not.toContain('qa-brief');

    swarm.snoozeFloorSetup(id, 'company');
    expect(setup().gaps.map((g) => g.id)).not.toContain('company');
    expect(setup().snoozed).toBe(1);
    expect(repo().setup!.snoozed.company).toBeGreaterThan(Date.now());

    swarm.updateRepo(id, { browserTesting: false });
    const told = () => inside.state.notices.filter((n) => n.kind === 'setup' && n.text.length > 0 && n.title.startsWith(`Floor ${repo().floor}:`));
    inside.refreshFloorSetup(); // a gap is told once it outlasts a refresh
    inside.refreshFloorSetup();
    inside.refreshFloorSetup();
    // The company gap lasted a refresh before its Not now, so it was told; the QA brief was fixed before it was.
    expect(told().map((n) => n.title).sort()).toEqual([`Floor ${repo().floor}: Browser testing is off`, `Floor ${repo().floor}: The company isn't set up for 3D / browser games`]);
    inside.refreshFloorSetup();
    expect(told()).toHaveLength(2); // never repeated while open
    expect(told().find((n) => n.title.endsWith('Browser testing is off'))).toMatchObject({ target: { kind: 'floor', repoId: id }, actions: ['setup'] });

    swarm.closeFloorReview(id);
    expect(setup().review).toBe(false);
  });

  it("a signed-out Gemini agent gets a Sign in card and no work until it's fixed; Switch fixes it", async () => {
    const { swarm, inside, id, setup } = await office();
    const a = inside.state.agents.find((x) => x.repoId === id)!;
    Object.assign(a, { cli: 'opencode', model: 'google/gemini-2.5-pro', status: 'idle' });
    expect(inside.isFree(a)).toBe(true);
    inside.refreshFloorSetup();
    const card = setup().gaps.find((g) => g.id === `signin:${a.id}`)!;
    expect(card).toMatchObject({ title: `${a.name} isn't signed in`, blocks: [a.id] });
    expect(card.why).toMatch(/^Their Google Gemini API key failed its test: Turned away \(401\)/);
    expect(card.actions[0]).toEqual({ label: 'Sign in', open: 'providers', agentId: a.id });
    expect(inside.isFree(a)).toBe(false);

    swarm.applyFloorSetup(id, card.id, 1);
    expect(a.cli).toBe('claude');
    expect(setup().gaps.map((g) => g.id)).not.toContain(card.id);
    expect(inside.isFree(a)).toBe(true);
  });

  it("in the rotation, an agent is signed out only once every login of theirs is: another one runs their work", async () => {
    const { swarm, inside, id, setup } = await office();
    const a = inside.state.agents.find((x) => x.repoId === id)!;
    Object.assign(a, { cli: 'claude', account: undefined, status: 'idle' });
    const real = swarm.accounts.view();
    const login = (lid: string, status: string) => ({ ...real.accounts[0], id: lid, cli: 'claude', label: lid, tags: [], priority: 0, enabled: true, removing: false, status }) as never;
    swarm.updateSettings({ rotation: { on: true } as never });
    const view = { ...real, accounts: [login('main', 'signed-out'), login('backup', 'ready')] };
    swarm.accounts.view = () => view;
    inside.refreshFloorSetup();
    expect(setup().gaps.map((g) => g.id)).not.toContain(`signin:${a.id}`);
    expect(inside.isFree(a)).toBe(true);
    view.accounts[1] = login('backup', 'signed-out');
    inside.refreshFloorSetup();
    expect(setup().gaps.find((g) => g.id === `signin:${a.id}`)).toMatchObject({ why: expect.stringMatching(/Claude logins are signed out/), actions: [{ label: 'Sign in', open: 'accounts' }] });
    a.account = 'backup'; // pinned to one that's ready again
    view.accounts[1] = login('backup', 'ready');
    inside.refreshFloorSetup();
    expect(inside.isFree(a)).toBe(true);
  });

  it('a Gemini CLI agent runs on their Google login, not the Gemini API key: signed out only when that login is', async () => {
    const { swarm, inside, id, setup } = await office();
    const a = inside.state.agents.find((x) => x.repoId === id)!;
    Object.assign(a, { cli: 'gemini', model: 'gemini-3-pro', account: undefined, status: 'idle' });
    const real = swarm.accounts.view();
    const login = (status: string) => ({ ...real.accounts[0], id: 'google', cli: 'gemini', label: 'google', tags: [], priority: 0, enabled: true, removing: false, status }) as never;
    const view = { ...real, accounts: [login('ready')] };
    swarm.accounts.view = () => view;
    inside.refreshFloorSetup(); // the demo's Gemini API key fails its test (401)
    expect(setup().gaps.map((g) => g.id)).not.toContain(`signin:${a.id}`);
    expect(inside.isFree(a)).toBe(true);
    view.accounts[0] = login('signed-out');
    inside.refreshFloorSetup();
    const card = setup().gaps.find((g) => g.id === `signin:${a.id}`)!;
    expect(card.why).toMatch(/^Their Gemini login "google" is signed out\./);
    expect(card.actions[0]).toEqual({ label: 'Sign in', open: 'accounts', agentId: a.id });
    expect(inside.isFree(a)).toBe(false);
  });

  it("the CEO sets a floor's use case and applies a recommendation, and sees it in company_status", async () => {
    const { swarm, inside, id, repo } = await office();
    inside.ensureCeo([]);
    swarm.updateRepo(id, { browserTesting: false });
    const out = await inside.officeTools().call('apply_setup', { floor: repo().floor, gap: 'browser' });
    expect(out).toMatch(/^Floor \d+: 3D \/ browser game \(guessed\)/);
    expect(repo().browserTesting).toBe(true);
    expect(await inside.officeTools().call('apply_setup', { floor: repo().floor, gap: 'nope' })).toMatch(/^Refused: Floor \d+ has no gap "nope"/);
    await inside.officeTools().call('apply_setup', { floor: repo().floor, use_case: 'web-app' });
    expect(repo().setup).toMatchObject({ useCase: 'web-app', guessed: false });
    const status = JSON.parse(await inside.officeTools().call('company_status', {})) as { floors: { floor: number; setup: string }[] };
    expect(status.floors.find((f) => f.floor === repo().floor)?.setup).toMatch(/^Web app · /);
  });
});
