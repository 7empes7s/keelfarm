import { describe, expect, it } from 'vitest';
import { connectorName, groupUsed, matchPicks, pickText, toolCalls, usedLine } from './used.ts';

describe('what the CEO used', () => {
  it('groups skills, connectors and built-in tools by count', () => {
    const calls = toolCalls([
      { kind: 'tool', tool: 'Skill', text: '⏺ Skill pdf' },
      { kind: 'tool', tool: 'Skill', text: '⏺ Skill docx' },
      { kind: 'tool', tool: 'Skill', text: '⏺ Skill pdf' },
      { kind: 'tool', tool: 'mcp__claude_ai_Gmail__search_threads', text: '' },
      { kind: 'tool', tool: 'mcp__claude_ai_Gmail__get_thread', text: '' },
      { kind: 'tool', tool: 'mcp__office__company_status', text: '' },
      { kind: 'tool', tool: 'Read', text: '' },
      { kind: 'tool', tool: 'Read', text: '' },
      { kind: 'tool', tool: 'Grep', text: '' },
      { kind: 'result', text: 'ignored' },
    ]);
    const u = groupUsed(calls)!;
    expect(u.skills).toEqual(['docx', 'pdf']);
    expect(u.connectors).toEqual([
      { name: 'Gmail', tools: 2 },
      { name: 'Office', tools: 1 },
    ]);
    expect(u.tools).toEqual([
      { name: 'Read', count: 2 },
      { name: 'Grep', count: 1 },
    ]);
    expect(usedLine(u)).toBe('Used: 2 skills · Gmail · Office · 3 tools');
    expect(groupUsed([])).toBeNull();
  });

  it('names connectors for people and caps the line at two', () => {
    expect(connectorName('claude_ai_Google_Drive')).toBe('Google Drive');
    expect(connectorName('plugin_figma_figma')).toBe('Figma');
    expect(usedLine({ skills: [], connectors: [{ name: 'A', tools: 1 }, { name: 'B', tools: 1 }, { name: 'C', tools: 1 }], tools: [] })).toBe('Used: A · B +1');
  });

  it('"/" picks match by any part of the name, skills first', () => {
    const p = { skills: ['pdf', 'pptx', 'docx'], apps: ['Gmail', 'Google Docs'] };
    expect(matchPicks(p, 'p').map((x) => x.name)).toEqual(['pdf', 'pptx']);
    expect(matchPicks(p, 'doc').map((x) => x.name)).toEqual(['docx', 'Google Docs']);
    expect(pickText('skill', 'pdf')).toBe('Use the pdf skill: ');
    expect(pickText('app', 'Gmail')).toBe('Using Gmail: ');
  });
});
