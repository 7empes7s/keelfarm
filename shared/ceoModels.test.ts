import { describe, expect, it } from 'vitest';
import { ceoKeepsSession, ceoModelFor, ceoModelRetry, ceoModelSettings, DEFAULT_CEO_MODELS, isModelError } from './ceoModels.ts';

const OPUS = 'claude-opus-5-5';
const SONNET = 'claude-sonnet-5';

describe('the CEO model per job kind (#331)', () => {
  it('runs reviews, follow-ups and triage on Sonnet and the rest on the CEO model by default', () => {
    for (const kind of ['review', 'followup', 'triage'] as const) expect(ceoModelFor(kind, DEFAULT_CEO_MODELS, OPUS)).toBe(SONNET);
    for (const kind of ['chat', 'plan', 'research', 'onboard', 'changes'] as const) expect(ceoModelFor(kind, DEFAULT_CEO_MODELS, OPUS)).toBe(OPUS);
  });

  it('follows the manager’s choice per kind, with "same as the CEO model" as a choice', () => {
    const s = ceoModelSettings(DEFAULT_CEO_MODELS, { chat: 'claude-fable-5-1', review: '' });
    expect(ceoModelFor('chat', s, OPUS)).toBe('claude-fable-5-1');
    expect(ceoModelFor('review', s, OPUS)).toBe(OPUS);
    expect(ceoModelFor('triage', s, OPUS)).toBe(SONNET);
    expect(ceoModelFor('review', s, 'claude-opus-5')).toBe('claude-opus-5'); // follows the CEO's own model
  });

  it('checks saved settings', () => {
    expect(ceoModelSettings(undefined, undefined)).toEqual(DEFAULT_CEO_MODELS);
    expect(ceoModelSettings({ review: '' }, { plan: '  claude-sonnet-5 ' })).toMatchObject({ review: '', plan: SONNET, triage: SONNET });
    expect(ceoModelSettings(undefined, { onboard: OPUS, review: 'gpt-6', triage: 3 })).toEqual(DEFAULT_CEO_MODELS);
  });

  it('carries on in the kept session only when it started on the same model', () => {
    expect(ceoKeepsSession(true, OPUS, OPUS, OPUS)).toEqual({ resume: true, why: null });
    expect(ceoKeepsSession(true, null, OPUS, OPUS)).toEqual({ resume: true, why: null }); // an older session ran on the CEO model
    const fresh = ceoKeepsSession(true, OPUS, SONNET, OPUS);
    expect(fresh.resume).toBe(false);
    expect(fresh.why).toContain(SONNET);
    expect(ceoKeepsSession(true, null, SONNET, OPUS).resume).toBe(false);
    expect(ceoKeepsSession(false, SONNET, SONNET, OPUS)).toEqual({ resume: false, why: null });
  });

  it('retries once on the CEO model after a model error', () => {
    const err = ["There's an issue with the selected model (claude-sonnet-5). It may not exist or you may not have access to it."];
    expect(isModelError(err)).toBe(true);
    expect(isModelError(['API Error: 404 {"type":"not_found_error","message":"model: claude-sonnet-5"}'])).toBe(true);
    expect(isModelError(['model claude-sonnet-5 is not available on this account'])).toBe(true);
    expect(isModelError(['Rate limited', 'ENOENT: no such file'])).toBe(false);
    const base = { ok: false, errors: err, model: SONNET, ceoModel: OPUS, retried: false };
    expect(ceoModelRetry(base)).toBe(true);
    expect(ceoModelRetry({ ...base, retried: true })).toBe(false); // only once
    expect(ceoModelRetry({ ...base, model: OPUS })).toBe(false); // already on the CEO model
    expect(ceoModelRetry({ ...base, ok: true })).toBe(false);
    expect(ceoModelRetry({ ...base, errors: ['Session failed'] })).toBe(false);
  });
});
