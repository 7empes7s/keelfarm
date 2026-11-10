// Settings → Providers (#362): every provider the office runs on, one card each, grouped by category (coding agents,
// text, audio, video, image, cloud, MCP servers): its status, plan, usage (#361's rows), what uses it, Test and Remove.
// "+ Add provider" opens the catalogue. Claude and Codex accounts, the ElevenLabs key and the Upstash key are still
// changed in their own sections (linked from their cards); keys added here and MCP servers are changed here.
// "Keys found on this computer" (#367): Scan, then a review sheet of what the server found and tested, last 4 only.
import { useMemo, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { CATEGORIES, PROVIDERS, providerCards, type CardStatus, type ProviderCard, type ProviderDef } from '../../../shared/providers';
import { CEO_ID, type FoundKeyView, type KeyCheck, type ProviderCategory } from '../../../shared/types';
import { scanSummary } from '../../../shared/keyScan';
import { useKeyReview } from './keyReview';
import { Chip } from './DetailsPage';
import type { ChipTone } from './detailsRules';
import { Icon } from './Icon';
import type { IconName } from './icons';
import { Menu } from './Menu';
import { Sheet } from './Sheet';
import { SecretInput } from './SecretInput';
import { confirmDialog } from './Confirm';
import { WindowBar } from './UsageSources';
import './providersPage.css';

const CATEGORY_ICON: Record<ProviderCategory, IconName> = { coding: 'terminal', text: 'message-circle', audio: 'mic', video: 'video', image: 'image', cloud: 'cloud', mcp: 'plug' };
const STATUS: Record<CardStatus, [string, ChipTone]> = {
  ready: ['Ready', 'good'],
  near: ['Near limit', 'warn'],
  limited: ['Limited', 'bad'],
  'signed-out': ['Signed out', 'bad'],
  error: ['Not working', 'bad'],
  untested: ['Not tested', 'plain'],
  paused: ['Paused', 'plain'],
  off: ['Off', 'plain'],
};
const SETTINGS_NAME = { accounts: 'Providers & accounts', voice: 'Voice', 'cloud-agents': 'Cloud agents', tools: 'Tools & skills' } as const;
const go = (section: string) => {
  location.hash = `#settings/${section}`;
};

/** The page's cards, from the snapshot's stores. */
function useCards(): ProviderCard[] {
  const accounts = useStore((s) => s.accounts.accounts);
  const voiceKeySet = useStore((s) => s.voiceKeySet);
  const voiceKeyHint = useStore((s) => s.voiceKeyHint);
  const cloud = useStore((s) => s.cloud);
  const providers = useStore((s) => s.providers);
  const clis = useStore((s) => s.clis);
  const agents = useStore((s) => s.agents);
  return useMemo(
    () =>
      providerCards({
        accounts,
        voiceKeySet,
        voiceKeyHint,
        cloud,
        providers,
        clis,
        agentName: (id) => `${agents[id]?.name ?? id}${id === CEO_ID ? ' (CEO)' : ''}`,
        cloudAgents: Object.values(agents).filter((a) => a.host === 'box').length,
      }),
    [accounts, voiceKeySet, voiceKeyHint, cloud, providers, clis, agents],
  );
}

export function ProvidersPage() {
  const cards = useCards();
  const [adding, setAdding] = useState(false);
  const [who, setWho] = useState<string | null>(null); // an MCP server's "Who gets it"
  const attention = cards.filter((c) => ['error', 'signed-out', 'limited'].includes(c.status)).length;
  return (
    <div className="pv-page">
      <div className="card">
        <div className="pv-top">
          <h3>
            <Icon name="plug" /> Providers
          </h3>
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            <Icon name="plus" /> Add provider
          </button>
        </div>
        <p className="muted small">Everything the office runs on: coding agents' accounts, text, audio and cloud APIs, and the MCP servers agents get. Keys go in and never come back out: only their last 4 characters.</p>
        <div className="pv-stats" role="list" aria-label="Providers at a glance">
          <span role="listitem">
            <b>{cards.filter((c) => c.category !== 'mcp').length}</b> connected
          </span>
          <span role="listitem">
            <b>{attention}</b> need{attention === 1 ? 's' : ''} you
          </span>
          <span role="listitem">
            <b>{cards.filter((c) => c.category === 'mcp' && c.status !== 'off').length}</b> MCP on
          </span>
        </div>
      </div>
      <FoundKeysCard />
      {CATEGORIES.map((cat) => {
        const list = cards.filter((c) => c.category === cat.id);
        return (
          <section key={cat.id} className="card pv-group" aria-label={cat.label}>
            <h4>
              <Icon name={CATEGORY_ICON[cat.id]} /> {cat.label}
            </h4>
            {list.map((c) => (
              <CardRow key={c.key} c={c} onWho={setWho} />
            ))}
            {!list.length && <p className="muted small">{PROVIDERS.some((p) => p.category === cat.id) || cat.id === 'mcp' ? 'None yet: Add provider puts one here.' : `No ${cat.label.toLowerCase()} providers yet: tell the CEO which one you'd like.`}</p>}
          </section>
        );
      })}
      <p className="muted small">
        Accounts' rotation, tags and sign-ins are in <a href="#settings/accounts">Providers & accounts</a>; voices in <a href="#settings/voice">Voice</a>; cloud machines in <a href="#settings/cloud-agents">Cloud agents</a>; plugins and skills in <a href="#settings/tools">Tools & skills</a>.
      </p>
      {adding && <AddSheet onClose={() => setAdding(false)} />}
      {who && <WhoSheet id={who} onClose={() => setWho(null)} />}
    </div>
  );
}

function CardRow({ c, onWho }: { c: ProviderCard; onWho: (id: string) => void }) {
  const source = useStore((s) => (c.usageId ? s.accounts.sources?.find((x) => x.id === c.usageId) : undefined));
  const [busy, setBusy] = useState(false);
  const [word, tone] = STATUS[c.status];
  const [kind, id] = [c.key.slice(0, c.key.indexOf(':')), c.key.slice(c.key.indexOf(':') + 1)];
  const now = Date.now();
  const test = async () => {
    setBusy(true);
    await (kind === 'mcp' ? api.testMcpServer(id) : api.testProvider(id)).catch(() => undefined);
    setBusy(false);
  };
  const remove = async () => {
    const ok = await confirmDialog({ title: `Remove ${c.label}?`, body: kind === 'mcp' ? "Agents' next sessions start without it, and its saved secrets are deleted." : 'Its saved key is deleted from the office.', icon: 'trash-2', confirm: 'Remove', tone: 'danger' });
    if (ok) await (kind === 'mcp' ? api.removeMcpServer(id) : api.removeProvider(id)).catch(() => undefined);
  };
  const own = kind === 'connection' || kind === 'mcp';
  const docs = PROVIDERS.find((p) => p.id === c.provider)?.docsUrl;
  const on = c.status !== 'off';
  return (
    <div className="pv-card">
      <div className="ds-card-head">
        <div className="ds-row-main">
          <div className="ds-row-title">{c.label}</div>
          <div className="ds-row-meta">{[c.label !== c.name ? c.name : '', c.note, c.plan, c.keyHint ? `••••${c.keyHint}` : ''].filter(Boolean).join(' · ')}</div>
          <Chip tone={tone}>{busy ? 'Testing…' : word}</Chip>
        </div>
        <Menu
          label={`More for ${c.label}`}
          items={[
            own && { label: 'Test', hint: 'One cheap read-only call', onSelect: () => void test() },
            kind === 'mcp' && { label: on ? 'Turn off' : 'Turn on', onSelect: () => void api.setMcpServer(id, { on: !on }).catch(() => undefined) },
            kind === 'mcp' && { label: 'Who gets it', onSelect: () => onWho(id) },
            !!c.settings && { label: `Open ${SETTINGS_NAME[c.settings]}`, hint: 'Test, change or remove it there', onSelect: () => go(c.settings!) },
            !!docs && { label: 'Docs', onSelect: () => void window.open(docs, '_blank', 'noopener') },
            own && { label: 'Remove', danger: true, onSelect: () => void remove() },
          ]}
        />
      </div>
      {c.warning && (
        <div className="pv-warning" role="status">
          <Icon name="triangle-alert" /> {c.warning}
        </div>
      )}
      {source?.windows.map((w) => <WindowBar key={w.name} w={w} now={now} />)}
      {source?.note && source.windows.length > 0 && <div className="ds-row-meta">{source.note}</div>}
      <div className="ds-row-meta">What uses it: {c.uses.length ? c.uses.join(', ') : 'nothing yet'}</div>
    </div>
  );
}

/** "+ Add provider": the catalogue by category, then the key, a sign-in, or an MCP server's form. */
function AddSheet({ onClose }: { onClose: () => void }) {
  const [pick, setPick] = useState<ProviderDef | 'mcp' | null>(null);
  return (
    <Sheet title={pick === null ? 'Add provider' : pick === 'mcp' ? 'Add an MCP server' : `Add ${pick.name}`} onClose={onClose} className="pv-sheet">
      {pick === null ? (
        <>
          {CATEGORIES.map((cat) => {
            const list = PROVIDERS.filter((p) => p.category === cat.id);
            return (
              <div key={cat.id} className="pv-cat">
                <h4>
                  <Icon name={CATEGORY_ICON[cat.id]} /> {cat.label}
                </h4>
                {cat.id === 'mcp' ? (
                  <button className="pv-pick" onClick={() => setPick('mcp')}>
                    <b>MCP server</b>
                    <span className="muted small">A command or a URL, for agents' sessions</span>
                  </button>
                ) : list.length ? (
                  list.map((p) => (
                    <button key={p.id} className="pv-pick" onClick={() => setPick(p)}>
                      <b>
                        {p.icon && <Icon name={p.icon as IconName} />} {p.name}
                      </b>
                      <span className="muted small">{p.blurb}</span>
                    </button>
                  ))
                ) : (
                  <p className="muted small">None in the catalogue yet: tell the CEO which one you'd like.</p>
                )}
              </div>
            );
          })}
        </>
      ) : (
        <>
          <button className="btn btn-small" onClick={() => setPick(null)}>
            <Icon name="chevron-left" /> All providers
          </button>
          {pick === 'mcp' ? <McpForm onDone={onClose} /> : <KeyForm def={pick} onDone={onClose} />}
        </>
      )}
    </Sheet>
  );
}

function KeyForm({ def, onDone }: { def: ProviderDef; onDone: () => void }) {
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const reuses = useStore((s) => (def.sharesKeyWith ? s.providers.connections.find((c) => c.provider === def.sharesKeyWith) : undefined));
  if (def.home === 'accounts' || def.home === 'own-setup') {
    return (
      <div className="acc-form">
        <p className="small">{def.home === 'accounts' ? `${def.name} signs in with a login or an API key, with rotation and tags: add it in Providers & accounts.` : `${def.name} ${def.blurb.toLowerCase()}. The office runs it as it is.`}</p>
        {def.home === 'accounts' && (
          <button
            className="btn btn-primary"
            onClick={() => {
              onDone();
              go('accounts');
            }}
          >
            <Icon name="key-round" /> Sign in or add a key
          </button>
        )}
      </div>
    );
  }
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNote('');
    try {
      if (def.home === 'voice') await api.setVoiceKey(key);
      else if (def.home === 'cloud') await api.setCloudKey(key);
      else {
        const c = await api.addProvider(def.id, key, label);
        if (c.test && !c.test.ok) {
          setNote(`Saved, but its test said: ${c.test.note}`);
          return;
        }
      }
      onDone();
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="acc-form" onSubmit={(e) => void save(e)}>
      <p className="muted small">
        {def.blurb}. <a href={def.docsUrl} target="_blank" rel="noopener noreferrer">Where to get a key</a>
      </p>
      {def.note && <p className="muted small">{def.note}</p>}
      {def.home === 'providers' && (
        <label className="field">
          <span>Name</span>
          <input value={label} maxLength={60} placeholder={def.name} onChange={(e) => setLabel(e.target.value)} />
        </label>
      )}
      <label className="field">
        <span>API key</span>
        <SecretInput name={`provider-${def.id}`} value={key} placeholder={def.placeholder} onChange={(e) => setKey(e.target.value)} />
      </label>
      {reuses && !key.trim() && <p className="muted small">Leave it empty to use {reuses.label} (••••{reuses.keyHint}).</p>}
      <button className="btn btn-primary" disabled={busy || (!key.trim() && !reuses)}>
        {busy ? 'Testing…' : 'Save and test'}
      </button>
      {note && (
        <p className="small" role="status">
          {note}
        </p>
      )}
    </form>
  );
}

function McpForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [where, setWhere] = useState('');
  const [secrets, setSecrets] = useState<[string, string][]>([['', '']]);
  const [note, setNote] = useState('');
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const url = /^https?:\/\//.test(where.trim());
    try {
      const m = await api.addMcpServer({ name, ...(url ? { url: where } : { command: where }), secrets: Object.fromEntries(secrets.filter(([k, v]) => k.trim() && v.trim()).map(([k, v]) => [k.trim(), v])) });
      await api.testMcpServer(m.id).catch(() => undefined);
      onDone();
    } catch (err) {
      setNote((err as Error).message);
    }
  };
  return (
    <form className="acc-form" onSubmit={(e) => void save(e)}>
      <p className="muted small">Agents on this computer get it in their Claude Code sessions' own MCP config (never your ~/.claude). Cloud agents don't, yet.</p>
      <label className="field">
        <span>Name</span>
        <input value={name} maxLength={40} placeholder="github" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>Command or URL</span>
        <input value={where} maxLength={500} placeholder="npx -y @modelcontextprotocol/server-github" spellCheck={false} autoCapitalize="off" onChange={(e) => setWhere(e.target.value)} />
      </label>
      <span className="small">Secrets (environment variables for a command, headers for a URL)</span>
      {secrets.map(([k, v], i) => (
        <div key={i} className="pv-secret">
          <input aria-label="Secret name" value={k} placeholder="GITHUB_TOKEN" spellCheck={false} autoCapitalize="off" onChange={(e) => setSecrets(secrets.map((s, j) => (j === i ? [e.target.value, s[1]] : s)))} />
          <SecretInput name={`mcp-secret-${i}`} aria-label="Secret value" value={v} placeholder="value" onChange={(e) => setSecrets(secrets.map((s, j) => (j === i ? [s[0], e.target.value] : s)))} />
        </div>
      ))}
      <button type="button" className="btn btn-small" onClick={() => setSecrets([...secrets, ['', '']])}>
        <Icon name="plus" /> Another secret
      </button>
      <button className="btn btn-primary" disabled={!name.trim() || !where.trim()}>
        Add and test
      </button>
      {note && (
        <p className="small" role="status">
          {note}
        </p>
      )}
    </form>
  );
}

/** Which agents get an MCP server: everyone, or the ones ticked. */
function WhoSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const m = useStore((s) => s.providers.mcp.find((x) => x.id === id));
  const agents = useStore((s) => s.agents);
  const workers = Object.values(agents).filter((a) => a.role !== 'ceo');
  if (!m) return null;
  const set = (list: string[]) => void api.setMcpServer(id, { agents: list }).catch(() => undefined);
  return (
    <Sheet title={`Who gets ${m.name}`} onClose={onClose} className="pv-sheet">
      <label className="pv-check">
        <input type="checkbox" checked={!m.agents.length} onChange={(e) => set(e.target.checked ? [] : workers.slice(0, 1).map((a) => a.id))} />
        Every agent
      </label>
      {workers.map((a) => (
        <label key={a.id} className="pv-check">
          <input type="checkbox" disabled={!m.agents.length || (m.agents.length === 1 && m.agents.includes(a.id))} checked={!m.agents.length || m.agents.includes(a.id)} onChange={(e) => set(e.target.checked ? [...m.agents, a.id] : m.agents.filter((x) => x !== a.id))} />
          {a.name}
        </label>
      ))}
    </Sheet>
  );
}

// ---------- keys found on this computer (#367) ----------

const CHECK: Record<KeyCheck, [string, ChipTone]> = { live: ['Live', 'good'], dead: ['Dead', 'bad'], 'no-credit': ['No credit', 'warn'], unknown: ['Not tested', 'plain'] };

function FoundKeysCard() {
  const scan = useStore((s) => s.keyScan);
  const open = useKeyReview((s) => s.open);
  const scanning = scan.state === 'scanning';
  return (
    <section className="card pv-group" aria-label="Keys found on this computer">
      <div className="pv-top">
        <h4>
          <Icon name="key-round" /> Keys found on this computer
        </h4>
        <button className="btn" disabled={scanning} onClick={() => void api.scanKeys().catch(() => undefined)}>
          <Icon name="search" /> {scanning ? 'Scanning…' : scan.state === 'idle' ? 'Scan' : 'Scan again'}
        </button>
      </div>
      <p className="muted small">The shut-down projects (Mimule, Control Surface, NewsBites, LiteLLM…) left API keys on this computer. Scan finds them, tests each one with its provider, and shows only the last 4 characters. Nothing is saved until you import it.</p>
      {scan.state === 'failed' && (
        <p className="small" role="status">
          The scan failed: {scan.note}
        </p>
      )}
      {scan.state === 'done' && (
        <div className="pv-top">
          <span className="small">{scanSummary(scan.keys)}</span>
          {scan.keys.length > 0 && (
            <button className="btn btn-primary" onClick={() => useKeyReview.setState({ open: true })}>
              Review
            </button>
          )}
        </div>
      )}
      {open && <FoundKeysSheet key={scan.at ?? 0} keys={scan.keys} onClose={() => useKeyReview.setState({ open: false })} />}
    </section>
  );
}

function FoundKeysSheet({ keys, onClose }: { keys: FoundKeyView[]; onClose: () => void }) {
  // Live ones ticked (the sheet starts afresh after each scan: its key is the scan's time).
  const [picked, setPicked] = useState(() => new Set(keys.filter((k) => k.importable && k.check?.result === 'live').map((k) => k.id)));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const ids = keys.filter((k) => k.importable && picked.has(k.id)).map((k) => k.id);
  const toggle = (id: string, on: boolean) => setPicked((p) => new Set([...p].filter((x) => x !== id).concat(on ? [id] : [])));
  const importSelected = async () => {
    setBusy(true);
    try {
      const r = await api.importKeys(ids);
      setNote([`Imported ${r.imported}.`, ...r.skipped].join(' '));
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const forget = async () => {
    const ok = await confirmDialog({ title: 'Forget this list?', body: "The keys leave the office's memory. The files they came from stay as they are; Scan finds them again.", icon: 'trash-2', confirm: 'Forget', tone: 'danger' });
    if (!ok) return;
    await api.dismissKeys().catch(() => undefined);
    onClose();
  };
  return (
    <Sheet title="Keys found on this computer" onClose={onClose} className="pv-sheet">
      <div className="pv-top">
        <span className="small">{scanSummary(keys)}</span>
        <Menu
          label="More for the keys found"
          items={[
            { label: 'Scan again', onSelect: () => void api.scanKeys().catch(() => undefined) },
            { label: 'Forget this list', danger: true, onSelect: () => void forget() },
          ]}
        />
      </div>
      <p className="pv-warning small" role="note">
        <Icon name="triangle-alert" /> These keys belonged to retired projects: once the ones you keep work here, think about rotating them at each provider.
      </p>
      {keys.map((k) => {
        const def = PROVIDERS.find((p) => p.id === k.provider);
        const [word, tone] = k.savedAs ? (['Saved', 'good'] as const) : CHECK[k.check?.result ?? 'unknown'];
        const why = k.savedAs ? `Saved as ${k.savedAs}` : !k.importable ? 'No integration to import it into yet' : k.check?.note;
        return (
          <label key={k.id} className="pv-card pv-found">
            <input type="checkbox" disabled={!k.importable} checked={k.importable && picked.has(k.id)} onChange={(e) => toggle(k.id, e.target.checked)} aria-label={`Import ${def?.name ?? k.variable} ••••${k.keyHint}`} />
            <Icon name={def ? CATEGORY_ICON[def.category] : 'key-round'} />
            <span className="ds-row-main">
              <span className="ds-row-title">
                {def?.name ?? 'Unknown provider'} ••••{k.keyHint}
              </span>
              <span className="ds-row-meta">{[k.variable, k.sources.join(' + ')].join(' · ')}</span>
              {why && <span className="ds-row-meta">{why}</span>}
            </span>
            <Chip tone={tone}>{word}</Chip>
          </label>
        );
      })}
      <button className="btn btn-primary" disabled={busy || !ids.length} onClick={() => void importSelected()}>
        {busy ? 'Importing…' : `Import selected (${ids.length})`}
      </button>
      {note && (
        <p className="small" role="status">
          {note}
        </p>
      )}
    </Sheet>
  );
}
