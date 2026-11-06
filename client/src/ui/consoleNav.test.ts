import { describe, expect, it } from 'vitest';
import { GROUPS, hashFor, opening, parseHash, resolve, search, SECTIONS, sectionsIn } from './consoleNav';

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
});
