import { describe, expect, it } from 'vitest';
import { cleanSwitches, costLabel, groupItems, itemState, mergeSwitches, officeItems, sessionTools, setSwitch, toolArgsLine, toolSettings, type ToolItem } from './tooling';

const canva: ToolItem = { id: 'plugin:canva@official', kind: 'plugin', name: 'canva', description: 'Designs in Canva.', source: 'official', cost: { tools: 3 }, contents: { skills: ['canva:brand'], commands: [], agents: [], mcp: ['canva'] } };
const canvaMcp: ToolItem = { id: 'mcp:plugin_canva_canva', kind: 'mcp', name: 'canva (canva)', description: 'MCP server.', source: 'plugin canva', cost: null, plugin: canva.id };
const notion: ToolItem = { id: 'mcp:notion', kind: 'mcp', name: 'notion', description: 'Notion pages.', source: 'user', cost: null };
const pdf: ToolItem = { id: 'skill:pdf', kind: 'skill', name: 'pdf', description: 'Reads PDFs.', source: 'user', cost: { tools: 1, tokens: 12 } };
const items = [canva, canvaMcp, notion, pdf];

describe('scopes', () => {
  it("lets an agent's or the CEO's own switch override Everyone's", () => {
    const everyone = { 'mcp:notion': false, 'skill:pdf': false };
    const own = { 'mcp:notion': true };
    expect(mergeSwitches(everyone, own)).toEqual({ 'mcp:notion': true, 'skill:pdf': false });
    expect(mergeSwitches(everyone, undefined)).toEqual(everyone);
    expect(itemState(notion, 'agent', everyone, own)).toEqual({ on: true, from: 'own' });
    expect(itemState(pdf, 'agent', everyone, own)).toEqual({ on: false, from: 'everyone' });
    expect(itemState(canva, 'ceo', everyone, own)).toEqual({ on: true, from: 'default' });
  });

  it('keeps locked items as the office needs them, whatever the switches say', () => {
    const office = officeItems().find((i) => i.id === 'mcp:office')!;
    expect(itemState(office, 'ceo', { 'mcp:office': false }, { 'mcp:office': false })).toMatchObject({ on: true, from: 'locked' });
    const bash = officeItems().find((i) => i.id === 'tool:Bash')!;
    expect(itemState(bash, 'ceo', { 'tool:Bash': true }).on).toBe(false);
    expect(itemState(bash, 'agent', { 'tool:Bash': false }).on).toBe(true);
  });

  it('cleans what is saved or sent, and null follows the scope above', () => {
    expect(cleanSwitches({ 'mcp:a': false, 'skill:b': true, nope: false, 'mcp:c': 'off' })).toEqual({ 'mcp:a': false, 'skill:b': true });
    expect(cleanSwitches(null)).toEqual({});
    expect(toolSettings({ everyone: {}, ceo: {} }, { everyone: { 'mcp:a': false } })).toEqual({ everyone: { 'mcp:a': false }, ceo: {} });
    expect(setSwitch({ 'mcp:a': false }, 'mcp:a', null)).toEqual({});
    expect(setSwitch({}, 'mcp:a', false)).toEqual({ 'mcp:a': false });
  });
});

describe('sessionTools', () => {
  it('turns a disabled MCP server into mcp__<name>__* and a skill into Skill(<name>)', () => {
    expect(sessionTools(items, 'agent', { 'mcp:notion': false, 'skill:pdf': false, 'tool:WebSearch': false })).toEqual({ disallowed: ['Skill(pdf)', 'WebSearch', 'mcp__notion__*'], disabledPlugins: [] });
  });

  it('turns a plugin off through enabledPlugins, and its servers with it', () => {
    expect(sessionTools(items, 'agent', { 'plugin:canva@official': false, 'mcp:plugin_canva_canva': false })).toEqual({ disallowed: [], disabledPlugins: ['canva@official'] });
    expect(sessionTools(items, 'agent', { 'mcp:plugin_canva_canva': false })).toEqual({ disallowed: ['mcp__plugin_canva_canva__*'], disabledPlugins: [] });
  });

  it("never removes the office's own servers, nor adds tools the office already disables", () => {
    const t = sessionTools(items, 'ceo', { 'mcp:office': false, 'mcp:playwright': false, 'tool:Bash': false, 'tool:AskUserQuestion': false, 'mcp:notion': false });
    expect(t.disallowed).toEqual(['mcp__notion__*']);
    expect(sessionTools([], 'agent', { 'mcp:office': false, 'mcp:playwright': false }).disallowed).toEqual([]);
  });

  it('works from the switch ids before the inventory is scanned', () => {
    expect(sessionTools([], 'agent', { 'mcp:notion': false, 'mcp:notion2': true })).toEqual({ disallowed: ['mcp__notion__*'], disabledPlugins: [] });
  });

  it('logs as a command line', () => {
    expect(toolArgsLine({ disallowed: ['mcp__notion__*'], disabledPlugins: ['canva@official'] })).toBe('--settings {"enabledPlugins":{"canva@official":false}} --disallowedTools … mcp__notion__*');
    expect(toolArgsLine({ disallowed: [], disabledPlugins: [] })).toBe('');
  });
});

describe('the screen', () => {
  it('groups in order and searches names, descriptions and plugin contents', () => {
    expect(groupItems(items, '').map((g) => g.kind)).toEqual(['plugin', 'skill', 'mcp']);
    expect(groupItems(items, 'brand').flatMap((g) => g.items.map((i) => i.id))).toEqual(['plugin:canva@official']);
    expect(groupItems(items, 'NOTION pages').flatMap((g) => g.items.map((i) => i.id))).toEqual(['mcp:notion']);
  });

  it('labels the rough cost', () => {
    expect(costLabel(canva)).toBe('3 entries');
    expect(costLabel(pdf)).toBe('1 skill · ≈12 tokens');
    expect(costLabel(notion)).toBe('');
  });
});
