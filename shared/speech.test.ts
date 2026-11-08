import { describe, expect, it } from 'vitest';
import { SPEECH_MAX_CHARS, SPOKEN_MAX_CHARS, bookkeeping, briefSpeech, dayPart, messageSpeech, speechText, spokenLine, spokenOf, standupLine } from './speech.ts';

describe('speechText', () => {
  it('strips markdown', () => {
    expect(speechText('## Plan\n\n**Bold** move, *quietly* and __firmly__. Use `npm test`, ~~not~~ that.')).toBe('Plan. Bold move, quietly and firmly. Use npm test, not that.');
    expect(speechText('> quoted\n- one\n- two\n* three\n1. first')).toBe('quoted. one. two. three. 1. first.');
    expect(speechText('[the PR](https://github.com/a/b/pull/3) and ![shot](x.png)')).toBe('the PR and shot.');
    expect(speechText('Before\n```ts\nconst x = 1;\n```\nAfter')).toBe('Before. After.');
    expect(speechText('| a | b |\n|---|---|\n| 1 | 2 |')).toBe('a, b. 1, 2.');
    expect(speechText('<b>hi</b> there\n\n---\nbye')).toBe('hi there. bye.');
  });

  it('keeps snake_case and maths alone', () => {
    expect(speechText('Set max_retries to 2*3 now.')).toBe('Set max_retries to 2*3 now.');
  });

  it('drops emoji', () => {
    expect(speechText('✅ Merged 🎉🎉 by 👩🏽‍💻 today 🇿🇦!')).toBe('Merged by today!');
    expect(speechText('⚠️ Careful')).toBe('Careful.');
  });

  it('says issue numbers and links the way a person would', () => {
    expect(speechText('PR #42 closes #7.')).toBe('PR number 42 closes number 7.');
    expect(speechText('See https://github.com/acme/shop/pull/42, then www.example.com.')).toBe('See a link, then a link.');
    expect(speechText('Docs: <https://example.com/x?y=1>')).toBe('Docs: a link.');
  });

  it('cuts at a sentence end after about 1500 characters', () => {
    const sentence = 'The floor shipped another feature today. ';
    const long = sentence.repeat(60);
    const out = speechText(long);
    expect(out.length).toBeLessThanOrEqual(SPEECH_MAX_CHARS);
    expect(out.length).toBeGreaterThan(SPEECH_MAX_CHARS - sentence.length);
    expect(out.endsWith('today.')).toBe(true);
  });

  it('cuts at a word, with an ellipsis, when there is no sentence end to cut at', () => {
    const out = speechText('word '.repeat(400), 100);
    expect(out.length).toBeLessThanOrEqual(101);
    expect(out.endsWith('word…')).toBe(true);
  });

  it('leaves short text whole', () => {
    expect(speechText('Hello.')).toBe('Hello.');
    expect(speechText('')).toBe('');
  });
});

describe('the spoken summary (#282)', () => {
  const long = 'I looked at the terminal on your phone.\n\n- Paste fails\n- Keys have no names\n\n## Filed\n\n#278 and #279, see https://github.com/a/b/issues/278.';

  it('reads the spoken line when a message has one, and the whole text only when asked', () => {
    const m = { text: long, spoken: 'I filed two fixes for the terminal.', artifacts: [{ id: '1-1', title: 'Plan', lead: '' }] };
    expect(messageSpeech(m)).toBe('I filed two fixes for the terminal.');
    expect(messageSpeech(m, { whole: true })).toBe('I looked at the terminal on your phone. Paste fails. Keys have no names. Filed. number 278 and number 279, see a link. Plus an attachment: Plan.');
  });

  it('falls back to the first paragraph, at most three sentences', () => {
    expect(messageSpeech({ text: long })).toBe('I looked at the terminal on your phone.');
    expect(briefSpeech('One. Two! Three? Four. Five.')).toBe('One. Two! Three?');
    expect(briefSpeech('## Status\n\n> what you asked\n\nAll green. Nothing waits.\n\nMore later.')).toBe('All green. Nothing waits.');
    expect(briefSpeech('```ts\nx\n```\n\nDone.')).toBe('Done.');
    const one = briefSpeech('word '.repeat(2000));
    expect(one.length).toBeLessThanOrEqual(SPEECH_MAX_CHARS + 1);
  });

  it('never says "#", markdown or links, and stays short', () => {
    const said = spokenLine('**Merged** #278 and `#279` today, see [the PR](https://x.y/z) and https://github.com/a/b/pull/3. C# too.');
    expect(said).toBe('Merged 278 and 279 today, see the PR and. C too.');
    expect(said).not.toMatch(/[#*`[\]]|https?:|a link/);
    expect(spokenLine('This is long. '.repeat(40)).length).toBeLessThanOrEqual(SPOKEN_MAX_CHARS);
  });
});

describe('what a CEO message says aloud (#282)', () => {
  it('never speaks bookkeeping', () => {
    for (const filler of ["I've answered message 1865 on your phone.", 'Both messages are answered on your phone.', 'Replied in the chat.', 'All three messages answered.']) expect(bookkeeping(filler), filler).toBe(true);
    for (const news of ['I filed two fixes for the terminal.', 'Floor 2 merged the login page, and QA passed it.', 'Your message about the phone made me check the terminal.']) expect(bookkeeping(news), news).toBe(false);
  });

  it('speaks the spoken line, the fallback, or nothing', () => {
    expect(spokenOf({ text: 'Done.', spoken: 'I filed two fixes.' }, false)).toEqual({ spoken: 'I filed two fixes.' });
    expect(spokenOf({ text: 'Done.', spoken: 'I filed two fixes.' }, true)).toEqual({ spoken: 'I filed two fixes.' });
    expect(spokenOf({ text: 'Floor 2 shipped the login page.' }, false)).toEqual({});
    expect(spokenOf({ text: 'Floor 2 shipped the login page.', spoken: "I've answered message 12 on your phone." }, false)).toEqual({});
    // A turn's closing text after its replies: silent unless it has a useful spoken line of its own.
    expect(spokenOf({ text: 'Both messages are answered on your phone.' }, true)).toEqual({ silent: true });
    expect(spokenOf({ text: 'Both are done.', spoken: 'Both messages are answered.' }, true)).toEqual({ silent: true });
    expect(spokenOf({ text: "I've answered message 1865 on your phone." }, false)).toEqual({ silent: true });
  });
});

describe('standupLine', () => {
  it('greets the team for the part of the day and counts the new issues', () => {
    expect(standupLine(3, 'morning')).toBe('Morning team, three new features today!');
    expect(standupLine(1, 'afternoon')).toBe('Afternoon team, one new feature today!');
    expect(standupLine(12, 'evening')).toBe('Evening team, a pile of new features today!');
    expect(standupLine(0, 'morning')).toBe('Morning team, one new feature today!');
  });

  it('splits the day into morning, afternoon and evening', () => {
    expect([4, 5, 11.9, 12, 16.9, 17, 23].map(dayPart)).toEqual(['evening', 'morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening']);
  });
});
