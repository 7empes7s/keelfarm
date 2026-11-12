import { describe, expect, it } from 'vitest';
import { checkRequest, checkResult, envPairs, foundView, importName, importSource, jsonKeys, keyScanText, mergeFound, providerForVar, scanSummary, sourceLabel, type FoundKey } from './keyScan.ts';

const GEMINI = 'AIzaSyFAKE-gemini-key-000000000wxyz';

describe('which provider a variable is', () => {
  it.each([
    ['GEMINI_API_KEY', 'gemini'],
    ['GOOGLE_API_KEY', 'gemini'],
    ['OPENAI_API_KEY', 'openai'],
    ['OPENROUTER_API_KEY', 'openrouter'],
    ['GITHUB_TOKEN', 'github'],
    ['GROQ_API_KEY', 'groq'],
    ['CEREBRAS_API_KEY', 'cerebras'],
    ['CEREBRAS_API_KEY_PAID', 'cerebras'],
    ['CLOUDFLARE_API_TOKEN', 'cloudflare'],
    ['NVIDIA_NIM_API_KEY', 'nvidia'],
    ['AIHUBMIX_API_KEY', 'aihubmix'],
    ['ANTHROPIC_API_KEY', 'anthropic'],
    ['VAST_API_KEY', 'other'],
    ['OPENCODE_ZEN_KEY', 'other'],
    ['OPENCODE_GO_API_KEY', 'other'],
    ['SOME_SERVICE_TOKEN', 'other'],
  ])('%s → %s', (name, provider) => expect(providerForVar(name)).toBe(provider));

  it.each(['LITELLM_MASTER_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'CF_API_BASE', 'DATABASE_URL', 'PORT', 'NODE_ENV'])('%s is not a key to import', (name) => expect(providerForVar(name)).toBeNull());
});

describe('reading config files', () => {
  it('reads an env file: export, quotes, comments, and skips placeholders', () => {
    const text = ['# old LiteLLM', `export GEMINI_API_KEY="${GEMINI}"`, "OPENAI_API_KEY='sk-proj-abc123456789'", 'GROQ_API_KEY=gsk_1234567890 # paid', 'EMPTY_TOKEN=', 'REF_TOKEN=${OTHER}', 'PORT=4000'].join('\n');
    expect(envPairs(text)).toEqual([
      ['GEMINI_API_KEY', GEMINI],
      ['OPENAI_API_KEY', 'sk-proj-abc123456789'],
      ['GROQ_API_KEY', 'gsk_1234567890'],
      ['PORT', '4000'],
    ]);
  });

  it("reads OpenCode's provider block and auth.json, and plain env-style JSON", () => {
    const config = { provider: { openrouter: { options: { apiKey: 'sk-or-v1-aaaa1111' } }, google: { options: { apiKey: '{env:GOOGLE_API_KEY}' } } } };
    const auth = { groq: { type: 'api', key: 'gsk_bbbb2222' }, 'github-copilot': { type: 'oauth', refresh: 'ghr_x', access: 'gho_y' } };
    expect(jsonKeys(config)).toEqual([['OPENROUTER_API_KEY', 'sk-or-v1-aaaa1111']]);
    expect(jsonKeys(auth)).toEqual([['GROQ_API_KEY', 'gsk_bbbb2222']]);
    expect(jsonKeys({ env: { CEREBRAS_API_KEY: 'csk-cccc3333' } })).toEqual([['CEREBRAS_API_KEY', 'csk-cccc3333']]);
  });

  it('names the project a file came from', () => {
    expect(sourceLabel('etc/litellm/litellm.env')).toBe('LiteLLM litellm.env');
    expect(sourceLabel('opt/newsbites/.env')).toBe('NewsBites .env');
    expect(sourceLabel('root/.openclaw/config.json')).toBe('Mimule config.json');
    expect(sourceLabel('srv/whatever/app/.env.local')).toBe('app .env.local');
  });
});

describe('merging what was found', () => {
  it('one row per key: the same value found twice keeps both sources, a key already saved is marked', () => {
    const rows = mergeFound(
      [
        { variable: 'GEMINI_API_KEY', value: GEMINI, source: 'LiteLLM litellm.env' },
        { variable: 'GOOGLE_API_KEY', value: GEMINI, source: 'NewsBites .env' },
        { variable: 'OPENAI_API_KEY', value: 'sk-proj-saved-0000aaaa', source: 'LiteLLM litellm.env' },
        { variable: 'VAST_API_KEY', value: 'vast-1234567890', source: 'LiteLLM litellm.env' },
        { variable: 'LITELLM_MASTER_KEY', value: 'sk-master-1234567', source: 'LiteLLM litellm.env' },
      ],
      [{ value: 'sk-proj-saved-0000aaaa', label: 'OpenAI API' }],
    );
    expect(rows.map((r) => [r.provider, r.sources, r.savedAs ?? null])).toEqual([
      ['gemini', ['LiteLLM litellm.env', 'NewsBites .env'], null],
      ['openai', ['LiteLLM litellm.env'], 'OpenAI API'],
      ['other', ['LiteLLM litellm.env'], null],
    ]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
  });

  it('a value under an unknown name and a known one is the known provider', () => {
    const rows = mergeFound(
      [
        { variable: 'MY_TOKEN', value: GEMINI, source: 'a' },
        { variable: 'GEMINI_API_KEY', value: GEMINI, source: 'b' },
      ],
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: 'gemini', variable: 'GEMINI_API_KEY', sources: ['a', 'b'] });
  });
});

describe('testing a key before keeping it', () => {
  it("OpenRouter's check is the authenticated key endpoint, never the public /models", () => {
    const req = checkRequest('openrouter', 'sk-or-v1-dead');
    expect(req).toEqual({ kind: 'http', url: 'https://openrouter.ai/api/v1/key', headers: { Authorization: 'Bearer sk-or-v1-dead' } });
  });

  it.each([
    ['gemini', 'generativelanguage.googleapis.com/v1beta/models', 'x-goog-api-key'],
    ['openai', 'api.openai.com/v1/models', 'Authorization'],
    ['groq', 'api.groq.com/openai/v1/models', 'Authorization'],
    ['cerebras', 'api.cerebras.ai/v1/models', 'Authorization'],
    ['aihubmix', 'aihubmix.com/v1/models', 'Authorization'],
    ['cloudflare', 'api.cloudflare.com/client/v4/user/tokens/verify', 'Authorization'],
    ['github', 'api.github.com/user', 'Authorization'],
    ['nvidia', 'api.nvcf.nvidia.com/v2/nvcf/functions', 'Authorization'],
  ])('%s is checked with the key', (provider, url, header) => {
    const req = checkRequest(provider, 'k-123');
    expect(req?.kind === 'http' && req.url).toContain(url);
    expect(req?.kind === 'http' && Object.entries(req.headers).some(([h, v]) => h === header && v.includes('k-123'))).toBe(true);
  });

  it('an unknown key has no check', () => expect(checkRequest('other', 'x')).toBeNull());

  it('live, dead, no credit or unknown', () => {
    expect(checkResult('openai', { status: 200 }).result).toBe('live');
    expect(checkResult('openai', { status: 401 }).result).toBe('dead');
    expect(checkResult('gemini', { status: 400 }).result).toBe('dead');
    expect(checkResult('openai', { status: 402 }).result).toBe('no-credit');
    expect(checkResult('openrouter', { status: 200, body: { data: { limit: 10, limit_remaining: 0 } } }).result).toBe('no-credit');
    expect(checkResult('openrouter', { status: 200, body: { data: { limit: 10, limit_remaining: 4 } } }).result).toBe('live');
    expect(checkResult('openai', { status: 0 }).result).toBe('unknown');
    expect(checkResult('openai', { status: 429 }).result).toBe('unknown');
    expect(checkResult('openai', { status: 500 }).result).toBe('unknown');
  });
});

describe('never the value', () => {
  const row: FoundKey = { id: 'k1', provider: 'gemini', variable: 'GEMINI_API_KEY', value: GEMINI, sources: ['LiteLLM litellm.env'], check: { result: 'live', note: 'Key works' } };

  it("the view and the CEO's text carry the last 4 only", () => {
    const view = { state: 'done' as const, at: 1, keys: [foundView(row)] };
    expect(view.keys[0]).toMatchObject({ keyHint: 'wxyz', importable: true, check: { result: 'live' } });
    expect(JSON.stringify(view)).not.toContain(GEMINI);
    const text = keyScanText(view);
    expect(text).toContain('Google Gemini API');
    expect(text).toContain('wxyz');
    expect(text).not.toContain(GEMINI);
    expect(text).not.toContain(GEMINI.slice(0, -4));
  });

  it('the summary counts', () => {
    const keys = [foundView(row), foundView({ ...row, id: 'k2', check: { result: 'dead', note: 'x' } }), foundView({ ...row, id: 'k3', check: { result: 'unknown', note: 'x' } })];
    expect(scanSummary(keys)).toBe('Keys found: 1 live, 1 dead, 1 not tested.');
  });
});

describe('imported names (#523)', () => {
  it("names a key after its provider, keeping only the variable's own word, and puts the file in its source", () => {
    expect([importName('openrouter', 'OPENROUTER_API_KEY'), importName('cerebras', 'CEREBRAS_API_KEY_PAID'), importName('gemini', 'GOOGLE_API_KEY'), importName('github', 'GH_TOKEN'), importName('nvidia', 'NVIDIA_NIM_API_KEY'), importName('cloudflare', 'CF_API_TOKEN')]).toEqual(['OpenRouter', 'Cerebras (paid)', 'Google Gemini API', 'GitHub token', 'NVIDIA NIM', 'Cloudflare']);
    expect(importSource({ variable: 'CEREBRAS_API_KEY_PAID', sources: ['LiteLLM litellm.env', 'NewsBites .env'] })).toBe('CEREBRAS_API_KEY_PAID · LiteLLM litellm.env + NewsBites .env');
  });
});
