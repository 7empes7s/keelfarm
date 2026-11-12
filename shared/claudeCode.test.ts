import { describe, expect, it } from 'vitest';
import { bundledLabel, claudeCodeVersion, minClaudeCodeFor, modelNeedsNewerClaude, modelSupportMessage, versionAtLeast } from './claudeCode.ts';

describe('the bundled Claude Code (#546)', () => {
  it('reads the version --version prints', () => {
    expect(claudeCodeVersion('2.1.322 (Claude Code)')).toBe('2.1.322');
    expect(claudeCodeVersion('Claude Code')).toBeNull();
    expect(claudeCodeVersion(null)).toBeNull();
    expect(bundledLabel('2.1.322 (Claude Code)')).toBe('Claude Code 2.1.322, bundled with the office');
    expect(bundledLabel(null)).toBeNull();
  });

  it('compares versions numerically', () => {
    expect(versionAtLeast('2.1.290', '2.1.290')).toBe(true);
    expect(versionAtLeast('2.1.322', '2.1.290')).toBe(true);
    expect(versionAtLeast('2.1.283', '2.1.290')).toBe(false);
    expect(versionAtLeast('2.10.0', '2.9.999')).toBe(true);
    expect(versionAtLeast('1.99.999', '2.0.0')).toBe(false);
  });

  it("greys out a model the bundled version can't run", () => {
    expect(minClaudeCodeFor('claude-fable-5-2')).toBe('2.1.290');
    expect(minClaudeCodeFor('claude-opus-5-5')).toBeNull();
    expect(modelNeedsNewerClaude('claude-fable-5-2', '2.1.283 (Claude Code)')).toBe('Needs Claude Code 2.1.290+: update the office');
    expect(modelNeedsNewerClaude('claude-fable-5-2', '2.1.290 (Claude Code)')).toBeNull();
    expect(modelNeedsNewerClaude('claude-opus-5-5', '2.1.283 (Claude Code)')).toBeNull();
    expect(modelNeedsNewerClaude('claude-fable-5-2', null)).toBeNull(); // unknown version: never greyed out
  });

  it('puts the "does not support this model" API error in plain words', () => {
    const api = 'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Claude Code 2.1.283 does not support this model; version 2.1.290 or newer is required."}}';
    expect(modelSupportMessage(api)).toBe("Claude Code 2.1.283 can't run this model: it needs 2.1.290 or newer. Update the office, or pick another model");
    expect(modelSupportMessage('This model: does not support this model')).toBe("This Claude Code can't run this model. Update the office, or pick another model");
    expect(modelSupportMessage('API Error: 400 invalid_request_error: prompt is too long')).toBeNull();
  });
});
