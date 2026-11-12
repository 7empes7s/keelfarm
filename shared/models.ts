import type { AgentCli, ModelCatalogView, ModelEntry } from './types.ts';
import { modelNeedsNewerClaude } from './claudeCode.ts';

// Which model an agent's session asks for. The office's default model belongs to its default coding agent, and each
// worker can name their own; a model only goes to an agent that understands it (no Claude model for Codex).

/** Claude Code's model names and aliases. */
export const isClaudeModel = (model: string) => /^(claude|opus|sonnet|haiku|fable|default|best|opusplan)\b/i.test(model.trim());

/**
 * The model for a worker on `cli`: their own if it suits that agent, else the office default when `cli` is the
 * default agent, else `claudeDefault` for Claude Code, or '' to let any other agent use its own default.
 */
export function effectiveModel(own: string, cli: AgentCli, office: { defaultCli: AgentCli; defaultModel: string }, claudeDefault: string): string {
  const suits = (m: string) => m.trim() !== '' && (cli === 'claude') === isClaudeModel(m);
  if (suits(own)) return own.trim();
  if (cli === office.defaultCli && suits(office.defaultModel)) return office.defaultModel.trim();
  return cli === 'claude' ? claudeDefault : '';
}

/** Claude Code's built-in models, newest first: the catalog's fallback when Anthropic's list can't be read. */
export const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'];

// ---------- local models ----------

/**
 * Model servers on this computer an agent can use instead of a subscription: a model named `<id>/<model>` (e.g.
 * `ollama/qwen3-coder`) runs on that server. OpenCode reaches any of them through their OpenAI-compatible API; Codex
 * has Ollama and LM Studio built in (`--oss`) and talks to the others through their Responses API.
 */
export const LOCAL_PROVIDERS = [
  { id: 'ollama', label: 'Ollama', url: 'http://127.0.0.1:11434/v1', codexOss: true },
  { id: 'lmstudio', label: 'LM Studio', url: 'http://127.0.0.1:1234/v1', codexOss: true },
  { id: 'llamacpp', label: 'llama.cpp', url: 'http://127.0.0.1:8080/v1', codexOss: false },
  { id: 'omlx', label: 'oMLX', url: 'http://127.0.0.1:8000/v1', codexOss: false },
] as const;

export type LocalProvider = (typeof LOCAL_PROVIDERS)[number];

/** A model on a local server: its provider and the server's own name for it (which may hold more slashes), or null. */
export function localModel(model: string): { provider: LocalProvider; model: string } | null {
  const m = model.trim().match(/^([a-z.]+)\/(.+)$/i);
  const id = m?.[1].toLowerCase().replace('llama.cpp', 'llamacpp');
  const provider = LOCAL_PROVIDERS.find((p) => p.id === id);
  return provider && m ? { provider, model: m[2] } : null;
}

// ---------- the catalog (#198) ----------

/** Claude Code's aliases: each floats to the newest model of its family. */
const CLAUDE_ALIASES = ['opus', 'sonnet', 'haiku'] as const;

/** "claude-opus-5-5" → "Opus 5.5", "claude-haiku-4-5-20251001" → "Haiku 4.5", "gpt-6.1-sol" → "GPT-6.1-Sol". */
export function modelLabel(id: string, name?: string): string {
  const shown = name?.trim().replace(/^Claude\s+/i, '');
  if (shown) return shown;
  const m = id.match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/i);
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`;
  return id.replace(/^gpt/i, 'GPT');
}

/** What one source found: a coding agent's live list (null: it couldn't be read), or a local server's models. */
export type CatalogPart = { cli: AgentCli; models: { id: string; name?: string; isDefault?: boolean }[] | null } | { local: string; models: string[] };

/**
 * The catalog from what the sources found: each agent's live list; Claude Code's built-in one when Anthropic's can't
 * be read, always with its aliases; a local server's models for Codex and OpenCode as `<server>/<model>`.
 */
export function mergeCatalog(parts: CatalogPart[], now: number): ModelCatalogView {
  const entries: ModelEntry[] = [];
  const add = (e: Omit<ModelEntry, 'checkedAt'>) => {
    if (e.id && !entries.some((x) => x.cli === e.cli && x.id === e.id)) entries.push({ ...e, checkedAt: now });
  };
  const live = (cli: AgentCli) => parts.find((p): p is Extract<CatalogPart, { cli: AgentCli }> => 'cli' in p && p.cli === cli)?.models;
  const claude = live('claude');
  if (claude?.length) for (const m of claude) add({ id: m.id, label: modelLabel(m.id, m.name), cli: 'claude', source: 'live', isDefault: m.isDefault });
  else for (const id of CLAUDE_MODELS) add({ id, label: modelLabel(id), cli: 'claude', source: 'built-in' });
  for (const a of CLAUDE_ALIASES) add({ id: a, label: `${a[0].toUpperCase()}${a.slice(1)} · always the newest`, cli: 'claude', source: claude?.length ? 'live' : 'built-in', alias: true });
  for (const cli of ['codex', 'opencode'] as const) for (const m of live(cli) ?? []) add({ id: m.id, label: modelLabel(m.id, m.name), cli, source: 'live', isDefault: m.isDefault });
  for (const p of parts) {
    if (!('local' in p)) continue;
    for (const m of p.models) for (const cli of ['codex', 'opencode'] as const) add({ id: `${p.local}/${m}`, label: `${m} · ${p.local}`, cli, source: 'live' });
  }
  return { entries, checkedAt: now };
}

/** A coding agent's models in the catalog. */
const catalogFor = (cli: AgentCli, catalog: ModelCatalogView) => catalog.entries.filter((e) => e.cli === cli);

/** The model an alias stands for (the newest of its family in the catalog), else the model itself. */
export function resolveAlias(model: string, catalog: ModelCatalogView): string {
  const m = model.trim().toLowerCase();
  if (!(CLAUDE_ALIASES as readonly string[]).includes(m)) return model.trim();
  return catalogFor('claude', catalog).find((e) => !e.alias && e.id.toLowerCase().includes(m))?.id ?? model.trim();
}

/** A model's plain label: the catalog's, an alias's with what it stands for, else the id ('': the agent's own default). */
export function labelOf(model: string, cli: AgentCli, catalog: ModelCatalogView): string {
  const entry = catalogFor(cli, catalog).find((e) => e.id === model.trim());
  if (entry?.alias) {
    const to = resolveAlias(model, catalog);
    return to === model.trim() ? entry.label : `${modelLabel(to)} (${model.trim()})`;
  }
  return entry?.label ?? (model.trim() || catalogFor(cli, catalog).find((e) => e.isDefault)?.label || 'its default model');
}

/** Is this model in the catalog for that agent? '' (the default) always is; so is anything while its list is empty. */
export function inCatalog(model: string, cli: AgentCli, catalog: ModelCatalogView): boolean {
  const m = model.trim();
  const list = catalogFor(cli, catalog);
  return !m || !list.length || list.some((e) => e.id === m);
}

/** Why a model can't be given to an agent on `cli` (the CEO's tools), naming the valid ids; null when it can. */
export function modelProblem(model: string | undefined, cli: AgentCli, catalog: ModelCatalogView): string | null {
  if (model === undefined || inCatalog(model, cli, catalog)) return null;
  return `"${model.trim()}" isn't one of ${cli}'s models. Valid: ${catalogFor(cli, catalog).map((e) => e.id).join(', ')}, or "" for the default.`;
}

/** The model to keep when an agent's coding agent changes: theirs if the new one has it, else '' (the default). */
export function modelAfterCliChange(model: string, cli: AgentCli, catalog: ModelCatalogView): string {
  const m = model.trim();
  if (!m) return '';
  return catalogFor(cli, catalog).length ? (inCatalog(m, cli, catalog) ? m : '') : (cli === 'claude') === isClaudeModel(m) ? m : '';
}

/** The marker for the picker's "Other…": a custom id typed in. */
export const OTHER_MODEL = '\u0000other';

/**
 * A model picker's options: "Default (Opus 5.5)", naming what the default resolves to, the agent's models with plain
 * labels (the newest of each family marked), and "Other…". A Claude model the bundled Claude Code (`claudeVersion`, as
 * --version prints it) is too old for is greyed out, saying so (#546).
 */
export function pickerOptions(cli: AgentCli, catalog: ModelCatalogView, resolvedDefault: string, claudeVersion?: string | null): { value: string; label: string; disabled?: boolean }[] {
  const list = catalogFor(cli, catalog);
  const newest = new Set(list.filter((e) => e.alias).map((e) => resolveAlias(e.id, catalog)));
  const fallback = list.find((e) => e.isDefault)?.label;
  const def = resolvedDefault ? labelOf(resolvedDefault, cli, catalog) : fallback;
  return [
    { value: '', label: def ? `Default (${def})` : 'Default' },
    ...list.map((e) => {
      const label = newest.has(e.id) ? `${e.label} · newest` : e.label;
      const why = cli === 'claude' ? modelNeedsNewerClaude(e.id, claudeVersion) : null;
      return why ? { value: e.id, label: `${label} · ${why}`, disabled: true } : { value: e.id, label };
    }),
    { value: OTHER_MODEL, label: 'Other…' },
  ];
}
