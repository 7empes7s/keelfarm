import { describe, expect, it } from 'vitest';
import { criteriaSteps, qaTrySteps, takeSteps, tryItSteps, tryThis } from './tryIt';

describe('tryItSteps', () => {
  it('reads the numbered steps under "## Try it", with a backticked page as the deep link', () => {
    const body = ['Adds a summary bubble.', '', '## Try it', '1. Open Chat at `/chat`.', '2. Send a **message**.', '3. You should get one bubble,', '   with the summary under Steps.', '', '## Self-review', '- nothing'].join('\n');
    expect(tryItSteps(body)).toEqual([
      { text: 'Open Chat at /chat.', path: '/chat' },
      { text: 'Send a message.' },
      { text: 'You should get one bubble, with the summary under Steps.' },
    ]);
  });

  it('splits inline numbering, takes "Try this" and bullets, and keeps at most five', () => {
    expect(tryItSteps('### Try this\n1. Open Chat. 2. Send a message. 3. One bubble shows.').map((s) => s.text)).toEqual(['Open Chat.', 'Send a message.', 'One bubble shows.']);
    expect(tryItSteps('## Try it\r\n- a1\r\n- b2\r\n- c3\r\n- d4\r\n- e5\r\n- f6')).toHaveLength(5);
  });

  it('is empty without the section', () => {
    expect(tryItSteps('Closes #3\n\n## What changed\n1. A thing')).toEqual([]);
    expect(tryItSteps(null)).toEqual([]);
  });
});

describe('criteriaSteps', () => {
  it("falls back on the issue's acceptance criteria, checkboxes and all", () => {
    const issue = '## Problem\nx\n\n## Acceptance\n- [ ] Pure test: parsing.\n- [x] Demo PR shows 3 steps at 390 px.\n\n---\n_Filed by the CEO._';
    expect(criteriaSteps(issue).map((s) => s.text)).toEqual(['Pure test: parsing.', 'Demo PR shows 3 steps at 390 px.']);
  });
});

describe('tryThis', () => {
  const pr = [{ text: 'Open Chat.' }];
  const qa = [{ text: 'Open Chat from the dock.', result: 'fail' as const, note: 'The dock hides it at 390 px' }];
  it("prefers QA's steps, then the PR's, then the issue's", () => {
    expect(tryThis(pr, qa, '## Acceptance\n- x y')).toEqual({ steps: qa, from: 'qa' });
    expect(tryThis(pr, undefined, '## Acceptance\n- x y')).toEqual({ steps: pr, from: 'pr' });
    expect(tryThis(undefined, [], '## Acceptance\n- Works on a phone')).toEqual({ steps: [{ text: 'Works on a phone' }], from: 'issue' });
    expect(tryThis(undefined, undefined, 'no criteria')).toBeNull();
  });
});

describe('qaTrySteps', () => {
  it("checks QA's report: known results, notes, junk dropped", () => {
    expect(qaTrySteps([{ step: 'Open `/settings`', result: 'pass' }, { step: 'Tap Save', result: 'boom', note: ' greyed out ' }, 7, { step: '' }])).toEqual([
      { text: 'Open /settings', path: '/settings', result: 'pass' },
      { text: 'Tap Save', note: 'greyed out' },
    ]);
    expect(qaTrySteps('nope')).toBeUndefined();
    expect(qaTrySteps([])).toBeUndefined();
  });
});

describe('takeSteps', () => {
  it('takes the steps off the PRs that have them, by number', () => {
    const pulls = [{ number: 1 }, { number: 2, tryIt: [{ text: 'Open Chat.' }] }];
    const steps = takeSteps(pulls);
    expect(pulls).toEqual([{ number: 1 }, { number: 2 }]);
    expect([...steps]).toEqual([[2, [{ text: 'Open Chat.' }]]]);
  });
});
