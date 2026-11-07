import { describe, expect, it } from 'vitest';
import { canListen } from './handsFree';
import { BARGE_MS, bargesIn, callClock, callStep, callStatus, inCall, isBackchannel, NO_CALL, sentenceAt, sentenceFraction, sentenceStarts, splitSentences, wantsMic, type Call, type CallEvent } from './voiceCall';

/** Runs events from no call, returning the last step and every effect along the way. */
function run(events: CallEvent[], from: Call = NO_CALL) {
  let call = from;
  const effects: string[] = [];
  const shown: string[] = [];
  for (const ev of events) {
    const r = callStep(call, ev);
    call = r.call;
    effects.push(...r.effects);
    shown.push(...r.show.map((n) => n.text));
  }
  return { call, effects, shown };
}

const started = run([{ type: 'start', now: 1000, id: 7 }, { type: 'connected', tapToTalk: '' }]).call;
const speaking = run([{ type: 'sent' }, { type: 'reply', id: 42, sentences: 3 }], started).call;

describe('starting a call', () => {
  it('works on a desktop with no chat on screen: the call listens where hands-free never did', () => {
    // Hands-free needs the phone open on the chat; the call doesn't ask what's on screen at all.
    expect(canListen({ enabled: true, phoneChat: false, micFree: true, draft: false, muted: false })).toBe(false);
    expect(inCall(started)).toBe(true);
    expect(wantsMic(started)).toBe(true);
    expect(started).toMatchObject({ id: 7, phase: 'listening', startedAt: 1000 });
  });

  it('greets once: starting again while it is on (a screen mounting again) keeps the same call', () => {
    const r = run([{ type: 'start', now: 1000, id: 7 }, { type: 'connected', tapToTalk: '' }, { type: 'start', now: 5000, id: 8 }, { type: 'start', now: 6000, id: 9 }]);
    expect(r.effects.filter((e) => e === 'greet')).toHaveLength(1);
    expect(r.call).toMatchObject({ id: 7, startedAt: 1000, phase: 'listening' });
  });

  it('falls back to tap-to-talk with the reason when the mic cannot listen by itself', () => {
    const r = run([{ type: 'start', now: 0, id: 1 }, { type: 'connected', tapToTalk: 'The browser blocked the microphone.' }]);
    expect(r.call.tapToTalk).toBe('The browser blocked the microphone.');
    expect(wantsMic(r.call)).toBe(false);
    expect(callStatus(r.call, 'Mimoun')).toBe('Tap Talk to speak');
    expect(run([{ type: 'mic-problem', why: 'No microphone' }], started).call.tapToTalk).toBe('No microphone');
  });
});

describe('what is shown over the call never restarts it', () => {
  it('keeps the same session, the reply and its sentence through anything but End', () => {
    const mid = run([{ type: 'sentence', index: 1 }], speaking).call;
    // Re-mounting call screens (an overlay, a page, the chat closed, the 3D/pocket switch) can only ask to start.
    const after = run([{ type: 'start', now: 9000, id: 99 }, { type: 'start', now: 9500, id: 100 }], mid);
    expect(after.effects).toEqual([]);
    expect(after.call).toBe(mid);
    expect(after.call).toMatchObject({ id: 7, phase: 'speaking', reply: { id: 42, sentence: 1 } });
  });
});

describe('turns', () => {
  it('listens, thinks after a send, speaks the reply, then listens again without a chime', () => {
    let r = run([{ type: 'sent' }], started);
    expect(r.call.phase).toBe('thinking');
    r = run([{ type: 'reply', id: 42, sentences: 3 }], r.call);
    expect(r.call).toMatchObject({ phase: 'speaking', reply: { id: 42, sentence: 0, sentences: 3 } });
    expect(wantsMic(r.call)).toBe(true); // listening for a barge-in
    r = run([{ type: 'reply-ended' }], r.call);
    expect(r.call).toMatchObject({ phase: 'listening', reply: null });
    expect(r.effects).toEqual([]);
  });

  it("hands the turn back when the voice couldn't read the reply", () => {
    expect(run([{ type: 'sent' }, { type: 'reply-ended' }], started).call.phase).toBe('listening');
  });
});

describe('barge-in', () => {
  it('stops the voice once real speech lasts a few hundred ms, and it becomes your turn', () => {
    const r = run(
      [
        { type: 'speech', now: 2000, text: 'wait' },
        { type: 'speech', now: 2000 + BARGE_MS, text: 'wait, actually' },
      ],
      speaking,
    );
    expect(r.effects).toEqual(['stop-voice']);
    expect(r.call).toMatchObject({ phase: 'listening', reply: null });
  });

  it('ignores a short noise, a gap-broken run and "mm-hm"', () => {
    expect(run([{ type: 'speech', now: 2000, text: 'hey' }], speaking).effects).toEqual([]);
    expect(
      run(
        [
          { type: 'speech', now: 2000, text: 'a' },
          { type: 'speech', now: 2600, text: 'b' },
        ],
        speaking,
      ).effects,
    ).toEqual([]);
    expect(
      run(
        [
          { type: 'speech', now: 2000, text: 'mm-hm' },
          { type: 'speech', now: 2500, text: 'mm-hm yeah' },
        ],
        speaking,
      ).effects,
    ).toEqual([]);
    expect(bargesIn(BARGE_MS, '')).toBe(true); // a recording's levels have no words
    expect(isBackchannel('Mm-hm.')).toBe(true);
    expect(isBackchannel('hold on')).toBe(false);
  });

  it('never interrupts while muted or paused', () => {
    const muted = run([{ type: 'mute' }], speaking).call;
    expect(run([{ type: 'speech', now: 0, text: 'stop' }, { type: 'speech', now: 400, text: 'stop now' }], muted).effects).toEqual([]);
  });
});

describe('controls', () => {
  it('skip moves to the next sentence and tells the voice', () => {
    const r = run([{ type: 'skip' }], speaking);
    expect(r.effects).toEqual(['skip-voice']);
    expect(r.call.reply?.sentence).toBe(1);
    expect(run([{ type: 'skip' }], started).effects).toEqual([]); // nothing to skip
  });

  it('mute turns the mic off and back on, keeping the call', () => {
    const muted = run([{ type: 'mute' }], started).call;
    expect(wantsMic(muted)).toBe(false);
    expect(muted.id).toBe(7);
    expect(wantsMic(run([{ type: 'mute' }], muted).call)).toBe(true);
  });

  it('pause stops the voice where it was and resume carries on from there', () => {
    const paused = run([{ type: 'sentence', index: 2 }, { type: 'pause' }], speaking);
    expect(paused.effects).toEqual(['pause-voice']);
    expect(wantsMic(paused.call)).toBe(false);
    const resumed = run([{ type: 'pause' }], paused.call);
    expect(resumed.effects).toEqual(['resume-voice']);
    expect(resumed.call.reply?.sentence).toBe(2);
  });

  it('end stops everything and only End does', () => {
    const r = run([{ type: 'end' }], speaking);
    expect(r.effects).toEqual(['stop-voice', 'release']);
    expect(inCall(r.call)).toBe(false);
    expect(r.call.phase).toBe('ended');
    // A new call is a new session.
    expect(run([{ type: 'start', now: 1, id: 8 }], r.call).call.id).toBe(8);
  });
});

describe('a background tab', () => {
  it('stops listening while away and listens again on return, in the same call', () => {
    const away = run([{ type: 'hidden' }], speaking).call;
    expect(wantsMic(away)).toBe(false);
    expect(run([{ type: 'speech', now: 0, text: 'hello' }, { type: 'speech', now: 500, text: 'hello there' }], away).effects).toEqual([]);
    const back = run([{ type: 'visible' }], away).call;
    expect(wantsMic(back)).toBe(true);
    expect(back).toMatchObject({ id: 7, reply: { id: 42 } });
  });
});

describe('notifications during a call', () => {
  const note = (text: string) => ({ type: 'note' as const, note: { level: 'info' as const, text } });

  it('shows them at once with no call on', () => {
    expect(run([note('PR #12 merged')]).shown).toEqual(['PR #12 merged']);
  });

  it('holds them while the call is on and releases them, in order, when it ends', () => {
    const during = run([note('merged'), note('QA failed')], started);
    expect(during.shown).toEqual([]);
    expect(during.call.held).toHaveLength(2);
    const ended = run([{ type: 'end' }], during.call);
    expect(ended.shown).toEqual(['merged', 'QA failed']);
    expect(ended.call.held).toEqual([]);
  });
});

describe('sentences', () => {
  const text = 'Two PRs merged. QA is on #12! Anything else?';

  it('splits a reply into sentences for skip', () => {
    expect(splitSentences(text)).toEqual(['Two PRs merged.', 'QA is on #12!', 'Anything else?']);
    expect(sentenceStarts(text)).toEqual([0, 16, 30]);
    expect(splitSentences('No end')).toEqual(['No end']);
  });

  it('maps a position in a recording to a sentence and back', () => {
    expect(sentenceAt(text, 0)).toBe(0);
    expect(sentenceAt(text, 0.5)).toBe(1);
    expect(sentenceAt(text, 1)).toBe(2);
    expect(sentenceFraction(text, 1)).toBeCloseTo(16 / text.length);
    expect(sentenceFraction('', 3)).toBe(0);
  });
});

describe('the call screen', () => {
  it('counts the call time like a phone', () => {
    expect(callClock(7_400)).toBe('0:07');
    expect(callClock(754_000)).toBe('12:34');
    expect(callClock(3_723_000)).toBe('1:02:03');
  });

  it('says what is happening', () => {
    expect(callStatus(speaking, 'Mimoun')).toBe('Mimoun is talking');
    expect(callStatus(run([{ type: 'pause' }], speaking).call, 'Mimoun')).toBe('Paused');
    expect(callStatus(run([{ type: 'mute' }], started).call, 'Mimoun')).toBe('Muted');
  });
});
