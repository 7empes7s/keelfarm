import { describe, expect, it } from 'vitest';
import { blockedAgents, openGaps, setupGaps, setupLine, snooze, SNOOZE_MS, toTell, type SetupInput } from './setup';
import { qaBriefChecks, caseDef } from './useCases';

const done = (over: Partial<SetupInput> = {}): SetupInput => ({
  useCase: 'web-app',
  qaBrief: qaBriefChecks(caseDef('web-app')),
  previewCommand: null,
  previewAuto: true,
  browserTesting: true,
  testLab: true,
  agents: [{ id: 'a1', name: 'Ada', cli: 'claude', model: '', signedOut: null }],
  providers: [],
  tools: [{ id: 'plugin:frontend-design@claude', name: 'frontend-design', on: true }],
  company: [],
  ...over,
});
const ids = (x: SetupInput) => setupGaps(x).map((g) => g.id);

describe('setupGaps on fixture floors', () => {
  it('a floor set up as recommended has none', () => expect(setupGaps(done())).toEqual([]));

  it('a missing preview, with the use case’s command as the recommended fix', () => {
    const [g] = setupGaps(done({ previewAuto: false }));
    expect(g).toMatchObject({ id: 'preview', title: 'No preview command' });
    expect(g.actions[0]).toEqual({ label: 'Use npm run dev -- --port its port', fix: { kind: 'preview' } });
    expect(ids(done({ previewAuto: false, previewCommand: 'npm start' }))).toEqual([]);
    expect(ids(done({ useCase: 'cli-library', qaBrief: 'run the command and read the output; tests pass', previewAuto: false, browserTesting: false }))).toEqual([]);
  });

  it('a missing provider', () => {
    const video = done({ useCase: 'video', qaBrief: 'the clip plays at the right length', providers: ['audio'] });
    expect(setupGaps(video)).toMatchObject([{ id: 'provider:video', actions: [{ label: 'Add provider', open: 'providers' }] }]);
  });

  it('a game floor whose QA brief has no frame-rate checks', () => {
    const game = done({ useCase: 'game-3d', qaBrief: 'Check the canvas renders and the controls respond.' });
    const [g] = setupGaps(game);
    expect(g).toMatchObject({ id: 'qa-brief', title: 'The QA brief skips 3D / browser game checks' });
    expect(g.why).toMatch(/frame rate/);
    expect(g.actions[0]).toEqual({ label: 'Add the checks', fix: { kind: 'qaBrief' } });
    expect(setupGaps(done({ qaBrief: '' }))[0].title).toBe('No QA brief');
  });

  it('a signed-out agent: Sign in first, Switch to the recommended builder, and it blocks only them', () => {
    const gemini = { id: 'g1', name: 'Gus', cli: 'opencode' as const, model: 'google/gemini-2.5-pro', signedOut: { why: 'The Gemini key was turned away (401).', fix: 'providers' as const } };
    const gaps = setupGaps(done({ agents: [gemini, ...done().agents] }));
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ id: 'signin:g1', title: "Gus isn't signed in", blocks: ['g1'] });
    expect(gaps[0].actions).toEqual([
      { label: 'Sign in', open: 'providers', agentId: 'g1' },
      { label: 'Switch to Claude Code · Opus', fix: { kind: 'cli', agentId: 'g1', cli: 'claude', model: 'opus' } },
    ]);
    expect([...blockedAgents(gaps)]).toEqual(['g1']);
  });

  it('browser testing, the Test lab, a skill switched off, and a floor the company is not set up for', () => {
    const x = done({ browserTesting: false, testLab: false, tools: [{ id: 'plugin:frontend-design@claude', name: 'frontend-design', on: false }], company: ['api'] });
    expect(ids(x)).toEqual(['browser', 'test-lab', 'skill:frontend-design', 'company']);
    expect(setupGaps(x).find((g) => g.id === 'skill:frontend-design')!.actions[0]).toEqual({ label: 'Turn it on', fix: { kind: 'skill', id: 'plugin:frontend-design@claude' } });
    expect(ids(done({ tools: [] }))).toEqual([]); // not installed: nothing to switch on
    expect(ids(done({ company: ['web-app', 'api'] }))).toEqual([]);
  });
});

describe('Not now and the notifications', () => {
  const gaps = setupGaps(done({ previewAuto: false, browserTesting: false }));

  it('Not now is remembered for a week, then the gap shows again', () => {
    const s = snooze({}, 'preview', gaps, 1_000);
    expect(openGaps(gaps, s, 2_000).map((g) => g.id)).toEqual(['browser']);
    expect(openGaps(gaps, s, 1_000 + SNOOZE_MS + 1).map((g) => g.id)).toEqual(['preview', 'browser']);
    expect(snooze({ old: 5, preview: 10 }, 'browser', gaps, 100)).toEqual({ browser: 100 + SNOOZE_MS }); // expired and closed ones go
  });

  it('one notification per gap, never repeated while it stays open, again once it comes back', () => {
    const first = toTell(gaps, gaps, []);
    expect(first.tell.map((g) => g.id)).toEqual(['preview', 'browser']);
    const second = toTell(gaps, gaps, first.told);
    expect(second.tell).toEqual([]);
    expect(second.told).toEqual(first.told);
    const fixed = toTell([gaps[1]], [gaps[1]], second.told); // the preview got its command
    expect(fixed).toEqual({ tell: [], told: ['browser'] });
    expect(toTell(gaps, gaps, fixed.told).tell.map((g) => g.id)).toEqual(['preview']);
  });

  it('a snoozed gap is not told', () => {
    const shown = openGaps(gaps, snooze({}, 'preview', gaps, 0), 1);
    expect(toTell(shown, gaps, []).tell.map((g) => g.id)).toEqual(['browser']);
  });
});

describe('setupLine', () => {
  it('says the use case and the gaps in one line', () => {
    expect(setupLine(null, true, [])).toBe('use case not known yet');
    expect(setupLine('api', false, [])).toBe('API · set up as recommended');
    expect(setupLine('game-3d', true, setupGaps(done({ useCase: 'game-3d', qaBrief: qaBriefChecks(caseDef('game-3d')), browserTesting: false })))).toBe('3D / browser game (guessed) · 1 gap: browser (Browser testing is off)');
  });
});
