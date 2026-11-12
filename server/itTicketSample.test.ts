import { describe, expect, it } from 'vitest';
import { wantsTicketSample } from './itTicketSample.ts';

describe('the demo IT tickets sample', () => {
  it('seeds only a fresh, normal-sized demo office', () => {
    expect(wantsTicketSample(true, 2, 0)).toBe(true);
    expect(wantsTicketSample(true, 2, 1)).toBe(false);
    expect(wantsTicketSample(false, 2, 0)).toBe(false);
  });

  it('leaves the big company out, so its snapshot stays in server/scale.test.ts budget', () => {
    expect(wantsTicketSample(true, 10, 0)).toBe(false);
  });
});
