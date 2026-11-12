import { describe, expect, it } from 'vitest';
import { headMore, headTools, shortName, type HeadTool } from './headBar';

const ALL_TABS = ['company', 'chat', 'kanban', 'team', 'approvals'] as const;
const state = { muted: false, captions: false, browserFull: false, chatMode: false };

describe("pocket mode's top bar (#588)", () => {
  it('keeps a short form of a long company name, never one letter', () => {
    expect(shortName('TechInsiderBytes')).toBe('TIB');
    expect(shortName('Acme Robotics Labs')).toBe('ARL');
    expect(shortName('blue-sky_studio')).toBe('BSS');
    expect(shortName('cubefarm')).toBe('cubefarm');
    expect(shortName('Acme Inc')).toBe('Acme Inc');
    expect(shortName('Supercalifragilistic')).toBe('Supercal');
    expect(shortName('  ')).toBe('');
    for (const n of ['TechInsiderBytes', 'Ab', 'X Y', 'Longcompanyname']) expect(shortName(n).length).toBeGreaterThan(1);
  });

  it('folds only the secondary actions on a wide screen; notifications stay a button', () => {
    for (const tab of ALL_TABS) {
      const tools = headTools({ wide: true, tab, canFull: true });
      expect(tools.find((t) => t.tool === 'notifications')?.fold).toBe(false);
      for (const t of tools) if (t.tool !== 'notifications') expect(t.fold, t.tool).toBe(true);
    }
  });

  it('never folds on a phone, where the header already fits', () => {
    for (const tab of ALL_TABS) expect(headTools({ wide: false, tab, canFull: true }).some((t) => t.fold)).toBe(false);
  });

  it('puts every folded action in the ⋯ menu, so each stays one tap away', () => {
    for (const tab of ALL_TABS)
      for (const canFull of [true, false]) {
        const tools = headTools({ wide: true, tab, canFull });
        const menu = headMore(tools, state).map((m) => m.tool);
        expect(menu).toEqual(tools.filter((t) => t.fold).map((t) => t.tool));
      }
    const every: HeadTool[] = ['search', 'sound', 'captions', 'fullScreen', 'info', 'chatMode'];
    expect(headMore(headTools({ wide: true, tab: 'company', canFull: true }), state).map((m) => m.tool)).toEqual(every);
  });

  it('labels the menu with what a tap does now', () => {
    const labels = (s: typeof state) => headMore(headTools({ wide: true, tab: 'company', canFull: true }), s).map((m) => m.label);
    expect(labels(state)).toEqual(['Search everything', 'Mute sound', 'Turn captions on', 'Full screen', 'What can I do here?', 'Chat mode: turn on']);
    expect(labels({ muted: true, captions: true, browserFull: true, chatMode: true })).toEqual(['Search everything', 'Unmute sound', 'Turn captions off', 'Exit full screen', 'What can I do here?', 'Chat mode: turn off']);
  });

  it('leaves out what the screen has no use for: full screen without the API, ⓘ on the chat', () => {
    const tools = (tab: (typeof ALL_TABS)[number], canFull: boolean) => headTools({ wide: true, tab, canFull }).map((t) => t.tool);
    expect(tools('company', false)).not.toContain('fullScreen');
    expect(tools('chat', true)).not.toContain('info');
    expect(headTools({ wide: false, tab: 'chat', canFull: true }).map((t) => t.tool)).toEqual(['sound']);
    expect(headTools({ wide: false, tab: 'team', canFull: true }).map((t) => t.tool)).toEqual(['search', 'notifications', 'sound', 'info']);
  });
});
