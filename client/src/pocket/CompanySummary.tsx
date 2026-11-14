// The Company page's summary row (#345): earnings vs. spend on top (#666), usage on a row of its own (it holds up to four accounts, so cards beside it
// were mostly empty), then the memory map and the CEO as cards of one height in summaryGrid()'s columns, so every row
// ends at the floors' right edge; whatever comes before them (the callout, the tour, the guide) takes a row of its own.
import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useStore } from '../store';
import { CEO_ID } from '../../../shared/types';
import { buildGraph } from '../../../shared/memoryMap';
import { needsAttention } from '../../../shared/providerStatus';
import { UsageSources } from '../ui/UsageSources';
import { EarningsCard } from '../ui/EarningsCard';
import { AgencyCard } from '../ui/AgencyCard';
import { Icon } from '../ui/Icon';
import { summaryGrid } from './companyLayout';
import type { PocketTab } from './pocketData';
import type { ConsoleSection } from './PocketConsole';

export function CompanySummary({ go, settings, children }: { go: (tab: PocketTab) => void; settings: (section: ConsoleSection) => void; children: ReactNode }) {
  const ceo = useStore((s) => s.agents[CEO_ID]);
  const ceoInfo = useStore((s) => s.ceo);
  const [width, setWidth] = useState(0);
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { cols, lastSpan } = summaryGrid(width, ceo ? 2 : 1);
  const last = { gridColumn: `span ${lastSpan}` };
  return (
    <div className="pk-company-side" ref={measure} style={{ '--pk-side-cols': cols } as CSSProperties}>
      <EarningsCard />
      <AgencyCard />
      {children}
      <div className="pk-card pk-summary pk-usage">
        <button className="pk-usage-head" onClick={() => settings('ops')} title="Open Mission control">
          <b className="small">
            <Icon name="gauge" /> Usage
          </b>
          <span className="muted small">
            Mission control <Icon name="chevron-right" />
          </span>
        </button>
        <UsageSources limit={4} />
        <ProvidersAttention open={() => settings('providers')} />
      </div>
      <MapCard open={() => settings('map')} style={ceo ? undefined : last} />
      {ceo && (
        <div className="pk-card pk-summary pk-ceo" style={last}>
          <span className="avatar" style={{ background: ceo.color }}>
            {ceo.name[0]}
          </span>
          <div className="grow">
            <b>{ceo.name}</b> <span className="muted small">CEO</span>
            <div className="small">{ceo.status === 'working' ? (ceoInfo.job?.label ?? 'Working') : ceoInfo.queue.length ? `Next: ${ceoInfo.queue[0].label}` : 'Free'}</div>
          </div>
          <button className="btn btn-small" onClick={() => go('chat')}>
            <Icon name="message-circle" /> Chat
          </button>
        </div>
      )}
    </div>
  );
}

/** "Providers: 2 need attention" (#677): keys lacking a field (Entra's Tenant ID) or a permission, or not working; hidden when none do. */
function ProvidersAttention({ open }: { open: () => void }) {
  const connections = useStore((s) => s.providers.connections);
  const n = useMemo(() => connections.filter(needsAttention).length, [connections]);
  if (!n) return null;
  return (
    <button className="pk-usage-head" onClick={open} title="Open Settings → Providers">
      <b className="small">
        <Icon name="key-round" /> Providers: {n} need{n === 1 ? 's' : ''} attention
      </b>
      <Icon name="chevron-right" />
    </button>
  );
}

/** The memory map as a card: how many things and links it holds now, the same graph the map opens on. */
function MapCard({ open, style }: { open: () => void; style?: CSSProperties }) {
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const qa = useStore((s) => s.qa);
  const messages = useStore((s) => s.messages);
  const experiments = useStore((s) => s.experiments);
  const company = useStore((s) => s.settings.companyName);
  const graph = useMemo(
    () => buildGraph({ now: Date.now(), company, repos, agents: Object.values(agents), qa: Object.values(qa), messages, experiments }),
    [company, repos, agents, qa, messages, experiments],
  );
  return (
    <button className="pk-card pk-summary pk-map" onClick={open} style={style}>
      <span className="pk-map-icon" aria-hidden>
        <Icon name="map" />
      </span>
      <span className="grow">
        <b>Memory map</b>
        <span className="muted small pk-ellipsis">
          {graph.nodes.length} things, {graph.edges.length} links
        </span>
      </span>
      <Icon name="chevron-right" />
    </button>
  );
}
