import { describe, expect, it } from 'vitest';
import { GROUPS, hashFor, opening, parseHash, resolve, search, SECTIONS, sectionRow, sectionsIn, stepTab, TEST_LAB_SECTION } from './consoleNavRules';

describe('the console map', () => {
  it('has a handful of top tabs, each with sections, and unique section ids', () => {
    expect(GROUPS.length).toBeLessThanOrEqual(6);
    for (const g of GROUPS) expect(sectionsIn(g.id, 'office').length).toBeGreaterThan(1);
    expect(new Set(SECTIONS.map((s) => s.id)).size).toBe(SECTIONS.length);
  });

  it('opens the old tab names where they now live', () => {
    expect(resolve('access', 'office')?.group).toBe('settings');
    expect(resolve('tools', 'office')?.group).toBe('ceo');
    expect(resolve('timelapse', 'office')?.group).toBe('history');
    expect(resolve('settings', 'office')?.id).toBe('agents');
    expect(resolve('settings', 'office', { settings: 'cloud-agents' })?.id).toBe('cloud-agents');
    expect(resolve('timelapse', 'pocket')).toBeUndefined(); // 3D only
  });

  it('reads and writes deep links', () => {
    const cloud = parseHash('#settings/cloud-agents', 'office');
    expect(cloud?.id).toBe('cloud-agents');
    expect(hashFor(cloud!)).toBe('#settings/cloud-agents');
    expect(parseHash('#work/cloud-agents', 'office')).toBeUndefined();
    expect(parseHash('#settings/pocket', 'office')).toBeUndefined();
    expect(parseHash('', 'office')).toBeUndefined();
  });

  it('opens what was asked for, else the link, else the last section, else Floors', () => {
    const r = { group: 'settings' as const, sections: { settings: 'voice' } };
    expect(opening('team', '#settings/about', 'office', r).id).toBe('team');
    expect(opening(undefined, '#settings/about', 'office', r).id).toBe('about');
    expect(opening(undefined, '', 'office', r).id).toBe('voice');
    expect(opening(undefined, '', 'office', { sections: {} }).id).toBe('floors');
  });

  it("finds a setting by its label, whatever the case and word order", () => {
    expect(search('box size', 'office')[0]).toMatchObject({ label: 'Box size', section: { id: 'cloud-agents' } });
    expect(search('NAME dog', 'office')[0].section.id).toBe('office');
    expect(search('accessibility', 'office')[0]).toMatchObject({ label: 'Accessibility', section: { id: 'access' } });
    expect(search('  ', 'office')).toEqual([]);
    expect(search('Open the 3D office', 'office')).toEqual([]); // pocket mode's only
  });

  it("puts a group's sections in the row under the top tabs, and no row for a group of one (#199)", () => {
    expect(sectionRow('work', 'office').map((s) => s.id)).toEqual(['floors', 'issues', 'team']);
    expect(sectionRow('work', 'pocket').map((s) => s.id)).toEqual(['floors', 'team']);
    expect(sectionRow('history', 'pocket').map((s) => s.id)).toEqual(['history', 'daily-log']); // no time-lapse on a phone
  });

  it('shows Team in the Settings row too, beside Agents, as the same section (#246)', () => {
    for (const where of ['office', 'pocket'] as const) {
      const ids = sectionRow('settings', where).map((s) => s.id);
      expect(ids.slice(0, 2)).toEqual(['agents', 'team']);
      expect(sectionRow('work', where).map((s) => s.id)).toContain('team');
    }
    expect(resolve('settings', 'office')?.id).toBe('agents'); // Settings still opens on Agents
    const team = parseHash('#settings/team', 'office');
    expect(team).toMatchObject({ id: 'team', group: 'settings' });
    expect(hashFor(team!)).toBe('#settings/team');
    expect(resolve('settings', 'office', { settings: 'team' })).toBe(team); // the row's tab stays picked
    expect(resolve('team', 'office')?.group).toBe('work');
    expect(parseHash('#work/team', 'office')?.group).toBe('work');
  });

  it("finds Team by its name, 'Add an agent' and 'agent'", () => {
    expect(search('Team', 'office')[0]).toMatchObject({ label: 'Team', section: { id: 'team' } });
    expect(search('add an agent', 'pocket')[0]).toMatchObject({ label: 'Add an agent', section: { id: 'team' } });
    expect(search('agent', 'office').map((h) => h.section.id)).toContain('team');
  });

  it('keeps every section within one tap of the Settings row, the Work tab the console first opens on, or the top tabs, plus one row tap for the rest as before #224', () => {
    for (const where of ['office', 'pocket'] as const) {
      const oneTap = new Set([...sectionRow('settings', where), ...sectionRow('work', where), ...GROUPS.map((g) => sectionsIn(g.id, where)[0])].map((s) => s.id));
      // Each of these is its top tab plus one tap in that tab's row, as it was in the side column before #224.
      const tabThenRow = ['charter', 'map', 'ceo-settings', 'tools', 'daily-log', 'timelapse'];
      for (const s of SECTIONS) {
        if (s.only && s.only !== where) continue;
        if (oneTap.has(s.id)) continue;
        expect(tabThenRow, s.id).toContain(s.id);
        expect(sectionRow(s.group, where).map((x) => x.id), s.id).toContain(s.id);
      }
    }
    expect(opening(undefined, '', 'office', { sections: {} }).group).toBe('work');
  });

  it('moves between tabs with the arrow keys, wrapping, and Home and End', () => {
    expect(stepTab(0, 3, 'ArrowRight')).toBe(1);
    expect(stepTab(2, 3, 'ArrowRight')).toBe(0);
    expect(stepTab(0, 3, 'ArrowLeft')).toBe(2);
    expect(stepTab(1, 3, 'Home')).toBe(0);
    expect(stepTab(1, 3, 'End')).toBe(2);
    expect(stepTab(1, 3, 'Enter')).toBeUndefined();
    expect(stepTab(0, 0, 'ArrowRight')).toBeUndefined();
  });
});

describe('the test lab screen', () => {
  it('opens the section that holds the Test lab card', () => {
    expect(TEST_LAB_SECTION).toBe(search('Test lab', 'office').find((h) => h.label === 'Test lab')?.section.id);
  });
});
