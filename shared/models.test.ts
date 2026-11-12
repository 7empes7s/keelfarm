import { describe, expect, it } from 'vitest';
import { CLAUDE_MODELS, effectiveModel, inCatalog, isClaudeModel, labelOf, localModel, mergeCatalog, modelAfterCliChange, modelLabel, modelProblem, OTHER_MODEL, pickerOptions, resolveAlias } from './models.ts';

const claudeOffice = { defaultCli: 'claude' as const, defaultModel: 'claude-sonnet-5' };
const codexOffice = { defaultCli: 'codex' as const, defaultModel: 'gpt-5.5-codex' };

describe('effectiveModel', () => {
  it("uses the worker's own model when it suits their agent", () => {
    expect(effectiveModel('opus', 'claude', claudeOffice, 'claude-opus-5-5')).toBe('opus');
    expect(effectiveModel('gpt-5.5', 'codex', claudeOffice, 'claude-opus-5-5')).toBe('gpt-5.5');
  });

  it("falls back to the office default only for the office's default agent", () => {
    expect(effectiveModel('', 'claude', claudeOffice, 'claude-opus-5-5')).toBe('claude-sonnet-5');
    expect(effectiveModel('', 'codex', codexOffice, 'claude-opus-5-5')).toBe('gpt-5.5-codex');
    expect(effectiveModel('', 'claude', codexOffice, 'claude-opus-5-5')).toBe('claude-opus-5-5');
    expect(effectiveModel('', 'opencode', claudeOffice, 'claude-opus-5-5')).toBe('');
  });

  it('never hands a model to an agent that would not understand it', () => {
    expect(effectiveModel('claude-opus-5-5', 'codex', claudeOffice, 'claude-opus-5-5')).toBe('');
    expect(effectiveModel('gpt-5.5', 'claude', claudeOffice, 'claude-opus-5-5')).toBe('claude-sonnet-5');
    expect(effectiveModel('', 'codex', { defaultCli: 'codex', defaultModel: 'claude-opus-5-5' }, 'claude-opus-5-5')).toBe('');
  });

  it("knows Claude Code's names and aliases", () => {
    expect(['claude-fable-5-1', 'Opus', 'sonnet', 'haiku', 'opusplan'].every(isClaudeModel)).toBe(true);
    expect(['gpt-5.5', 'opencode/big-pickle', 'o3', 'opencode/claude-sonnet-5'].some(isClaudeModel)).toBe(false);
  });
});

describe('localModel', () => {
  it('finds the local server in a model name, keeping the rest as the server names it', () => {
    expect(localModel('ollama/qwen3-coder:30b')).toMatchObject({ provider: { id: 'ollama' }, model: 'qwen3-coder:30b' });
    expect(localModel(' lmstudio/qwen/qwen3-coder-30b ')).toMatchObject({ provider: { id: 'lmstudio' }, model: 'qwen/qwen3-coder-30b' });
    expect(localModel('llama.cpp/default')?.provider.id).toBe('llamacpp');
    expect(localModel('omlx/Qwen3-8B')?.provider.id).toBe('omlx');
  });

  it('leaves hosted models alone', () => {
    for (const m of ['', 'gpt-5.5', 'anthropic/claude-opus-5-5', 'openai/gpt-5.5', 'ollama/']) expect(localModel(m)).toBeNull();
  });
});

const LIVE = mergeCatalog(
  [
    { cli: 'claude', models: [{ id: 'claude-opus-5-5', name: 'Claude Opus 5.5' }, { id: 'claude-sonnet-5', name: 'Claude Sonnet 5' }, { id: 'claude-opus-5', name: 'Claude Opus 5' }, { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' }] },
    { cli: 'codex', models: [{ id: 'gpt-6.1-sol', name: 'GPT-6.1-Sol', isDefault: true }, { id: 'gpt-6-astra', name: 'GPT-6-Astra' }] },
    { cli: 'opencode', models: null },
    { local: 'ollama', models: ['qwen3-coder'] },
  ],
  1000,
);

describe('mergeCatalog', () => {
  it("takes Anthropic's live list and adds Claude Code's aliases", () => {
    const claude = LIVE.entries.filter((e) => e.cli === 'claude');
    expect(claude.map((e) => e.id)).toEqual(['claude-opus-5-5', 'claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4-5-20251001', 'opus', 'sonnet', 'haiku']);
    expect(claude.every((e) => e.source === 'live' && e.checkedAt === 1000)).toBe(true);
    expect(claude[0].label).toBe('Opus 5.5');
  });

  it("falls back to the built-in list, marked built-in, when Anthropic's can't be read", () => {
    const c = mergeCatalog([{ cli: 'claude', models: null }], 5);
    expect(c.entries.map((e) => e.id)).toEqual([...CLAUDE_MODELS, 'opus', 'sonnet', 'haiku']);
    expect(c.entries.every((e) => e.source === 'built-in')).toBe(true);
  });

  it("lists a local server's models for Codex and OpenCode, nothing for an agent whose list failed", () => {
    expect(LIVE.entries.filter((e) => e.id === 'ollama/qwen3-coder').map((e) => e.cli)).toEqual(['codex', 'opencode']);
    expect(LIVE.entries.filter((e) => e.cli === 'opencode').map((e) => e.id)).toEqual(['ollama/qwen3-coder']);
  });
});

describe('model labels and aliases', () => {
  it('names models plainly', () => {
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5');
    expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    expect(modelLabel('claude-sonnet-5')).toBe('Sonnet 5');
  });

  it('resolves an alias to the newest of its family in the catalog', () => {
    expect(resolveAlias('opus', LIVE)).toBe('claude-opus-5-5');
    expect(resolveAlias('haiku', LIVE)).toBe('claude-haiku-4-5-20251001');
    expect(resolveAlias('claude-opus-5', LIVE)).toBe('claude-opus-5');
    expect(labelOf('opus', 'claude', LIVE)).toBe('Opus 5.5 (opus)');
  });
});

describe('model validation', () => {
  it("accepts the default and the agent's own models, refusing others with the valid ids", () => {
    expect(modelProblem(undefined, 'claude', LIVE)).toBeNull();
    expect(modelProblem('', 'codex', LIVE)).toBeNull();
    expect(modelProblem('sonnet', 'claude', LIVE)).toBeNull();
    expect(modelProblem('gpt-5.5-codex', 'codex', LIVE)).toContain('Valid: gpt-6.1-sol, gpt-6-astra, ollama/qwen3-coder');
    expect(modelProblem('claude-haiku-4-5', 'claude', LIVE)).toContain('claude-haiku-4-5-20251001');
    expect(modelProblem('gpt-6.1-sol', 'claude', LIVE)).not.toBeNull();
  });

  it("can't check an agent whose list is empty", () => {
    expect(inCatalog('anything', 'opencode', mergeCatalog([], 0))).toBe(true);
  });
});

describe('modelAfterCliChange', () => {
  it("keeps a model the new coding agent has, else resets it to the default", () => {
    expect(modelAfterCliChange('claude-opus-5-5', 'codex', LIVE)).toBe('');
    expect(modelAfterCliChange('ollama/qwen3-coder', 'opencode', LIVE)).toBe('ollama/qwen3-coder');
    expect(modelAfterCliChange('gpt-6-astra', 'claude', LIVE)).toBe('');
    expect(modelAfterCliChange('gpt-6-astra', 'codex', LIVE)).toBe('gpt-6-astra');
  });
});

describe('pickerOptions', () => {
  it('starts with the default named, marks the newest, ends with Other…', () => {
    const o = pickerOptions('claude', LIVE, 'claude-opus-5-5');
    expect(o[0]).toEqual({ value: '', label: 'Default (Opus 5.5)' });
    expect(o.find((x) => x.value === 'claude-opus-5-5')?.label).toBe('Opus 5.5 · newest');
    expect(o.find((x) => x.value === 'claude-opus-5')?.label).toBe('Opus 5');
    expect(o.at(-1)).toEqual({ value: OTHER_MODEL, label: 'Other…' });
    expect(pickerOptions('codex', LIVE, '')[0].label).toBe('Default (GPT-6.1-Sol)');
  });

  it("greys out a model the bundled Claude Code is too old for (#546)", () => {
    const catalog = mergeCatalog([{ cli: 'claude', models: [{ id: 'claude-fable-5-2' }, { id: 'claude-opus-5-5' }] }], 0);
    const old = pickerOptions('claude', catalog, '', '2.1.283 (Claude Code)');
    expect(old.find((x) => x.value === 'claude-fable-5-2')).toEqual({ value: 'claude-fable-5-2', label: 'Fable 5.2 · Needs Claude Code 2.1.290+: update the office', disabled: true });
    expect(old.find((x) => x.value === 'claude-opus-5-5')?.disabled).toBeUndefined();
    expect(pickerOptions('claude', catalog, '', '2.1.322 (Claude Code)').some((x) => x.disabled)).toBe(false);
    expect(pickerOptions('claude', catalog, '', null).some((x) => x.disabled)).toBe(false);
  });
});
