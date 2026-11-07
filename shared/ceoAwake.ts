// The CEO that stays awake (#28): its session kept between jobs, waits (wait_for, ask_manager) and consults of
// floor agents. The settings (Settings → The CEO) and the CEO tab's view of its session; pure, shared by both sides.
import { ceoModelSettings, DEFAULT_CEO_MODELS, type CeoModelSettings } from './ceoModels.ts';

export interface CeoAwakeSettings {
  keepAlive: boolean; // jobs carry on in the CEO's last session instead of starting cold
  restartTurns: number; // a fresh session once the kept one has taken this many turns (its context fills up)
  idleHours: number; // … or after this long without a job
  maxWaitMin: number; // the longest wait_for (ask_manager waits up to 2 hours whatever this says)
  consultMin: number; // a consult's time cap
  consultMax: number; // consults running at once
  models: CeoModelSettings; // the model per kind of job (#331): a session can't change model, so these decide what carries on too
}

export const DEFAULT_CEO_AWAKE: CeoAwakeSettings = { keepAlive: true, restartTurns: 300, idleHours: 8, maxWaitMin: 30, consultMin: 10, consultMax: 3, models: DEFAULT_CEO_MODELS };

/** The CEO tab's view of its session: how full its context is, what it cost, and what it waits on. */
export interface CeoSessionView {
  turns: number; // since the session started
  costUsd: number;
  startedAt: number | null;
  waiting: string | null; // e.g. "PR #12 on floor 1 to merge", "your answer"
  consults: number; // running or queued
}

const clampInt = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};

/** The settings as saved: `patch` over `base`, each field checked and kept in range. */
export function ceoAwakeSettings(base: Partial<CeoAwakeSettings> | undefined, patch: unknown): CeoAwakeSettings {
  const b = { ...DEFAULT_CEO_AWAKE, ...base };
  const p = (patch && typeof patch === 'object' ? patch : {}) as Partial<Record<keyof CeoAwakeSettings, unknown>>;
  const int = (k: Exclude<keyof CeoAwakeSettings, 'keepAlive' | 'models'>, lo: number, hi: number) => (p[k] === undefined ? b[k] : clampInt(p[k], lo, hi, b[k]));
  return {
    keepAlive: typeof p.keepAlive === 'boolean' ? p.keepAlive : b.keepAlive,
    restartTurns: int('restartTurns', 20, 5000),
    idleHours: int('idleHours', 1, 168),
    maxWaitMin: int('maxWaitMin', 1, 30),
    consultMin: int('consultMin', 2, 30),
    consultMax: int('consultMax', 1, 10),
    models: ceoModelSettings(b.models, p.models),
  };
}
