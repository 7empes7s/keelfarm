import { describe, expect, it } from 'vitest';
import { CEO_ID } from '../../../shared/types';
import { buildIndex, fuzzy, searchAll, withRecent, type IndexInput, type Kind } from './searchIndex';

const input: IndexInput = {
  where: 'pocket',
  repos: [
    {
      id: 'acme/shop',
      fullName: 'acme/shop',
      floor: 2,
      summary: 'Web shop',
      issues: [{ number: 7, title: 'Dark mode toggle', body: '', url: '', labels: [], createdAt: '' }],
      pulls: [{ number: 9, title: 'Faster checkout', state: 'OPEN' } as never, { number: 4, title: 'Old login fix', state: 'MERGED' } as never],
      charter: { objectives: [{ id: 'O1', outcome: 'Checkout under two seconds', measure: 'p95 < 2 s' }], standards: [], nonGoals: [], focus: '', proposal: null, history: [], drift: [], insights: null },
    },
  ],
  agents: { [CEO_ID]: { id: CEO_ID, name: 'Mimoun', repoId: '', role: 'ceo' }, ada: { id: 'ada', name: 'Ada', repoId: 'acme/shop', role: 'agent' } },
  qa: { 'acme/shop#9': { repoId: 'acme/shop', prNumber: 9, status: 'testing', summary: 'Checks the cart', round: 1 } },
  messages: [
    { id: 1, from: 'manager', text: 'Hello there' },
    { id: 2, from: 'ceo', text: 'Here is the roadmap for the shop', artifacts: [{ id: '2-0', title: 'Q4 roadmap', lead: 'Three milestones' }] },
  ],
};

const items = buildIndex(input);
const first = (q: string, kind: Kind) => searchAll(q, items, []).find((g) => g.kind === kind)?.items[0];

describe('search everything', () => {
  it('finds every kind of thing', () => {
    expect(first('shop', 'floor')?.target).toEqual({ kind: 'overlay', overlay: { kind: 'kanban', repoId: 'acme/shop' } });
    expect(first('ada', 'agent')?.target).toEqual({ kind: 'overlay', overlay: { kind: 'terminal', agentId: 'ada' } });
    expect(first('mimoun', 'agent')?.target).toEqual({ kind: 'ceo' });
    expect(first('dark mode', 'issue')?.target).toEqual({ kind: 'overlay', overlay: { kind: 'card', repoId: 'acme/shop', key: 'i-7', number: 7, pr: false } });
    expect(first('checkout', 'pr')?.target).toEqual({ kind: 'overlay', overlay: { kind: 'card', repoId: 'acme/shop', key: 'pr-9', number: 9, pr: true } });
    expect(first('old login', 'pr')?.target).toMatchObject({ overlay: { key: 'm-4' } });
    expect(first('qa 9', 'qa')?.target).toEqual({ kind: 'overlay', overlay: { kind: 'app', repoId: 'acme/shop', pr: 9, qa: true } });
    expect(first('telegram', 'setting')?.target).toEqual({ kind: 'section', section: 'notifications' });
    expect(first('two seconds', 'objective')?.target).toEqual({ kind: 'section', section: 'charter', repoId: 'acme/shop' });
    expect(first('roadmap', 'message')?.target).toEqual({ kind: 'ceo' });
    expect(first('q4', 'artifact')?.label).toBe('Q4 roadmap');
    expect(searchAll('IT', items, [])[0]?.items[0]).toMatchObject({ label: 'IT department', target: { kind: 'section', section: 'it-dept' } }); // #580
  });

  it('runs the actions', () => {
    expect(first('plan', 'action')).toMatchObject({ label: 'Ask the CEO to plan…', target: { kind: 'ceo' } });
    expect(first('objective floor 2', 'action')?.target).toEqual({ kind: 'section', section: 'charter', repoId: 'acme/shop' });
    expect(first('turn on telegram', 'action')?.target).toEqual({ kind: 'section', section: 'notifications' });
    expect(first("floor 2's preview", 'action')?.target).toEqual({ kind: 'overlay', overlay: { kind: 'app', repoId: 'acme/shop' } });
  });

  it('leaves out the manager’s own messages and office-only sections on a phone', () => {
    expect(items.some((i) => i.label === 'Hello there')).toBe(false);
    expect(items.some((i) => i.id === 'set:timelapse')).toBe(false);
    expect(buildIndex({ ...input, where: 'office' }).some((i) => i.id === 'set:timelapse')).toBe(true);
    expect(items.some((i) => i.id === 'set:issues')).toBe(true); // Issues on a phone too (#265)
  });

  it('matches fuzzily, best first', () => {
    expect(fuzzy('prv', 'Open preview')).not.toBeNull();
    expect(fuzzy('zz', 'Open preview')).toBeNull();
    expect(fuzzy('open', 'Open preview')!).toBeGreaterThan(fuzzy('view', 'Open preview')!);
  });

  it('puts recent picks first, and shows them with the actions when nothing is typed', () => {
    const recent = withRecent(withRecent([], 'floor:acme/shop'), 'agent:ada');
    expect(recent).toEqual(['agent:ada', 'floor:acme/shop']);
    const empty = searchAll('', items, recent);
    expect(empty[0]).toMatchObject({ kind: 'recent', items: [{ id: 'agent:ada' }, { id: 'floor:acme/shop' }] });
    expect(empty[1].kind).toBe('action');
    expect(searchAll('floor 2 · shop', items, recent)[0]).toMatchObject({ kind: 'recent', items: [{ id: 'agent:ada' }, { id: 'floor:acme/shop' }] });
    expect(searchAll('ada', items, ['floor:acme/shop'])[0]).toMatchObject({ kind: 'agent', items: [{ id: 'agent:ada' }] });
    expect(withRecent(['a', 'b', 'c', 'd', 'e', 'f'], 'g')).toHaveLength(6);
  });
});
