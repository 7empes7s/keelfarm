import { describe, expect, it } from 'vitest';
import { echoOf, micProcessingOff } from './callEcho';

// A reply the agent really said on a call, and what the browser's recognition heard of it through the speaker (#682).
const REPLY = "Sure. QA passed two pull requests this morning, and one is waiting on the CEO's review.";
const HEARD = 'QA passed 2 pull requests this morning and one is waiting on the CEOs review';

describe('echoOf', () => {
  it("drops the agent's own reply heard back through the mic", () => {
    expect(echoOf(HEARD, [REPLY])).toBe(true);
    expect(echoOf('waiting on the CEOs review', ['Something older.', REPLY])).toBe(true);
  });

  it('keeps what the manager really said', () => {
    expect(echoOf('Why is QA so slow this week?', [REPLY])).toBe(false);
    expect(echoOf('yes', [REPLY])).toBe(false);
    expect(echoOf('no stop that, merge the review one', [REPLY])).toBe(false);
    expect(echoOf(HEARD, [])).toBe(false);
  });
});

describe('micProcessingOff', () => {
  it("names the browser's mic processing that isn't applied", () => {
    expect(micProcessingOff({ echoCancellation: true, noiseSuppression: true, autoGainControl: true })).toEqual([]);
    expect(micProcessingOff({ echoCancellation: false, noiseSuppression: true })).toEqual(['echoCancellation', 'autoGainControl']);
  });
});
