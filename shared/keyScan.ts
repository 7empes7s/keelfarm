// Keys found on this computer (#367), pure: which provider an environment variable's key is for, reading env files
// and JSON configs (OpenCode's provider block and auth.json too), the project a file came from, one row per key
// (the same value found twice, or already saved, merged), each key's authenticated test and what it said, and the
// rows without their values for the tabs and the CEO. server/keyScan.ts reads the files; server/swarm/providers.ts
// keeps the values in memory until they're imported.
import { keyHint, providerDef, testRequest, type ProbeRequest, type ProbeResult } from './providers.ts';
import type { FoundKeyView, KeyCheck, KeyScanView } from './types.ts';

/** A key as read from a file: its variable, its value, and where ("LiteLLM litellm.env"). */
export interface RawKey {
  variable: string;
  value: string;
  source: string;
}

/** A row of the review, with its value: only ever in the server's memory. */
export interface FoundKey extends Omit<FoundKeyView, 'keyHint' | 'importable' | 'check'> {
  value: string;
  check?: FoundKeyView['check'];
}

// ---------- names ----------

/** Variables that hold a key but aren't worth importing (LiteLLM's own master key: the service is gone). */
const SKIP = new Set(['LITELLM_MASTER_KEY']);

const KNOWN: [RegExp, string][] = [
  [/^(GEMINI|GOOGLE|GOOGLE_AI|GOOGLE_GENERATIVE_AI)_API_KEY$/, 'gemini'],
  [/^OPENAI_API_KEY$/, 'openai'],
  [/^OPENROUTER_API_KEY$/, 'openrouter'],
  [/^ANTHROPIC_API_KEY$/, 'anthropic'],
  [/^(GITHUB_TOKEN|GH_TOKEN|GITHUB_PAT)$/, 'github'],
  [/^GROQ_API_KEY$/, 'groq'],
  [/^CEREBRAS_API_KEY(_[A-Z0-9]+)?$/, 'cerebras'],
  [/^(CLOUDFLARE|CF)_API_TOKEN$/, 'cloudflare'],
  [/^NVIDIA(_NIM)?_API_KEY$/, 'nvidia'],
  [/^AIHUBMIX_API_KEY$/, 'aihubmix'],
  [/^(HCLOUD_TOKEN|HETZNER_API_TOKEN)$/, 'hetzner'],
  [/^ELEVENLABS_API_KEY$/, 'elevenlabs'],
];
const GENERIC = /(^|_)(API_?KEY|KEY|TOKEN|SECRET|PAT)$/;

/** The catalogue provider a variable's key is for, 'other' for an unknown *_API_KEY / *_TOKEN, null when it's no key to import. */
export function providerForVar(name: string): string | null {
  const n = name.toUpperCase();
  if (SKIP.has(n)) return null;
  for (const [re, id] of KNOWN) if (re.test(n)) return id;
  return GENERIC.test(n) ? 'other' : null;
}

/** A placeholder, a reference to another variable, or too short to be anyone's key. */
const looksLikeKey = (v: string) => v.length >= 8 && v.length <= 400 && !/\s/.test(v) && !v.includes('${') && !v.includes('{env:');

// ---------- files ----------

/** An env file's NAME=value pairs: `export`, quotes and comments handled, empty values and ${REFS} skipped. */
export function envPairs(text: string): [string, string][] {
  const out: [string, string][] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(raw);
    if (!m) continue;
    const rest = m[2].trim();
    const q = rest[0] === '"' || rest[0] === "'" ? rest[0] : '';
    const value = q ? rest.slice(1, rest.indexOf(q, 1) < 0 ? undefined : rest.indexOf(q, 1)) : rest.replace(/\s+#.*$/, '').trim();
    if (value && !value.includes('${')) out.push([m[1], value]);
  }
  return out;
}

const ALIAS: Record<string, string> = { google: 'gemini', 'google-generative-ai': 'gemini', nim: 'nvidia' };
const KEY_FIELDS = new Set(['apikey', 'api_key', 'key', 'token']);

/** A provider's env variable from a config's provider name ("openrouter", "google"), or null. */
const aliasVar = (name: string) => providerDef(ALIAS[name.toLowerCase()] ?? name.toLowerCase())?.keyEnv ?? null;

/** Keys in a JSON config: env-style fields anywhere, and apiKey / key fields under a provider's name (OpenCode). */
export function jsonKeys(raw: unknown): [string, string][] {
  const out: [string, string][] = [];
  const walk = (v: unknown, under: string | null, depth: number) => {
    if (!v || typeof v !== 'object' || depth > 8) return;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (typeof x === 'string') {
        const variable = /^[A-Z][A-Z0-9_]*$/.test(k) && providerForVar(k) ? k : KEY_FIELDS.has(k.toLowerCase()) ? under : null;
        if (variable && looksLikeKey(x)) out.push([variable, x]);
      } else walk(x, aliasVar(k) ?? under, depth + 1);
    }
  };
  walk(raw, null, 0);
  return out;
}

const PROJECTS: [string, string][] = [
  ['litellm', 'LiteLLM'],
  ['newsbites', 'NewsBites'],
  ['openclaw', 'Mimule'],
  ['mimule', 'Mimule'],
  ['control-surface', 'Control Surface'],
  ['controlsurface', 'Control Surface'],
  ['control_surface', 'Control Surface'],
  ['paperclip', 'Paperclip'],
  ['gaffr', 'GaffrPro'],
  ['hermes', 'Hermes'],
  ['tib-markets', 'TIB Markets'],
  ['opencode', 'OpenCode'],
];

/** "etc/litellm/litellm.env" → "LiteLLM litellm.env": the retired project a file belonged to, else its folder. */
export function sourceLabel(file: string): string {
  const parts = file.split(/[\\/]/).filter(Boolean);
  const base = parts.at(-1) ?? file;
  const project = parts.map((p) => PROJECTS.find(([k]) => p.toLowerCase().includes(k))?.[1]).find(Boolean) ?? parts.at(-2) ?? '';
  return `${project} ${base}`.trim();
}

// ---------- rows ----------

/** One row per key: the same value under several names or files keeps every source (a known name wins over an unknown one); a key already saved says as what. */
export function mergeFound(raw: readonly RawKey[], saved: readonly { value: string; label: string }[]): FoundKey[] {
  const out: FoundKey[] = [];
  for (const r of raw) {
    const provider = providerForVar(r.variable);
    if (!provider || !looksLikeKey(r.value)) continue;
    const same = out.find((f) => f.value === r.value);
    if (same) {
      if (!same.sources.includes(r.source)) same.sources.push(r.source);
      if (same.provider === 'other' && provider !== 'other') Object.assign(same, { provider, variable: r.variable });
      continue;
    }
    const savedAs = saved.find((s) => s.value === r.value)?.label;
    out.push({ id: `k${out.length + 1}`, provider, variable: r.variable, value: r.value, sources: [r.source], ...(savedAs && { savedAs }) });
  }
  return out;
}

/** A row as the tabs and the CEO see it: the last 4 characters, never the value. */
export function foundView(f: FoundKey): FoundKeyView {
  return { id: f.id, provider: f.provider, variable: f.variable, sources: [...f.sources], keyHint: keyHint(f.value), check: f.check ?? null, ...(f.savedAs && { savedAs: f.savedAs }), importable: providerDef(f.provider)?.home === 'providers' && !f.savedAs };
}

/** An imported key's connection name: "Google Gemini API (LiteLLM litellm.env)", its variable too when it isn't the usual one. */
export function importLabel(f: Pick<FoundKey, 'provider' | 'variable' | 'sources'>): string {
  const def = providerDef(f.provider);
  const where = f.variable === def?.keyEnv ? f.sources[0] : `${f.variable}, ${f.sources[0]}`;
  return `${def?.name ?? f.provider} (${where})`.slice(0, 60);
}

// ---------- tests ----------

/** The key's authenticated check (never a public endpoint: OpenRouter's /models once "proved" a dead key valid), or null. */
export function checkRequest(provider: string, key: string): ProbeRequest | null {
  if (provider === 'elevenlabs') return { kind: 'http', url: 'https://api.elevenlabs.io/v1/user', headers: { 'xi-api-key': key } };
  return providerDef(provider) ? testRequest(provider, key) : null;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** What a check's answer means: live, dead, no credit, or unknown, with a short reason. */
export function checkResult(provider: string, r: ProbeResult): { result: KeyCheck; note: string } {
  const body = (r.body && typeof r.body === 'object' ? r.body : {}) as { data?: { limit_remaining?: unknown }; result?: { status?: unknown } };
  if (r.status >= 200 && r.status < 300) {
    const left = num(body.data?.limit_remaining);
    if (provider === 'openrouter' && left !== null && left <= 0) return { result: 'no-credit', note: 'Works, but no credit left' };
    const status = body.result?.status;
    if (provider === 'cloudflare' && typeof status === 'string' && status !== 'active') return { result: 'dead', note: `The token is ${status}` };
    return { result: 'live', note: 'Key works' };
  }
  if (r.status === 402) return { result: 'no-credit', note: 'No credit left (402)' };
  if (r.status === 403 && provider === 'nvidia') return { result: 'unknown', note: 'NVIDIA turned the check away (403): try it by hand' };
  if (r.status === 400 || r.status === 401 || r.status === 403) return { result: 'dead', note: `Turned away (${r.status})` };
  if (r.status === 0) return { result: 'unknown', note: "Couldn't reach the provider" };
  if (r.status === 429) return { result: 'unknown', note: 'Rate-limited: test it again later' };
  return { result: 'unknown', note: `The provider answered ${r.status}` };
}

// ---------- words ----------

const plural = (n: number, word: string) => `${n} ${word}`;

/** The notification's line: "Keys found: 6 live, 3 dead, 2 not tested." */
export function scanSummary(keys: readonly FoundKeyView[]): string {
  if (!keys.length) return 'No keys found on this computer.';
  const count = (r: KeyCheck) => keys.filter((k) => (k.check?.result ?? 'unknown') === r).length;
  const parts = [plural(count('live'), 'live'), plural(count('dead'), 'dead')];
  if (count('no-credit')) parts.push(plural(count('no-credit'), 'out of credit'));
  if (count('unknown')) parts.push(plural(count('unknown'), 'not tested'));
  return `Keys found: ${parts.join(', ')}.`;
}

const RESULT_WORD: Record<KeyCheck, string> = { live: 'live', dead: 'dead', 'no-credit': 'no credit', unknown: 'unknown' };

/** scan_keys' output for the CEO: provider, last 4, where, and the test, never a value. */
export function keyScanText(v: KeyScanView): string {
  if (v.state === 'idle') return 'No scan yet: call scan_keys to run one.';
  if (v.state === 'scanning') return 'Scanning and testing now: the manager gets a notification when it is done.';
  if (v.state === 'failed') return `The scan failed: ${v.note ?? 'unknown error'}.`;
  const rows = v.keys.map((k) => {
    const name = providerDef(k.provider)?.name ?? 'Unknown provider';
    const test = k.check ? `${RESULT_WORD[k.check.result]} (${k.check.note})` : 'not tested';
    const extra = k.savedAs ? `, saved as "${k.savedAs}"` : k.importable ? '' : ', no integration to import it into';
    return `- ${name} ••••${k.keyHint} (${k.variable}, ${k.sources.join(' + ')}): ${test}${extra}`;
  });
  return [`${scanSummary(v.keys)}${v.at ? ` Scanned ${new Date(v.at).toISOString()}.` : ''}`, ...rows, 'The manager reviews and imports them in Settings → Providers → Keys found on this computer. Values are never shown.'].join('\n');
}
