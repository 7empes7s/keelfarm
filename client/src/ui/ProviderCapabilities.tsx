// Settings → Providers by what they do (#533): a tile per capability (text, image, video, audio, operations,
// publishing) with its default and fallback, this month's usage beside the default where its provider tells, who
// takes over when the default is limited or down, and what's missing ("No video provider: add one"). One provider
// shows under every capability it covers. Change picks the default and fallback; the routing rules are pure, in
// shared/capabilities.ts.
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { CAPABILITIES, capabilityRoutes, type CapabilityRoute } from '../../../shared/capabilities';
import type { ProviderCard } from '../../../shared/providers';
import type { Capability } from '../../../shared/types';
import { Chip } from './DetailsPage';
import { Icon } from './Icon';
import type { IconName } from './icons';
import { Sheet } from './Sheet';
import { WindowBar } from './UsageSources';

export const CAPABILITY_ICON: Record<Capability, IconName> = { text: 'message-circle', image: 'image', video: 'video', audio: 'mic', operations: 'wrench', publishing: 'megaphone' };

export function ProviderCapabilities({ cards, onAdd }: { cards: ProviderCard[]; onAdd: (cap: Capability) => void }) {
  const defaults = useStore((s) => s.providers.defaults);
  const [changing, setChanging] = useState<Capability | null>(null);
  const routes = capabilityRoutes(cards, defaults);
  const route = routes.find((r) => r.capability === changing);
  return (
    <section className="card pv-caps" aria-label="What the office can do">
      <h4>
        <Icon name="sparkles" /> What the office can do
      </h4>
      <p className="muted small">Floors and the CEO ask for a capability, not a provider: the office uses its default, and the fallback when the default is limited or down.</p>
      <div className="pv-cap-grid">
        {routes.map((r) => (
          <CapabilityTile key={r.capability} r={r} onAdd={() => onAdd(r.capability)} onChange={() => setChanging(r.capability)} />
        ))}
      </div>
      {route && <DefaultsSheet r={route} onClose={() => setChanging(null)} />}
    </section>
  );
}

function CapabilityTile({ r, onAdd, onChange }: { r: CapabilityRoute; onAdd: () => void; onChange: () => void }) {
  const source = useStore((s) => (r.route?.usageId ? s.accounts.sources?.find((x) => x.id === r.route!.usageId) : undefined));
  const blurb = CAPABILITIES.find((c) => c.id === r.capability)?.blurb;
  const [word, tone] = !r.primary ? (['Missing', 'warn'] as const) : !r.route ? (['Not working', 'bad'] as const) : r.route !== r.primary ? (['Fallback in use', 'warn'] as const) : (['Ready', 'good'] as const);
  const others = r.cards.filter((c) => c !== r.primary && c !== r.fallback);
  return (
    <section className="pv-cap" aria-label={`${r.label} capability`}>
      <div className="pv-cap-head">
        <b>
          <Icon name={CAPABILITY_ICON[r.capability]} /> {r.label}
        </b>
        <Chip tone={tone}>{word}</Chip>
      </div>
      {r.primary ? (
        <>
          <div className="pv-cap-row">
            <span className="muted small">Default</span>
            <span className="pv-cap-name">{r.primary.label}</span>
          </div>
          {source?.windows[0] && <WindowBar w={source.windows[0]} now={Date.now()} />}
          <div className="pv-cap-row">
            <span className="muted small">Fallback</span>
            <span className="pv-cap-name">{r.fallback ? r.fallback.label : 'None yet'}</span>
          </div>
          {others.length > 0 && <div className="ds-row-meta">Also: {others.map((c) => c.label).join(', ')}</div>}
        </>
      ) : (
        <p className="muted small">{blurb}</p>
      )}
      {r.gap && (
        <p className="small pv-gap" role="status">
          {r.gap}
        </p>
      )}
      <div className="pv-cap-actions">
        {r.cards.length > 1 && (
          <button className="btn btn-small" onClick={onChange}>
            Change
          </button>
        )}
        {(!r.primary || !r.fallback) && (
          <button className="btn btn-small" onClick={onAdd}>
            <Icon name="plus" /> {r.primary ? 'Add a fallback' : `Add ${r.label.toLowerCase()}`}
          </button>
        )}
      </div>
    </section>
  );
}

/** Change: a capability's default and fallback among the connections covering it. */
function DefaultsSheet({ r, onClose }: { r: CapabilityRoute; onClose: () => void }) {
  const [primary, setPrimary] = useState(r.primary?.key ?? '');
  const [fallback, setFallback] = useState(r.fallback?.key ?? '');
  const [note, setNote] = useState('');
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.setProviderDefault(r.capability, { primary, ...(fallback && fallback !== primary ? { fallback } : {}) });
      onClose();
    } catch (err) {
      setNote((err as Error).message);
    }
  };
  const name = (c: ProviderCard) => (c.label === c.name ? c.name : `${c.label} (${c.name})`);
  return (
    <Sheet title={`${r.label}: default and fallback`} onClose={onClose} className="pv-sheet">
      <form className="acc-form" onSubmit={(e) => void save(e)}>
        <label className="field">
          <span>Default</span>
          <select value={primary} onChange={(e) => setPrimary(e.target.value)}>
            {r.cards.map((c) => (
              <option key={c.key} value={c.key}>
                {name(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Fallback</span>
          <select value={fallback} onChange={(e) => setFallback(e.target.value)}>
            <option value="">None</option>
            {r.cards
              .filter((c) => c.key !== primary)
              .map((c) => (
                <option key={c.key} value={c.key}>
                  {name(c)}
                </option>
              ))}
          </select>
        </label>
        <p className="muted small">The fallback takes over while the default is limited, out of credit or not working.</p>
        <button className="btn btn-primary">Save</button>
        {note && (
          <p className="small" role="status">
            {note}
          </p>
        )}
      </form>
    </Sheet>
  );
}
