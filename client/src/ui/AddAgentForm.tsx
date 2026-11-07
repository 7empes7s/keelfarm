// A floor's "+ Agent" form (#243), shared by Settings → Team (a row of fields) and the Team page's sheet (labelled
// fields, the floor's team as a bar, the reason when it's full and errors inside it): an optional name and their
// coding agent, model and effort ('' = the office's defaults).
import { useState, type ReactNode } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { AgentCli, AgentView, EffortLevel, RepoView } from '../../../shared/types';
import { CLAUDE_MODELS, effectiveModel, modelAfterCliChange } from '../../../shared/models';
import { ModelPicker } from './ModelPicker';
import { CliOptions, cliName, EFFORTS } from './AgentSettings';
import { ProgressBar } from './ProgressBar';
import { hirePayload, NO_SETUP, teamFill, type NewAgent } from './addAgent';
import './addAgent.css';
import { Icon } from './Icon';

interface Props {
  repo: RepoView;
  size: number; // the floor's team now
  sheet?: boolean;
  onAdded?: (agent: AgentView) => void;
}

/** In the sheet each field has its name above it; in Settings → Team the fields are a row named by their aria-labels. */
function Field({ sheet, label, children }: { sheet?: boolean; label: string; children: ReactNode }) {
  if (!sheet) return children;
  return (
    <div className="field">
      <span>{label}</span>
      {children}
    </div>
  );
}

export function AddAgentForm({ repo, size, sheet, onAdded }: Props) {
  const settings = useStore((s) => s.settings);
  const clis = useStore((s) => s.clis);
  const models = useStore((s) => s.models);
  const openOverlay = useStore((s) => s.openOverlay);
  const [draft, setDraft] = useState<NewAgent>(NO_SETUP);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const terminal = settings.runtime === 'terminal';
  const cli = terminal ? draft.cli || settings.defaultCli : 'claude';
  const fill = teamFill(repo.floor, size, settings.maxAgents);
  const fullWhy = `Floor ${repo.floor} has its most agents (${settings.maxAgents}): change it in Settings → Agents → Most agents per floor`;
  const edit = (p: Partial<NewAgent>) => setDraft({ ...draft, ...p });
  const add = async () => {
    setBusy(true);
    setError('');
    try {
      // The sheet shows its own errors; the row keeps the toast it always had.
      const agent = await api.hireAgent(repo.id, hirePayload(draft), !sheet);
      setDraft(NO_SETUP);
      onAdded?.(agent);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className={sheet ? 'add-agent-sheet' : 'ds-fields add-agent'}
      id={sheet ? undefined : `add-agent-${repo.floor}`}
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <Field sheet={sheet} label="Name">
        <input value={draft.name} onChange={(e) => edit({ name: e.target.value })} placeholder="Name (optional)" maxLength={24} aria-label={`New agent's name on floor ${repo.floor}`} />
      </Field>
      {terminal && (
        <Field sheet={sheet} label="Coding agent">
          <select
            value={draft.cli}
            onChange={(e) => {
              const next = e.target.value as AgentCli | '';
              edit({ cli: next, model: modelAfterCliChange(draft.model, next || settings.defaultCli, models) });
            }}
            aria-label="New agent's coding agent"
          >
            <option value="">{cliName(clis, settings.defaultCli)} (default)</option>
            <CliOptions clis={clis} />
          </select>
        </Field>
      )}
      <Field sheet={sheet} label="Model">
        <ModelPicker cli={cli} value={draft.model} label="New agent's model" resolvedDefault={effectiveModel('', cli, settings, CLAUDE_MODELS[0])} onChange={(model) => edit({ model })} />
      </Field>
      <Field sheet={sheet} label="Effort">
        <select value={draft.effort} onChange={(e) => edit({ effort: e.target.value as EffortLevel | '' })} aria-label="New agent's effort">
          <option value="">default effort ({settings.defaultEffort})</option>
          {EFFORTS.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </Field>
      {sheet && <ProgressBar label={fill.label} value={fill.value} pct={fill.pct} tone={fill.full ? 'warn' : 'neutral'} aria={`Floor ${repo.floor}: ${fill.value}`} />}
      {sheet && fill.full && (
        <p className="small add-agent-full">
          <Icon name="circle-alert" /> Floor {repo.floor} is full ({settings.maxAgents} agents).{' '}
          <button type="button" className="linkish" onClick={() => openOverlay({ kind: 'manager', tab: 'agents' })}>
            Change Most agents per floor
          </button>
        </p>
      )}
      {sheet && error && (
        <div className="term-error small" role="alert">
          <Icon name="triangle-alert" /> {error}
        </div>
      )}
      <span className="add-agent-go" title={fill.full && !sheet ? fullWhy : undefined}>
        <button className="btn btn-small btn-good" disabled={busy || fill.full}>
          {sheet ? (busy ? 'Adding…' : 'Add') : '+ Agent'}
        </button>
      </span>
    </form>
  );
}
