// The CEO's model per kind of job (#331): routine jobs (reviews, follow-ups, triage) on Sonnet, the manager's chat,
// plans and research on the CEO's own model. The settings (CEO settings), the pick, whether a kept session can carry
// on, and the one retry on the CEO's model after a model error. Pure, shared by both sides.
import { isClaudeModel } from './models.ts';
import type { CeoJobKind } from './types.ts';

export const CEO_MODEL_KINDS = ['chat', 'plan', 'research', 'review', 'followup', 'triage'] as const;
export type CeoModelKind = (typeof CEO_MODEL_KINDS)[number];

/** A model per kind of job; '' = the CEO's own model. Kinds not listed (onboarding, changes) always use the CEO's. */
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

/** The model a job of `kind` runs on: its kind's model, else the CEO's own. */
export function ceoModelFor(kind: CeoJobKind, models: Partial<CeoModelSettings>, ceoModel: string): string {
  return (models[kind as CeoModelKind] ?? '').trim() || ceoModel;
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
