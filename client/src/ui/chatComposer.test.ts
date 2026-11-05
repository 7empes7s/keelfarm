import { describe, expect, it } from 'vitest';
import { RESEARCH_PREFIX } from '../../../shared/chat';
import { composerActions, QUICK } from './chatComposer';

describe("the chat's + sheet", () => {
  it('offers the camera only on a touch screen, then files, research and the quick prompts', () => {
    expect(composerActions('', false).map((a) => a.id)).toEqual(['file', 'research', ...QUICK.map((q) => `quick:${q}`)]);
    expect(composerActions('', true)[0].id).toBe('camera');
  });

  it('enables Research only for typed text that is not a research request already', () => {
    const research = (text: string) => composerActions(text, false).find((a) => a.id === 'research')!.disabled;
    expect(research('')).toBe(true);
    expect(research('   ')).toBe(true);
    expect(research('Which charting library?')).toBe(false);
    expect(research(`${RESEARCH_PREFIX}charts`)).toBe(true);
  });
});
