import { describe, expect, it } from 'vitest';
import { guideItems, guideProgress, type GuideInput } from './guide';

const charter = (objectives: number) => ({ objectives: Array.from({ length: objectives }, (_, i) => ({ id: `O${i + 1}`, outcome: 'x', measure: '' })), standards: [], nonGoals: [], focus: '', proposal: null, history: [], drift: [], insights: null });

function office(over: Partial<GuideInput> = {}): GuideInput {
  return {
    repos: [{ id: 'a/one', floor: 1, qaBrief: '', charter: charter(0) }],
    settings: { notify: { events: {} as never, channels: { desktop: true, push: true, ntfy: false, telegram: false }, officeUrl: '', telegramMirror: false, quietInApp: true }, ceoMandates: [] },
    notifyChannels: { pushDevices: 0, webhooks: { ntfy: { set: false, hint: '', last: null } }, telegram: { set: false, bot: '', linked: false, chat: '', linking: false, on: true, polling: 'off', error: '', okAt: null, advice: '', last: null } },
    experiments: { experiments: [] },
    ceo: { job: null, queue: [], researchedAt: null },
    installed: false,
    ...over,
  };
}

const done = (s: GuideInput) => Object.fromEntries(guideItems(s).map((i) => [i.id, i.done]));

describe('the guide checklist', () => {
  it('starts with nothing ticked on a fresh office', () => {
    expect(guideProgress(guideItems(office()))).toEqual({ done: 0, total: 8 });
  });

  it('ticks charters and QA briefs only when every floor has one', () => {
    const two = office({ repos: [{ id: 'a/one', floor: 1, qaBrief: 'Check the login', charter: charter(2) }, { id: 'a/two', floor: 2, qaBrief: ' ', charter: charter(0) }] });
    expect(done(two)).toMatchObject({ charter: false, qaBrief: false });
    const charterItem = guideItems(two).find((i) => i.id === 'charter')!;
    expect(charterItem.target).toEqual({ kind: 'section', section: 'charter', repoId: 'a/two' });
    const brief = guideItems(two).find((i) => i.id === 'qaBrief')!;
    expect(brief.target).toMatchObject({ kind: 'ceo' });
    expect(brief.target.kind === 'ceo' && brief.target.text).toContain('floor 2');
    const all = office({ repos: [{ id: 'a/one', floor: 1, qaBrief: 'Check the login', charter: charter(1) }] });
    expect(done(all)).toMatchObject({ charter: true, qaBrief: true });
    expect(done(office({ repos: [] }))).toMatchObject({ charter: false, qaBrief: false });
  });

  it('ticks notifications, the installed app and Telegram from the channels', () => {
    const base = office();
    expect(done(office({ notifyChannels: { ...base.notifyChannels, pushDevices: 1 } }))).toMatchObject({ notify: true, install: true, telegram: false });
    expect(done(office({ installed: true }))).toMatchObject({ notify: false, install: true });
    const linked = { ...base.notifyChannels, telegram: { ...base.notifyChannels.telegram, set: true, linked: true } };
    expect(done(office({ notifyChannels: linked }))).toMatchObject({ telegram: true, notify: false });
    expect(done(office({ notifyChannels: linked, settings: { ...base.settings, notify: { ...base.settings.notify, channels: { ...base.settings.notify.channels, telegram: true } } } }))).toMatchObject({ notify: true });
  });

  it('ticks the mandate, the experiment and research from what was done', () => {
    const base = office();
    const ticked = office({
      settings: { ...base.settings, ceoMandates: [{ id: 'm1', text: 'Keep CI green', floors: [], expiresAt: null, at: 1 }] },
      experiments: { experiments: [{ id: 'e1' } as never] },
      ceo: { job: null, queue: [], researchedAt: 5 },
    });
    expect(done(ticked)).toMatchObject({ mandate: true, experiment: true, research: true });
    expect(guideProgress(guideItems(ticked)).done).toBe(3);
  });

  it("ticks research from the server, not the chat, and shows one at the Researcher's desk in progress (#664)", () => {
    const ceo: GuideInput['ceo'] = { job: { kind: 'chat', label: 'Chatting' }, queue: [], researchedAt: null };
    const research = (o: Partial<GuideInput>) => guideItems(office({ ceo, ...o })).find((i) => i.id === 'research')!;
    expect(research({ ceo: { ...ceo, researchedAt: 1 } })).toMatchObject({ done: true, busy: false });
    expect(research({ research: { job: { id: 1, topic: 'A', by: 'manager', startedAt: 0, minutes: 20 }, queue: [] } })).toMatchObject({ done: false, busy: true });
    expect(research({ research: { job: null, queue: [{ id: 1, topic: 'A', by: 'ceo' }] } })).toMatchObject({ done: false, busy: true });
    expect(research({ research: null })).toMatchObject({ done: false, busy: false });
  });

  it('gives each item a reason and a place to go', () => {
    for (const i of guideItems(office())) {
      expect(i.why.length).toBeGreaterThan(10);
      expect(i.target.kind).toBeTruthy();
    }
    const where = Object.fromEntries(guideItems(office()).map((i) => [i.id, i.target]));
    expect(where.notify).toEqual({ kind: 'section', section: 'notifications' });
    expect(where.telegram).toEqual({ kind: 'section', section: 'notifications' });
    expect(where.mandate).toEqual({ kind: 'section', section: 'ceo' });
    expect(where.experiment).toEqual({ kind: 'section', section: 'ops' });
    expect(where.research).toMatchObject({ kind: 'ceo' });
    expect(where.install).toMatchObject({ kind: 'link' });
  });
});
