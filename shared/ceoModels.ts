// The CEO's model per kind of job (#331): routine jobs (reviews, follow-ups, triage) on Sonnet, the manager's chat,
// plans and research on the CEO's own model. The settings (CEO settings), the pick, whether a kept session can carry
// on, the one retry on the CEO's model after a model error, and "Redo on Opus" for an automated job (#332). Pure,
// shared by both sides.
import { isClaudeModel } from './models.ts';
import type { CeoJobKind } from './types.ts';

export const CEO_MODEL_KINDS = ['chat', 'plan', 'research', 'review', 'followup', 'triage'] as const;
export type CeoModelKind = (typeof CEO_MODEL_KINDS)[number];

/** The jobs the office starts by itself (#332): only these may run on another model, and be redone on the CEO's. */
export const AUTOMATED_KINDS = ['review', 'followup', 'triage'] as const satisfies readonly CeoModelKind[];
export const isAutomatedJob = (kind: CeoJobKind) => (AUTOMATED_KINDS as readonly string[]).includes(kind);

/** A model per kind of job; '' = the CEO's own model. Only automated kinds' are used: the rest always run on the CEO's. */
export type CeoModelSettings = Record<CeoModelKind, string>;

const ROUTINE = 'claude-sonnet-5';
export const DEFAULT_CEO_MODELS: CeoModelSettings = { chat: '', plan: '', research: '', review: ROUTINE, followup: ROUTINE, triage: ROUTINE };

/** The settings as saved: `patch` over `base`; unknown kinds and anything but '' or a Claude model are left out (the CEO runs Claude Code). */
export function ceoModelSettings(base: Partial<CeoModelSettings> | undefined, patch: unknown): CeoModelSettings {
  const out = { ...DEFAULT_CEO_MODELS, ...base };
  const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>;
  for (const k of CEO_MODEL_KINDS) {
    const v = p[k];
    const m = typeof v === 'string' ? v.trim().slice(0, 80) : null;
    if (m !== null && (m === '' || isClaudeModel(m))) out[k] = m;
  }
  return out;
}

/** The model a job of `kind` runs on: an automated kind's model unless `allOnCeo` (CEO settings' quick switch), else the CEO's own. */
export function ceoModelFor(kind: CeoJobKind, models: Partial<CeoModelSettings>, ceoModel: string, allOnCeo = false): string {
  if (allOnCeo || !isAutomatedJob(kind)) return ceoModel;
  return (models[kind as CeoModelKind] ?? '').trim() || ceoModel;
}

/** Why a finished job can't be redone on the CEO's model, or null when it can (#332). */
export function redoRefusal(job: { kind: CeoJobKind; model: string; redoneBy?: number } | undefined, ceoModel: string): string | null {
  if (!job) return "That job's inputs are no longer kept, so it can't be run again.";
  if (!isAutomatedJob(job.kind)) return 'Only jobs the office starts by itself (reviews, follow-ups, triage) can be redone: chat, plans and research already run on the CEO model.';
  if (job.model === ceoModel) return `That job already ran on the CEO model (${job.model}).`;
  if (job.redoneBy !== undefined) return `That job was already redone (job #${job.redoneBy}).`;
  return null;
}

// Input price per million tokens by family, for the redo's estimate: only the ratio between two models matters.
const PRICE: Record<string, number> = { opus: 5, sonnet: 3, haiku: 1 };
const family = (model: string) => model.match(/^claude-([a-z]+)/i)?.[1]?.toLowerCase() ?? '';

/** What a redo on `to` will roughly cost, from what the job cost on `from`; null when there's nothing to go on. */
export function redoEstimate(usd: number, from: string, to: string): number | null {
  const a = PRICE[family(from)], b = PRICE[family(to)];
  if (!(usd > 0)) return null;
  return Math.round(usd * (a && b ? b / a : 1) * 100) / 100;
}

/**
 * Whether a job may carry on in the kept session: a session can't change model, so one started on another model
 * (`sessionModel`; null for sessions from before #331, which ran on the CEO's model) means a fresh one.
 */
export function ceoKeepsSession(resume: boolean, sessionModel: string | null, model: string, ceoModel: string): { resume: boolean; why: string | null } {
  if (!resume || (sessionModel ?? ceoModel) === model) return { resume, why: null };
  return { resume: false, why: `this job runs on ${model}, the kept session on ${sessionModel ?? ceoModel}` };
}

/** A session that failed because of its model: unknown, not on the account, no access. */
export function isModelError(errors: readonly string[]): boolean {
  return errors.some((e) =>
    /issue with the selected model|model_not_found|not_found_error[^\n]*\bmodel\b|\b(unknown|invalid|unsupported) model\b|\bmodel\b[^.\n]{0,80}\b(not found|not_found|does not exist|may not exist|not available|unavailable|not supported|no access|not have access)\b/i.test(e),
  );
}

/** A failed job retries once on the CEO's own model when its kind's model was the reason. */
export function ceoModelRetry(x: { ok: boolean; errors: readonly string[]; model: string; ceoModel: string; retried: boolean }): boolean {
  return !x.ok && !x.retried && x.model !== x.ceoModel && isModelError(x.errors);
}
