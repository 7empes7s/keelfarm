import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { anthropicModels, codexModels, loadCatalog, localModels, opencodeModels, saveCatalog } from './modelCatalog.ts';
import { mergeCatalog } from '../shared/models.ts';

describe("the sources' answers", () => {
  it("reads Anthropic's list", () => {
    expect(anthropicModels({ data: [{ type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' }, { id: '' }], has_more: false })).toEqual([{ id: 'claude-opus-5-5', name: 'Claude Opus 5.5' }]);
    expect(anthropicModels({ error: 'nope' })).toEqual([]);
  });

  it("reads Codex's model/list, leaving out hidden models", () => {
    const result = { data: [{ id: 'gpt-6.1-sol', model: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol', isDefault: true }, { model: 'gpt-6-luna', displayName: 'GPT-6-Luna' }, { id: 'secret', hidden: true }] };
    expect(codexModels(result)).toEqual([
      { id: 'gpt-6.1-sol', name: 'GPT-6.1-Sol', isDefault: true },
      { id: 'gpt-6-luna', name: 'GPT-6-Luna', isDefault: undefined },
    ]);
  });

  it("reads `opencode models` and the local servers' lists", () => {
    expect(opencodeModels('anthropic/claude-opus-5-5\r\nopencode/big-pickle\n\nWarning: something\n')).toEqual([{ id: 'anthropic/claude-opus-5-5' }, { id: 'opencode/big-pickle' }]);
    expect(localModels({ models: [{ name: 'qwen3-coder:30b' }] })).toEqual(['qwen3-coder:30b']);
    expect(localModels({ object: 'list', data: [{ id: 'qwen/qwen3-coder-30b' }] })).toEqual(['qwen/qwen3-coder-30b']);
  });
});

describe('the cache', () => {
  it('keeps the catalog between starts, never its refreshing flag', async () => {
    const file = path.join(os.tmpdir(), `models-${process.pid}-${Date.now()}.json`);
    const c = mergeCatalog([{ cli: 'claude', models: null }], 7);
    await saveCatalog(file, { ...c, refreshing: true });
    expect(await loadCatalog(file)).toEqual(c);
    expect(await loadCatalog(`${file}.missing`)).toBeNull();
  });
});
