import { describe, expect, it } from 'vitest';
import { actionGate, addOpportunities, agencyView, decideAction, decideOpportunity, earnedLast30, emptyAgency, markDone, proposeAction, ranked, scoreOpportunity, shortlistMessage, toShortlist, AGENCY_QA_BRIEF, type OpportunityInput } from './agency.ts';
import { caseDef, missingChecks, USE_CASE_IDS } from './useCases.ts';

const NOW = new Date(2026, 10, 14, 12).getTime();
const opp = (slug: string, o: Partial<OpportunityInput> = {}): OpportunityInput => ({ slug, title: slug, revenue_month: 1000, effort_days: 5, days_to_first_dollar: 5, ...o });

describe('opportunity scoring', () => {
  it('is monthly profit × confidence per day until it pays', () => {
    expect(scoreOpportunity({ revenueMonth: 2000, costMonth: 200, effortDays: 4, daysToFirstDollar: 6, confidence: 0.5 })).toEqual({ profitMonth: 1800, score: 90 });
    expect(scoreOpportunity({ revenueMonth: 1000, costMonth: 0, effortDays: 2, daysToFirstDollar: 1, confidence: 1 }).score).toBe(333.33);
  });

  it('never divides by under a day, and scores losing ideas 0', () => {
    expect(scoreOpportunity({ revenueMonth: 500, costMonth: 0, effortDays: 0, daysToFirstDollar: 0, confidence: 1 }).score).toBe(500);
    expect(scoreOpportunity({ revenueMonth: 100, costMonth: 300, effortDays: 1, daysToFirstDollar: 1, confidence: 1 })).toEqual({ profitMonth: -200, score: 0 });
  });

  it('ranks the open ones best first, faster money breaking ties, and shortlists only new ones in the top 3', () => {
    const s = emptyAgency();
    addOpportunities(s, 'a/agency', [opp('slow', { days_to_first_dollar: 15, effort_days: 0, revenue_month: 3000 }), opp('fast', { days_to_first_dollar: 0, effort_days: 15, revenue_month: 3000 }), opp('small', { revenue_month: 100 }), opp('loss', { cost_month: 5000 }), opp('mid')], NOW);
    expect(ranked(s).map((x) => x.o.slug)).toEqual(['fast', 'slow', 'mid', 'small']); // loss is out
    expect(toShortlist(s, 'a/agency').map((x) => x.o.slug)).toEqual(['fast', 'slow', 'mid']);
    s.opportunities.find((o) => o.slug === 'fast')!.status = 'shortlisted';
    expect(toShortlist(s, 'a/agency').map((x) => x.o.slug)).toEqual(['slow', 'mid']);
    expect(toShortlist(s, 'other/floor')).toEqual([]);
  });

  it('updates by slug, keeps a decision, and refuses bad numbers with words the CEO can act on', () => {
    const s = emptyAgency();
    addOpportunities(s, 'a/agency', [opp('x')], NOW);
    decideOpportunity(s, 'x', false, undefined, NOW);
    addOpportunities(s, 'a/agency', [opp('x', { revenue_month: 5000 })], NOW);
    expect(s.opportunities).toHaveLength(1);
    expect(s.opportunities[0]).toMatchObject({ revenueMonth: 5000, status: 'declined' });
    expect(() => addOpportunities(s, 'a/agency', [opp('Bad Slug')], NOW)).toThrow(/isn't a slug/);
    expect(() => addOpportunities(s, 'a/agency', [opp('y', { confidence: 2 })], NOW)).toThrow(/confidence must be a number from 0 to 1/);
  });

  it('approves with a route (build by default), and only open ones', () => {
    const s = emptyAgency();
    addOpportunities(s, 'a/agency', [opp('x'), opp('y')], NOW);
    expect(decideOpportunity(s, 'x', true, undefined, NOW)).toMatchObject({ status: 'approved', route: 'build' });
    expect(() => decideOpportunity(s, 'x', true, 'ops', NOW)).toThrow(/approved already/);
    expect(decideOpportunity(s, 'y', true, 'ops', NOW).route).toBe('ops');
    expect(() => decideOpportunity(s, 'nope', true, undefined, NOW)).toThrow(/No opportunity "nope"/);
  });

  it("writes the shortlist with one-tap answers the suggestions box accepts", () => {
    const s = emptyAgency();
    addOpportunities(s, 'a/agency', [opp('x')], NOW);
    expect(shortlistMessage(4, s.opportunities)).toMatch(/Floor 4's agency shortlist[\s\S]*1\. x \(x\): \$1,000\/mo profit, 5 d effort, first \$ in 5 d, score 50\n\n```suggestions\nApprove x\nNot now\n```$/);
  });
});

describe('external actions', () => {
  const input = { kind: 'post', target: 'reddit.com/r/saas', summary: 'Launch post', draft: 'We built a thing' };

  it('wait for the manager: nothing goes out pending or declined, and an approved one goes out once', () => {
    const s = emptyAgency();
    const { action } = proposeAction(s, 'a/agency', input, NOW);
    expect(action).toMatchObject({ id: 'ax-1', status: 'pending' });
    expect(actionGate(action)).toMatch(/waits for the manager's approval/);
    expect(() => markDone(s, 'ax-1', 'posted', NOW)).toThrow(/waits for the manager's approval/);
    decideAction(s, 'ax-1', true, NOW);
    expect(actionGate(action)).toBeNull();
    expect(markDone(s, 'ax-1', 'posted', NOW).status).toBe('done');
    expect(() => markDone(s, 'ax-1', 'posted', NOW)).toThrow(/went out already/);
    const no = proposeAction(s, 'a/agency', { ...input, draft: 'other' }, NOW).action;
    decideAction(s, no.id, false, NOW);
    expect(() => markDone(s, no.id, 'posted', NOW)).toThrow(/Not now/);
    expect(() => decideAction(s, no.id, true, NOW)).toThrow(/declined already/);
    expect(actionGate(undefined)).toMatch(/agency_propose_action/);
  });

  it('are one card for the same draft, and need a known kind and the exact text', () => {
    const s = emptyAgency();
    expect(proposeAction(s, 'a/agency', input, NOW).added).toBe(true);
    expect(proposeAction(s, 'a/agency', input, NOW)).toMatchObject({ added: false, action: { id: 'ax-1' } });
    expect(() => proposeAction(s, 'a/agency', { ...input, kind: 'buy' }, NOW)).toThrow(/kind is one of/);
    expect(() => proposeAction(s, 'a/agency', { ...input, draft: ' ' }, NOW)).toThrow(/exact draft/);
    expect(() => proposeAction(s, 'a/agency', { ...input, opportunity: 'ghost' }, NOW)).toThrow(/No opportunity "ghost"/);
  });
});

describe('earnings and the view', () => {
  it("counts a live opportunity's last 30 days from its build floor, else entries naming it", () => {
    const s = emptyAgency();
    addOpportunities(s, 'a/agency', [opp('gigs', { title: 'Store gigs' }), opp('app')], NOW);
    const [gigs, app] = s.opportunities;
    Object.assign(gigs, { status: 'live' });
    Object.assign(app, { status: 'live', buildRepoId: 'a/app' });
    const e = {
      entries: [
        { id: '1', date: '2026-11-10', usd: 450, source: 'Upwork', note: 'Store gigs: candle shop', repoId: null, at: 0 },
        { id: '2', date: '2026-09-01', usd: 999, source: 'gigs', repoId: null, at: 0 }, // too old
        { id: '3', date: '2026-11-12', usd: 20, source: 'Stripe', repoId: 'a/app', at: 0 },
      ],
      feeds: [{ repoId: 'a/app', url: 'x', status: 'ok' as const, checkedAt: 0, days: { '2026-11-13': 30, '2026-10-01': 500 } }],
    };
    expect(earnedLast30(gigs, e, NOW)).toBe(450);
    expect(earnedLast30(app, e, NOW)).toBe(50);
    const v = agencyView(s, e, NOW);
    expect(v.opportunities.map((o) => o.earned30)).toEqual([450, 50]);
  });

  it('lists pending actions first', () => {
    const s = emptyAgency();
    proposeAction(s, 'a/agency', { kind: 'send', target: 'a', summary: 'a', draft: 'a' }, NOW);
    proposeAction(s, 'a/agency', { kind: 'send', target: 'b', summary: 'b', draft: 'b' }, NOW);
    decideAction(s, 'ax-1', true, NOW);
    expect(agencyView(s, { entries: [], feeds: [] }, NOW).actions.map((a) => a.id)).toEqual(['ax-2', 'ax-1']);
  });
});

describe('the agency use case', () => {
  it("is a use case whose QA brief covers every one of its document checks", () => {
    expect(USE_CASE_IDS).toContain('agency');
    const def = caseDef('agency');
    expect(def.code).toBe(false);
    expect(missingChecks(def, AGENCY_QA_BRIEF)).toEqual([]);
    expect(missingChecks(def, 'Check the build passes')).toHaveLength(4);
  });
});
