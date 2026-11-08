import { describe, expect, it } from 'vitest';
import { CHART_GROUPS } from '../../client/src/ui/chartPromptList.ts';
import { parseCeoMessage } from '../../shared/chatParts.ts';
import { demoChartAnswer } from './charts.ts';
import './index.ts';
import { ceoReply, type CeoKit } from './registry.ts';

describe("the demo CEO's answers to the chat's 📊 prompts (#270)", () => {
  it('answers every chart prompt with a chart or dashboard (money ones with the money dashboard)', () => {
    for (const { text } of CHART_GROUPS.flatMap((g) => g.prompts)) {
      if (text === "What's everyone working on?") continue; // the demo CEO's status report answers it
      const reply = demoChartAnswer(text);
      expect(reply, text).not.toBeNull();
      const p = parseCeoMessage(reply!);
      expect(p.visuals?.length, text).toBeGreaterThan(0);
      expect(p.text, text).not.toContain('{');
    }
  });

  it('leaves other messages to the rest of the demo', () => {
    expect(demoChartAnswer('Plan the next milestone')).toBeNull();
  });

  it("answers before the demo's files, so the seeded chat's attachment never turns a prompt into a PDF", async () => {
    const kit = { text: 'Memory per agent', s: { floors: [] }, use: async () => '', scale: async () => '' } as unknown as CeoKit;
    expect(await ceoReply(kit, true)).toContain('server:byAgent');
  });
});
