import { describe, expect, it } from 'vitest';
import { HUD_OPTIONS } from './hudOptions';
import { buildIndex, type IndexInput } from './searchIndex';

const input = (where: IndexInput['where']): IndexInput => ({ where, repos: [], agents: {}, qa: {}, messages: [] });

describe("the phone HUD's Options (#406)", () => {
  it('keeps every control that left the top bar', () => {
    // a control dropped from here leaves the phone with no way to it: remove one only if the manager asked
    expect(HUD_OPTIONS.map((o) => o.id)).toEqual(['overview', 'photo', 'switch', 'mute', 'captions', 'sound-settings', 'search', 'guide', 'chat-mode', 'sessions', 'coins', 'settings']);
  });

  it('finds each one with the search in the 3D office, and none in the 2D office', () => {
    const office = buildIndex(input('office'));
    for (const o of HUD_OPTIONS) expect(office.find((i) => i.id === `opt:${o.id}`)?.target).toEqual({ kind: 'option', id: o.id });
    expect(buildIndex(input('pocket')).some((i) => i.id.startsWith('opt:'))).toBe(false);
  });
});
