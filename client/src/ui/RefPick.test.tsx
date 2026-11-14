import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../store', () => ({ useStore: Object.assign((select: (s: object) => unknown) => select({}), { getState: () => ({}), setState: () => {}, subscribe: () => () => {} }), qaKey: () => '' }));
import { RefPickList } from './RefChips';

describe('"Which one?" for a bare #N on several floors (#678)', () => {
  const jump = { kind: 'url' as const, url: 'https://github.com/o/a/issues/2' };
  const html = renderToStaticMarkup(
    <RefPickList
      what="#2"
      options={[
        { floor: 'Floor 5 · agency', item: '#2 Opportunity: Fiverr automation gigs (n8n, API integrations, scrapers) for small businesses', jump },
        { floor: 'Floor 6 · support', item: '#2 Support kit: triage rules and ready answers for the inbox', jump },
      ]}
      onPick={() => {}}
    />,
  );

  it('names each floor in its row, before the item, and says why it asks', () => {
    const rows = html.match(/<button[^>]*ref-pick-row[\s\S]*?<\/button>/g) ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/ref-pick-floor">Floor 5 · agency<\/span><span class="ref-pick-item">#2 Opportunity/);
    expect(rows[1]).toContain('Floor 6 · support');
    expect(html).toContain('#2 is on two floors');
  });

  it('is a list row with a chevron, not a pill button', () => {
    expect(html).not.toContain('ds-btn');
    expect(html.match(/ds-row ref-pick-row/g)).toHaveLength(2);
    expect(html.match(/ref-pick-go/g)).toHaveLength(2);
  });
});
