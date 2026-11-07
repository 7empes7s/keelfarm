import { describe, expect, it } from 'vitest';
import { ARTIFACT_CHARS, artifactFileName, artifactLead, makeArtifacts, officeText, parseCeoMessage, parseMessage, snapshotMessages, suggestionsFor } from './chatParts';
import { messageSpeech } from './speech';
import type { PhoneMessage } from './types';

const fence = '```';

describe('parseMessage', () => {
  it("cleans the office's notes of terminal codes, and leaves the manager's as written (#138)", () => {
    const raw = `tests failed (\x1b[2m${'─'.repeat(50)}[1/1]\x1b[22m)`;
    expect(parseMessage('office', raw)).toEqual({ text: 'tests failed (—[1/1])' });
    expect(parseMessage('manager', raw)).toEqual({ text: raw });
  });

  it('cleans a note stored before the fix when it renders: the old 2d99aaf update notice (#138)', () => {
    const stored = `⚠️ Update to 2d99aaf held back: \x1b[31mFAIL\x1b[39m ${'─'.repeat(400)} \x1b[2mTest Files\x1b[22m 1 failed`;
    expect(officeText(stored)).toBe('⚠️ Update to 2d99aaf held back: FAIL — Test Files 1 failed');
  });
});

describe('parseCeoMessage', () => {
  it('leaves a message without blocks as it was', () => {
    const raw = `Two PRs merged.\n\n${fence}ts\nconst a = 1;\n${fence}\n\nAll good?`;
    expect(parseCeoMessage(raw)).toEqual({ text: raw });
  });

  it('lifts out suggestions and an artifact, keeping the rest', () => {
    const raw = [
      'I drafted three issues for floor 2.',
      '',
      `${fence}artifact title="Issues to file"`,
      '# Floor 2',
      '| # | Title |',
      '|---|---|',
      '| 1 | Jukebox |',
      fence,
      '',
      'Shall I file them?',
      `${fence}suggestions`,
      'Yes, file them',
      '- Not now',
      '',
      'Show me the plan',
      fence,
    ].join('\n');
    const p = parseCeoMessage(raw);
    expect(p.text).toBe('I drafted three issues for floor 2.\n\nShall I file them?');
    expect(p.suggestions).toEqual(['Yes, file them', 'Not now', 'Show me the plan']);
    expect(p.artifacts).toEqual([{ title: 'Issues to file', markdown: '# Floor 2\n| # | Title |\n|---|---|\n| 1 | Jukebox |' }]);
  });

  it('keeps code blocks inside an artifact', () => {
    const raw = `See the plan.\n${fence}artifact title='Plan'\nStep one:\n${fence}bash\nnpm test\n${fence}\nDone.\n${fence}`;
    const p = parseCeoMessage(raw);
    expect(p.text).toBe('See the plan.');
    expect(p.artifacts?.[0].markdown).toBe(`Step one:\n${fence}bash\nnpm test\n${fence}\nDone.`);
  });

  it('takes several artifacts, at most three; the fourth stays in the text', () => {
    const block = (n: number) => `${fence}artifact title="A${n}"\nbody ${n}\n${fence}`;
    const raw = ['Here:', block(1), block(2), block(3), block(4)].join('\n');
    const p = parseCeoMessage(raw);
    expect(p.artifacts?.map((a) => a.title)).toEqual(['A1', 'A2', 'A3']);
    expect(p.text).toBe(`Here:\n${block(4)}`);
  });

  it('keeps an unclosed fence as text', () => {
    const raw = `Hi.\n${fence}suggestions\nYes\nNo`;
    expect(parseCeoMessage(raw)).toEqual({ text: raw });
    const art = `Hi.\n${fence}artifact title="Plan"\n# Plan\n- one`;
    expect(parseCeoMessage(art)).toEqual({ text: art });
  });

  it('keeps suggestion blocks that break the limits as text', () => {
    const five = `Pick:\n${fence}suggestions\na\nb\nc\nd\ne\n${fence}`;
    expect(parseCeoMessage(five)).toEqual({ text: five });
    const long = `Pick:\n${fence}suggestions\n${'x'.repeat(61)}\n${fence}`;
    expect(parseCeoMessage(long)).toEqual({ text: long });
    const empty = `Pick:\n${fence}suggestions\n\n${fence}`;
    expect(parseCeoMessage(empty)).toEqual({ text: empty });
  });

  it('keeps malformed artifacts as text: no title, empty, or too long', () => {
    for (const raw of [`${fence}artifact\nbody\n${fence}`, `${fence}artifact title=""\nbody\n${fence}`, `${fence}artifact title="T"\n\n${fence}`, `${fence}artifact title="T"\n${'x'.repeat(ARTIFACT_CHARS + 1)}\n${fence}`]) {
      expect(parseCeoMessage(`Note.\n${raw}`)).toEqual({ text: `Note.\n${raw}` });
    }
  });

  it('takes a `? question` first line as the question its options answer (#183)', () => {
    const p = parseCeoMessage(`The payment failed.\n${fence}suggestions\n? Did you fix the GitHub payment?\nFixed it\nNot yet\n${fence}`);
    expect(p).toEqual({ text: 'The payment failed.', suggestions: ['Fixed it', 'Not yet'], ask: 'Did you fix the GitHub payment?' });
    expect(parseCeoMessage(`Hm.\n${fence}suggestions\n? Only a question\n${fence}`).suggestions).toBeUndefined();
  });

  it('only uses the first suggestions block', () => {
    const raw = `Q?\n${fence}suggestions\nYes\n${fence}\n${fence}suggestions\nNo\n${fence}`;
    const p = parseCeoMessage(raw);
    expect(p.suggestions).toEqual(['Yes']);
    expect(p.text).toBe(`Q?\n${fence}suggestions\nNo\n${fence}`);
  });

  it('leaves blocks inside an ordinary code block alone', () => {
    const raw = `Example:\n${fence}${fence}md\n${fence}suggestions\nYes\n${fence}\n${fence}${fence}`;
    expect(parseCeoMessage(raw)).toEqual({ text: raw });
  });

  it('can leave an empty bubble when the message is only an artifact', () => {
    expect(parseCeoMessage(`${fence}artifact title="Report"\nAll green.\n${fence}`)).toEqual({ text: '', artifacts: [{ title: 'Report', markdown: 'All green.' }] });
  });
});

describe('artifacts', () => {
  it('gives each a card line and an id', () => {
    expect(artifactLead('\n## Floor 2 report\nmore')).toBe('Floor 2 report');
    expect(artifactLead('| Floor | PRs |\n|---|---|')).toBe('Floor · PRs');
    expect(makeArtifacts(7, [{ title: 'T', markdown: '- **one**' }])).toEqual([{ id: '7-1', title: 'T', lead: 'one', markdown: '- **one**' }]);
  });

  it('leaves older bodies out of the snapshot past the budget', () => {
    const msg = (id: number, size: number): PhoneMessage => ({ id, from: 'ceo', text: '', at: id, artifacts: [{ id: `${id}-1`, title: 't', lead: 'l', markdown: 'x'.repeat(size) }] });
    const all = [msg(1, 50), msg(2, 50), { id: 3, from: 'manager', text: 'hi', at: 3 } as PhoneMessage, msg(4, 50)];
    const out = snapshotMessages(all, 120);
    expect(out[3].artifacts?.[0].markdown).toHaveLength(50);
    expect(out[1].artifacts?.[0].markdown).toHaveLength(50);
    expect(out[0].artifacts?.[0]).toEqual({ id: '1-1', title: 't', lead: 'l' });
    expect(out[2]).toBe(all[2]);
    expect(all[0].artifacts?.[0].markdown).toHaveLength(50); // the saved messages are untouched
  });

  it('keeps the newest step logs whole in the snapshot, older ones as their count and time (#150)', () => {
    const step = { label: 'Checking the floors', icon: '🏢', state: 'done' as const, ms: 5 };
    const msg = (id: number): PhoneMessage => ({ id, from: 'ceo', text: '', at: id, log: { steps: [step], count: 1, ms: 9 } });
    const all = [msg(1), msg(2), { id: 3, from: 'manager', text: 'hi', at: 3 } as PhoneMessage, msg(4)];
    const out = snapshotMessages(all, 0, 2);
    expect(out.map((m) => m.log?.steps.length)).toEqual([0, 1, undefined, 1]);
    expect(out[0].log).toEqual({ steps: [], count: 1, ms: 9 });
    expect(all[0].log?.steps).toHaveLength(1); // the saved messages are untouched
  });

  it('says attachments aloud by title, and names downloads', () => {
    expect(messageSpeech({ text: 'Done **today**.' })).toBe('Done today.');
    expect(messageSpeech({ text: 'Done.', artifacts: [{ id: '1-1', title: 'Plan', lead: '', markdown: '# Secret plan' }] })).toBe('Done. Plus an attachment: Plan.');
    expect(messageSpeech({ text: '', artifacts: [{ id: '1-1', title: 'A', lead: '' }, { id: '1-2', title: 'B', lead: '' }] })).toBe('Plus 2 attachments: A; B.');
    expect(artifactFileName('Floor 2: report!')).toBe('floor-2-report.md');
    expect(artifactFileName('🎉')).toBe('artifact.md');
  });
});

describe('suggestionsFor', () => {
  const ceo = (id: number, suggestions?: string[]): PhoneMessage => ({ id, from: 'ceo', text: 'q', at: id, ...(suggestions && { suggestions }) });
  it('offers only the latest CEO message, until the manager answers', () => {
    expect(suggestionsFor([ceo(1, ['Yes'])])?.id).toBe(1);
    expect(suggestionsFor([ceo(1, ['Yes']), { id: 2, from: 'office', text: 'n', at: 2 }])?.id).toBe(1);
    expect(suggestionsFor([ceo(1, ['Yes']), ceo(2)])).toBeNull();
    expect(suggestionsFor([ceo(1, ['Yes']), { id: 2, from: 'manager', text: 'Yes', at: 2 }])).toBeNull();
  });
});

describe('idea cards (#108)', () => {
  it('lifts one ```idea block out: its kind, title and the message Accept sends', () => {
    const p = parseCeoMessage('Done.\n\n```idea objective\nAdd an objective: no cut-off screens\nAdd an objective to floor 2: no screen cut off at 390 px.\n```');
    expect(p.text).toBe('Done.');
    expect(p.idea).toEqual({ kind: 'objective', title: 'Add an objective: no cut-off screens', message: 'Add an objective to floor 2: no screen cut off at 390 px.' });
  });

  it('sends the title when there is no message, and keeps a second idea in the text', () => {
    const p = parseCeoMessage('```idea research\nResearch: offline sync\n```\n\n```idea team\nGrow floor 1\n```');
    expect(p.idea).toEqual({ kind: 'research', title: 'Research: offline sync', message: 'Research: offline sync' });
    expect(p.text).toContain('```idea team');
  });

  it('leaves a broken block in the text as written', () => {
    for (const raw of ['```idea\nNo kind\n```', '```idea wishes\nUnknown kind\n```', '```idea plan\n\n```', `\`\`\`idea plan\n${'x'.repeat(101)}\n\`\`\``]) {
      const p = parseCeoMessage(raw);
      expect(p.idea).toBeUndefined();
      expect(p.text).toBe(raw);
    }
  });
});
