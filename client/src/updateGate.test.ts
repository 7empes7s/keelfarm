import { afterEach, describe, expect, it, vi } from 'vitest';
import { markBusy, readyAfter, tryLoad } from './updateGate';

// The office's new client after a self-update (#216): marked ready, never a reload on its own, loaded at a safe moment.
afterEach(() => {
  markBusy('draft:ceo', 'draft', false);
  markBusy('upload:ceo', 'uploading', false);
});

const idle = { sending: false, sheet: false };

describe('a new office commit', () => {
  it('marks the new client ready (no reload), once per commit', () => {
    expect(readyAfter(null, 'abc1234', 'def5678', null)).toBe('def5678');
    expect(readyAfter(null, 'abc1234', 'abc1234', null)).toBeNull();
    expect(readyAfter('def5678', 'def5678', 'def5678', null)).toBe('def5678'); // a reconnect on it keeps it ready
    expect(readyAfter(null, 'abc1234', 'def5678', 'def5678')).toBeNull(); // this tab loaded it already
  });
});

describe('tryLoad', () => {
  it('waits while a draft, an upload, a send or a sheet is under way, then loads at the next safe moment', () => {
    const load = vi.fn();
    markBusy('draft:ceo', 'draft', true);
    expect(tryLoad('def5678', { kind: 'nav' }, idle, load)).toEqual({ loaded: false, waitsFor: 'you send or clear your message' });
    markBusy('draft:ceo', 'draft', false);
    markBusy('upload:ceo', 'uploading', true);
    expect(tryLoad('def5678', { kind: 'tap' }, idle, load).loaded).toBe(false);
    markBusy('upload:ceo', 'uploading', false);
    expect(tryLoad('def5678', { kind: 'nav' }, { ...idle, sending: true }, load).loaded).toBe(false);
    expect(tryLoad('def5678', { kind: 'nav' }, { ...idle, sheet: true }, load).loaded).toBe(false);
    expect(load).not.toHaveBeenCalled();
    expect(tryLoad('def5678', { kind: 'nav' }, idle, load)).toEqual({ loaded: true, waitsFor: null });
    expect(load).toHaveBeenCalledWith('def5678');
  });
  it('does nothing without a new client', () => {
    const load = vi.fn();
    expect(tryLoad(null, { kind: 'tap' }, idle, load)).toEqual({ loaded: false, waitsFor: null });
    expect(load).not.toHaveBeenCalled();
  });
});
