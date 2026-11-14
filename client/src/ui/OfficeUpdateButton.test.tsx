import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { OfficeUpdateView } from '../../../shared/types';

const state: { officeUpdate?: OfficeUpdateView; updateReady: string | null } = { updateReady: null };
vi.mock('../store', () => ({ useStore: (select: (s: object) => unknown) => select(state) }));
vi.mock('../api', () => ({ api: {} }));
vi.mock('../updateLoad', () => ({ loadUpdate: () => false, reloadAfterUpdate: () => {} }));
import { OfficeUpdateButton } from './OfficeUpdateButton';

const pending = { state: 'available', behind: 3, running: 0, launcher: true } as OfficeUpdateView;
const upToDate = { state: 'none', behind: 0, running: 0, launcher: true } as OfficeUpdateView;

/** The header's update buttons for an office update pending or not and this tab's client stale or not. */
function header(officeUpdate: OfficeUpdateView, stale: boolean) {
  state.officeUpdate = officeUpdate;
  state.updateReady = stale ? 'abc123' : null;
  const html = renderToStaticMarkup(<OfficeUpdateButton className="office-chip update-pill" />);
  return [...html.matchAll(/<button[^>]*aria-label="([^"]+)"[^>]*>.*?<span class="office-update-label">([^<]+)<\/span><\/button>/g)].map((m) => ({ aria: m[1], label: m[2] }));
}

describe('the header’s one Update control (#673)', () => {
  it('says Update office when the office has an update, client stale or not', () => {
    for (const stale of [false, true]) {
      const buttons = header(pending, stale);
      expect(buttons).toHaveLength(1);
      expect(buttons[0].label).toBe('Update office');
      expect(buttons[0].aria).toMatch(/reload this page/);
    }
  });

  it('says Reload app when only the browser is behind', () => {
    expect(header(upToDate, true)).toEqual([{ aria: 'Reload app', label: 'Reload app' }]);
  });

  it('shows nothing when both are up to date', () => {
    expect(header(upToDate, false)).toEqual([]);
  });
});
