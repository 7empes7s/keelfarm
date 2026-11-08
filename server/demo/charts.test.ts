import { describe, expect, it } from 'vitest';
import { CHART_GROUPS } from '../../client/src/ui/chartPromptList.ts';
import { parseCeoMessage } from '../../shared/chatParts.ts';
import { demoChartAnswer } from './charts.ts';
import { demoMoneyAnswer } from './ceo.ts';

describe("the demo CEO's answers to the chat's 📊 prompts (#270)", () => {
  it('answers every chart prompt with a chart or dashboard (money ones through the money answer)', () => {
    for (const { text } of CHART_GROUPS.flatMap((g) => g.prompts)) {
      if (text === "What's everyone working on?") continue; // the demo CEO's status report answers it
      const reply = demoChartAnswer(text, ['Ada', 'Grace']) ?? (/\b(money|costs?)\b/i.test(text) ? demoMoneyAnswer() : null);
      expect(reply, text).not.toBeNull();
      const p = parseCeoMessage(reply!);
      expect(p.visuals?.length, text).toBeGreaterThan(0);
      expect(p.text, text).not.toContain('{');
    }
  });

  it('leaves other messages to the rest of the demo', () => {
    expect(demoChartAnswer('Plan the next milestone', [])).toBeNull();
  });
});
