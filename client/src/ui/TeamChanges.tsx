import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../api';
import { pendingRequests, useStore } from '../store';
import type { AgentCli, CliView, EffortLevel, HireRequestView, MachineHost, SwarmSettings } from '../../../shared/types';
import { Markdown } from './Markdown';
import { DecisionList } from './Decisions';
import { CLAUDE_MODELS, effectiveModel, modelSuggestions } from '../../../shared/models';
import { attempt, Avatar } from './phoneParts';

// Team changes on the phone and in the lobby: a new agent's setup, the résumé card that approves or rejects a change, and the list.

// ---------- team changes ----------

/** Every reasoning effort, lowest first ('' = the office default). */
const EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** A coding agent's name, as the office lists it. */
export const cliLabel = (clis: CliView[], id: AgentCli) => clis.find((c) => c.id === id)?.label ?? id;

/** The coding agent a new agent will run: their own pick, else the office default; the Agent SDK runtime is Claude Code for everyone. */
export const hireCli = (cli: AgentCli | '', settings: Pick<SwarmSettings, 'runtime' | 'defaultCli'>): AgentCli =>
  settings.runtime !== 'terminal' ? 'claude' : cli || settings.defaultCli;

/** What the manager can set up on a new agent before hiring them: the CEO's picks to start with ('' = the office default). */
export interface HireSetup {
  name: string;
  cli: AgentCli | '';
  model: string;
  effort: EffortLevel | '';
  host: MachineHost | ''; // where they'll work ('' = the office default, Settings → Cloud agents)
}

export const setupOf = (r: HireRequestView): HireSetup => ({ name: r.name, cli: r.cli, model: r.model, effort: r.effort, host: r.host ?? '' });

/** The approval's overrides: the setup as the manager left it, an emptied name back to the CEO's pick. */
export const hireOverrides = (r: HireRequestView, s: HireSetup) => ({ name: s.name.trim() || r.name, cli: s.cli, model: s.model.trim(), effort: s.effort, host: s.host });

/** "Claude Code · claude-opus-5-5 · medium effort": what they'll run, the office defaults filled in. */
export function setupLine(s: Pick<HireSetup, 'cli' | 'model' | 'effort'>, settings: SwarmSettings, clis: CliView[]) {
  const cli = hireCli(s.cli, settings);
  return `${cliLabel(clis, cli)} · ${effectiveModel(s.model, cli, settings, CLAUDE_MODELS[0]) || 'its default model'} · ${s.effort || settings.defaultEffort} effort`;
}

/** A new agent's settings, edited before they're created: the lobby's card and the phone's both use these. */
export function HireSetupFields({ value, onChange, disabled }: { value: HireSetup; onChange: (v: HireSetup) => void; disabled?: boolean }) {
  const settings = useStore((s) => s.settings);
  const clis = useStore((s) => s.clis);
  const id = useId();
  const cloudKey = useStore((s) => s.cloud.keySet);
  const sdk = settings.runtime !== 'terminal';
  const cli = hireCli(value.cli, settings);
  const set = (patch: Partial<HireSetup>) => onChange({ ...value, ...patch });
  return (
    <div className="hire-setup">
      <label className="field" htmlFor={`${id}-name`}>
        <span>Name</span>
        <input id={`${id}-name`} value={value.name} maxLength={24} disabled={disabled} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <label className="field" htmlFor={`${id}-cli`}>
        <span>Coding agent</span>
        <select
          id={`${id}-cli`}
          value={sdk ? '' : value.cli}
          disabled={disabled || sdk}
          title={sdk ? 'The Agent SDK runs Claude Code for every agent (Settings → How agents run)' : undefined}
          onChange={(e) => set({ cli: e.target.value as AgentCli | '' })}
        >
          <option value="">{sdk ? 'Claude Code' : `${cliLabel(clis, settings.defaultCli)} (default)`}</option>
          {[...clis]
            .sort((a, b) => Number(b.installed) - Number(a.installed))
            .map((c) => (
              <option key={c.id} value={c.id} disabled={!c.installed}>
                {c.label}
                {c.installed ? '' : ' (not installed)'}
              </option>
            ))}
        </select>
      </label>
      <label className="field" htmlFor={`${id}-model`}>
        <span>Model</span>
        <input
          id={`${id}-model`}
          list={`${id}-models`}
          value={value.model}
          disabled={disabled}
          placeholder={effectiveModel('', cli, settings, CLAUDE_MODELS[0]) || 'agent default'}
          title="Empty: the default for their coding agent"
          onChange={(e) => set({ model: e.target.value })}
        />
        <datalist id={`${id}-models`}>
          {modelSuggestions(cli).map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      <label className="field" htmlFor={`${id}-effort`}>
        <span>Effort</span>
        <select id={`${id}-effort`} value={value.effort} disabled={disabled} onChange={(e) => set({ effort: e.target.value as EffortLevel | '' })}>
          <option value="">default ({settings.defaultEffort})</option>
          {EFFORTS.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </label>
      {(cloudKey || value.host === 'box') && (
        <label className="field" htmlFor={`${id}-host`}>
          <span>Works on</span>
          <select id={`${id}-host`} value={value.host} disabled={disabled} onChange={(e) => set({ host: e.target.value as MachineHost | '' })}>
            <option value="">{settings.cloud.machineKind === 'box' ? '☁️ Upstash Box' : '🖥️ This computer'} (default)</option>
            <option value="local">🖥️ This computer</option>
            <option value="box" disabled={cli === 'opencode'}>
              ☁️ Upstash Box{cli === 'opencode' ? " (OpenCode can't run there)" : ''}
            </option>
          </select>
        </label>
      )}
    </div>
  );
}

/**
 * One team change as a card (the phone, the console, pocket mode): a new agent, with what they'll run and a way to
 * change it before hiring them, or an agent the CEO would let go. The CEO's reason either way.
 */
export function Resume({ req, highlight }: { req: HireRequestView; highlight?: boolean }) {
  const repo = useStore((s) => s.repos.find((r) => r.id === req.repoId));
  const settings = useStore((s) => s.settings);
  const clis = useStore((s) => s.clis);
  const [setup, setSetup] = useState(() => setupOf(req));
  const [editing, setEditing] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ block: 'center' });
  }, [highlight]);
  const pending = req.status === 'pending';
  const hire = req.kind === 'hire';
  const name = (hire && pending && setup.name.trim()) || req.name;
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await attempt(fn);
    setBusy(false);
  };
  const outcome = req.status === 'approved' ? (hire ? '✅ hired' : '👋 left') : hire ? '✋ declined' : '🤝 kept';
  return (
    <div ref={ref} className={`resume ${hire ? '' : 'resume-letgo'} ${highlight ? 'resume-hot' : ''} ${pending ? '' : 'resume-done'}`}>
      <div className="resume-head">
        <Avatar name={name} color={req.color} size={42} />
        <div className="grow">
          <div className="resume-name">{hire ? name : `Let ${req.name} go?`}</div>
          <div className="resume-title">{hire ? 'A new agent' : 'Leaving the team'}</div>
        </div>
        {!pending && <span className={`chip ${req.status === 'approved' ? 'chip-good' : ''}`}>{outcome}</span>}
      </div>
      <div className="resume-meta">
        <span className="chip" style={{ background: repo?.color }}>
          Floor {repo?.floor ?? '?'}
        </span>
        <span className="muted small">{repo?.fullName.split('/')[1] ?? 'removed floor'}</span>
      </div>
      {req.reason && <Markdown className="resume-reason" text={req.reason} />}
      {hire && (
        <div className="resume-meta small">
          <span className="grow">⚙️ {setupLine(pending ? setup : req, settings, clis)}</span>
          {pending && (
            <button className="linkish small" aria-expanded={editing} onClick={() => setEditing(!editing)}>
              {editing ? 'Done' : 'Change'}
            </button>
          )}
        </div>
      )}
      {hire && pending && editing && <HireSetupFields value={setup} onChange={setSetup} disabled={busy} />}
      {!pending && req.note && <div className="muted small">Your note: “{req.note}”</div>}
      {pending && !declining && (
        <div className="ds-decision">
          <button className="btn btn-small btn-ghost" data-decision disabled={busy} onClick={() => setDeclining(true)}>
            {hire ? 'Decline' : 'Keep them'}
          </button>
          <button className="btn btn-small btn-good" data-decision disabled={busy} onClick={() => act(() => api.approveRequest(req.id, hire ? hireOverrides(req, setup) : {}))}>
            {hire ? `Hire ${name}` : `Let ${req.name} go`}
          </button>
        </div>
      )}
      {pending && declining && (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() => api.rejectRequest(req.id, note));
          }}
        >
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why not? (optional, the CEO reads it)" autoFocus />
          <button className="btn btn-small btn-bad" data-decision disabled={busy}>
            {hire ? 'Decline' : 'Keep'}
          </button>
        </form>
      )}
    </div>
  );
}

/** New agents waiting in the lobby to be set up and hired, with a way down to meet them (unless you're there already). */
export function LobbyNudge() {
  const n = useStore((s) => pendingRequests(s.requests).filter((r) => r.kind === 'hire').length);
  const inLobby = useStore((s) => s.floor === 0);
  const goToFloor = useStore((s) => s.goToFloor);
  if (!n) return null;
  return (
    <div className="phone-nudge" role="status">
      <span>🪑</span>
      <span className="grow">
        {n} new agent{n === 1 ? ' is' : 's are'} waiting in the lobby
      </span>
      {!inLobby && (
        <button className="btn btn-small" onClick={() => goToFloor(0)}>
          Meet them
        </button>
      )}
    </div>
  );
}

export function TeamChanges({ focusId }: { focusId?: string }) {
  const requests = useStore((s) => s.requests);
  const demo = useStore((s) => s.demo);
  const pending = pendingRequests(requests);
  const decided = requests.filter((r) => r.status !== 'pending').slice(-8).reverse();
  return (
    <div className="phone-scroll">
      <h3 className="phone-h">👥 Waiting on you {pending.length > 0 && <span className="badge">{pending.length}</span>}</h3>
      {pending.length === 0 && <p className="muted small phone-empty">Nothing waiting. When the CEO wants a floor's team to grow or shrink, the change shows up here for your OK.</p>}
      {pending.map((r) => (
        <Resume key={r.id} req={r} highlight={r.id === focusId} />
      ))}
      <DecisionList heading={(t) => <h3 className="phone-h">{t}</h3>} />
      {demo && (
        <div className="row wrap">
          <span className="muted small">Demo:</span>
          <button className="btn btn-small btn-ghost" onClick={() => void attempt(() => api.demoPropose('hire'))}>
            👥 Grow a floor
          </button>
          <button className="btn btn-small btn-ghost" onClick={() => void attempt(() => api.demoPropose('let-go'))}>
            ✉️ Shrink a floor
          </button>
        </div>
      )}
      {decided.length > 0 && (
        <>
          <h3 className="phone-h">Earlier</h3>
          {decided.map((r) => (
            <Resume key={r.id} req={r} />
          ))}
        </>
      )}
    </div>
  );
}
