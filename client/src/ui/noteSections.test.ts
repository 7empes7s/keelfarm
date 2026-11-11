import { describe, expect, it } from 'vitest';
import { noteChips, noteSections, searchSections } from './noteSections';

const SAMPLE = `# Company notes

## CURRENT
- **msg 1855 (2026-11-08):** ship #412 on floor 2 after QA.
  Why: the manager asked twice.
  **How to apply:** check \`server/swarm.ts:40\` first.
- 2026-11-09: keel/scheduler.ts:118 drops idle desks.

## Floors
**Floor 1**: the web shop.

Floor 2 is the API.

## ARCHIVE
### October
- msg 1200: old news about #7, see https://github.com/a/b/issues/9#3
\`\`\`
## not a heading #5 file.ts:1
\`\`\`
`;

const floors = [
  { floor: 1, fullName: 'acme/web' },
  { floor: 2, fullName: 'acme/api', prs: [412] },
];

describe("the CEO's notes in sections (#417)", () => {
  it('splits on ## and ###, counting items, dating each and folding the archive', () => {
    const s = noteSections(SAMPLE);
    expect(s.map((x) => [x.id, x.title, x.level, x.parent, x.count, x.updated, x.archived])).toEqual([
      ['current', 'CURRENT', 2, undefined, 2, '2026-11-09', false],
      ['floors', 'Floors', 2, undefined, 2, null, false],
      ['archive', 'ARCHIVE', 2, undefined, 0, null, true],
      ['october', 'October', 3, 'ARCHIVE', 1, null, true],
    ]);
    // the heading inside the code block stays in October's body
    expect(s[3].body).toContain('## not a heading');
  });

  it('keeps text before the first section and gives repeated titles their own ids', () => {
    const s = noteSections('Intro line\n## A\nx\n## A\ny');
    expect(s.map((x) => [x.id, x.title, x.body])).toEqual([
      ['notes', 'Notes', 'Intro line'],
      ['a', 'A', 'x'],
      ['a-2', 'A', 'y'],
    ]);
  });

  it('narrows the search to matching items, or a whole section by its title', () => {
    const s = noteSections(SAMPLE);
    const found = searchSections(s, 'IDLE desks');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: 'current', count: 1, body: '- 2026-11-09: keel/scheduler.ts:118 drops idle desks.' });
    // an item's indented lines belong to it
    expect(searchSections(s, 'manager asked')[0].body).toContain('ship #412');
    expect(searchSections(s, 'floors')[0].body).toBe(s[1].body);
    expect(searchSections(s, 'nothing like this')).toEqual([]);
    expect(searchSections(s, '  ')).toEqual(s);
  });
});

describe("chips in the CEO's notes (#417)", () => {
  it('turns lead-ins, issues, file refs and Why / How to apply into chips, leaving code and URLs alone', () => {
    const s = noteSections(SAMPLE);
    const { md, chips } = noteChips(s[0], floors);
    expect(md).toBe(
      [
        '- [msg 1855 (2026-11-08)](cubefarm:ref/0) ship [#412](cubefarm:ref/1) on floor 2 after QA.',
        '  [Why](cubefarm:ref/2) the manager asked twice.',
        '  [How to apply](cubefarm:ref/3) check `server/swarm.ts:40` first.',
        '- [2026-11-09](cubefarm:ref/4) [keel/scheduler.ts:118](cubefarm:ref/5) drops idle desks.',
      ].join('\n'),
    );
    expect(chips).toEqual([
      { kind: 'lead', msg: 1855, date: '2026-11-08' },
      { kind: 'issue', number: 412, url: 'https://github.com/acme/api/pull/412' },
      { kind: 'label', text: 'Why' },
      { kind: 'label', text: 'How to apply' },
      { kind: 'lead', date: '2026-11-09' },
      { kind: 'file', path: 'keel/scheduler.ts', line: 118 },
    ]);
  });

  it('leaves other bold lead-ins, code blocks and links as written; #N without floors is a plain chip', () => {
    const s = noteSections(SAMPLE);
    expect(noteChips(s[1], floors).chips).toEqual([]);
    const { md, chips } = noteChips(s[3], []);
    expect(chips).toEqual([
      { kind: 'lead', msg: 1200 },
      { kind: 'issue', number: 7 },
    ]);
    expect(md).toContain('https://github.com/a/b/issues/9#3');
    expect(md).toContain('## not a heading #5 file.ts:1');
  });

  it('takes the floor for #N from the section', () => {
    const { chips } = noteChips({ title: 'Floor 1', body: '- #3 is next' }, floors);
    expect(chips).toEqual([{ kind: 'issue', number: 3, url: 'https://github.com/acme/web/issues/3' }]);
  });
});
