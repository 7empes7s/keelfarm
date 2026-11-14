import { describe, expect, it } from 'vitest';
import { cleanHeard, noFillers } from './fillers';

describe('filler words (msg 4621)', () => {
  it("cleans the manager's transcripts: fillers and stutter repeats go, the meaning stays", () => {
    expect(cleanHeard('this is, uh... this is, uh, supposed to work')).toBe('This is supposed to work');
    // msg 4603, as the call heard it
    expect(cleanHeard("um at least this is, uh, very better working now, uh, I'm asking Mimoun is repetitive, and I I don't wanna hear it ever again")).toBe("At least this is very better working now I'm asking Mimoun is repetitive, and I don't wanna hear it ever again");
    expect(cleanHeard('Hmm. Och, mm, stop the filler words.')).toBe('Stop the filler words.');
    expect(cleanHeard('uh')).toBe('');
    expect(cleanHeard('Summer hummus erosion')).toBe('Summer hummus erosion'); // words that only contain the sounds stay
  });

  it('takes fillers out of every spoken line', () => {
    expect(noFillers('Well… uh, two merges today, um, and QA is mm fine.')).toBe('Two merges today and QA is fine.');
    expect(noFillers('Floor 4 is quiet.')).toBe('Floor 4 is quiet.');
    for (const s of ['Uh, hi.', 'Hmm, let me see. Three open issues.', 'Er, done.']) expect(noFillers(s)).not.toMatch(/\b(uh|um|er|mm|hmm|och)\b/i);
  });
});
