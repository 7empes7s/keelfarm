import { afterEach, describe, expect, it } from 'vitest';
import { CEO_ID } from '../../../shared/types';
import { openHoldMenu, useHoldMenu } from '../world/touch/touchState';
import { stepsFor } from './tourSteps';
import { touchHelpShows, tourAllows, useTourGate, type Gated } from './tourGate';

const notices: Gated = { kind: 'overlay', overlay: { kind: 'notices' } };
const phone: Gated = { kind: 'overlay', overlay: { kind: 'phone' } };
const terminal = (agentId: string): Gated => ({ kind: 'overlay', overlay: { kind: 'terminal', agentId } });
const others: Gated[] = [notices, phone, terminal('ada'), { kind: 'card' }, { kind: 'hold' }, { kind: 'toast' }, { kind: 'options' }, { kind: 'search' }, { kind: 'guide' }, { kind: 'overlay', overlay: { kind: 'help' } }];

describe('the tour owns the screen (#406)', () => {
  afterEach(() => {
    useTourGate.setState({ step: null });
    useHoldMenu.setState({ focus: null });
  });

  it('lets everything open when no tour runs', () => {
    for (const g of others) expect(tourAllows(null, g)).toBe(true);
  });

  it('lets nothing open while the first step asks you to look around', () => {
    for (const g of others) expect(tourAllows('look', g)).toBe(false);
  });

  it('lets open only what the step asks for', () => {
    expect(tourAllows('phone', phone)).toBe(true);
    expect(tourAllows('phone', notices)).toBe(false);
    expect(tourAllows('bell', notices)).toBe(true);
    expect(tourAllows('bell', phone)).toBe(false);
    expect(tourAllows('ceo', terminal(CEO_ID))).toBe(true);
    expect(tourAllows('ceo', terminal('ada'))).toBe(false);
    expect(tourAllows('watch', terminal('ada'))).toBe(true);
    expect(tourAllows('watch', { kind: 'card' })).toBe(true);
    expect(tourAllows('watch', { kind: 'hold' })).toBe(true);
    expect(tourAllows('watch', notices)).toBe(false);
    expect(tourAllows('search', { kind: 'search' })).toBe(true);
    expect(tourAllows('search', { kind: 'options' })).toBe(true); // a phone's search is in Options
    expect(tourAllows('upstairs', { kind: 'overlay', overlay: { kind: 'elevator' } })).toBe(true);
  });

  it('never shows a toast mid-tour: they wait for the end', () => {
    for (const s of stepsFor('office')) expect(tourAllows(s.id, { kind: 'toast' })).toBe(false);
  });

  it('holds back the hold menu outside the step that uses it', () => {
    const focus = { id: 'agent-ada', label: 'Watch Ada', action: { kind: 'terminal' as const, agentId: 'ada' } };
    useTourGate.setState({ step: 'bell' });
    openHoldMenu(focus);
    expect(useHoldMenu.getState().focus).toBeNull();
    useTourGate.setState({ step: 'watch' });
    openHoldMenu(focus);
    expect(useHoldMenu.getState().focus).toEqual(focus);
  });

  it('shows the touch help only during the first step, so a finished or skipped tour never brings it back', () => {
    expect(touchHelpShows('look')).toBe(true);
    expect(touchHelpShows(null)).toBe(false); // tutorialStep -1 after Finish or Skip: no step on screen, after any reload
    expect(touchHelpShows('phone')).toBe(false);
  });
});
