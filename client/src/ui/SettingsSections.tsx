// The console's Settings sections that are the office's own settings (#102): agents' defaults, the CEO's settings, how
// agents run, the company and its previews, and About this office (the environment, kept out of the way). Each one is a section of its
// own in the side menu (consoleNavRules.ts); the other sections are their own components.
import { api } from '../api';
import { useStore } from '../store';
import { CEO_ID, DEFAULT_MAX_AGENTS, FLOOR_SEATS, type AgentCli, type EffortLevel, type UsageWarningChoice } from '../../../shared/types';
import { usageChoice, USAGE_WARNING_CHOICES } from '../../../shared/usage';
import { CLAUDE_MODELS, modelLabel } from '../../../shared/models';
import { conflictFixSettings } from '../../../shared/conflicts';
import { CEO_MODEL_KINDS, isAutomatedJob, type CeoModelKind } from '../../../shared/ceoModels';
import { ModelPicker } from './ModelPicker';
import { CliOptions, cliName, EFFORTS } from './AgentSettings';
import { DiskFields } from './DiskCard';
import { MemoryFields } from './HealthStrip';
import { TestLabFields } from './TestLab';
import { EffortByKind } from './CostsSection';
import { AwakeSettings, FollowupSettings } from './CeoFollowups';
import { useChatMode } from './chatMode';
import { openWhatsNew, useTour } from './tour';
import { TutorialsHub } from './TaskTutorial';
import { Icon } from './Icon';
import { OfficeRow } from './ManagerConsole';
import { PR_PREVIEW_SLOTS } from './channels';
import { STATUS_EMOJI } from '../../../shared/reactions';

type SettingsPatch = Parameters<typeof api.updateSettings>[0];
const set = (p: SettingsPatch) => void api.updateSettings(p).catch(() => undefined); // api() already toasted the error

/** Where the model lists come from, when they were checked, and a Refresh (#198). */
function CatalogStatus() {
  const models = useStore((s) => s.models);
  const live = models.entries.find((e) => e.cli === 'claude')?.source === 'live';
  const when = models.checkedAt ? new Date(models.checkedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'never';
  return (
    <div className="row wrap small">
      <span className="grow muted">{models.refreshing ? 'Checking the coding agents’ models…' : `Claude models: ${live ? 'live list' : 'built-in list'}, checked ${when}`}</span>
      <button className="btn btn-small" disabled={models.refreshing} onClick={() => void api.refreshModels().catch(() => undefined)}>
        Refresh
      </button>
    </div>
  );
}

export function AgentsSettings() {
  const settings = useStore((s) => s.settings);
  const clis = useStore((s) => s.clis);
  const terminal = settings.runtime === 'terminal';
  const defaultCli = terminal ? settings.defaultCli : 'claude';
  return (
    <div className="card">
      <h3>
        <Icon name="laptop" /> Agents
      </h3>
      {terminal && (
        <label className="field">
          <span>Default coding agent</span>
          <select value={settings.defaultCli} onChange={(e) => set({ defaultCli: e.target.value as AgentCli })}>
            <CliOptions clis={clis} builders />
          </select>
        </label>
      )}
      <label className="field" htmlFor="default-model">
        <span>Default model{terminal ? ` for ${cliName(clis, settings.defaultCli)}` : ''}</span>
        <ModelPicker id="default-model" cli={defaultCli} value={settings.defaultModel} resolvedDefault={defaultCli === 'claude' ? CLAUDE_MODELS[0] : ''} onChange={(defaultModel) => set({ defaultModel })} />
      </label>
      <CatalogStatus />
      <label className="field">
        <span>Default effort</span>
        <select value={settings.defaultEffort} onChange={(e) => set({ defaultEffort: e.target.value as EffortLevel })}>
          {EFFORTS.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </label>
      <EffortByKind />
      <ConflictFixFields />
      <p className="muted small">
        {terminal
          ? 'Each agent can use their own coding agent, model and effort (Team tab); the CEO picks its own on its card in The CEO. Claude Code reports every step; Codex and OpenCode are experimental: the office sees their task rather than each step. They can also run a model on this computer: name it ollama/…, lmstudio/…, llamacpp/… or omlx/….'
          : 'The Agent SDK runs Claude Code. Each agent can use their own model and effort (Team tab).'}
      </p>
      <label className="field">
        <span>Session limit</span>
        <input type="number" min={0} placeholder="No limit" defaultValue={settings.sessionLimit || ''} onBlur={(e) => set({ sessionLimit: Number(e.target.value) || 0 })} />
      </label>
      <p className="muted small">
        Leave empty so every agent with work runs at once. Agents on the same coding agent share its subscription's usage limits, and each one is its own process on this PC, so set a limit if
        you hit either.
      </p>
      <MemoryFields memory={settings.memory} set={set} />
      <DiskFields disk={settings.disk} />
      <TestLabFields testLab={settings.testLab} set={set} />
      <label className="field">
        <span>Sessions while pacing</span>
        <input
          key={settings.pacingSessions}
          type="number"
          min={1}
          max={32}
          defaultValue={settings.pacingSessions}
          onBlur={(e) => Number(e.target.value) !== settings.pacingSessions && set({ pacingSessions: Number(e.target.value) || 3 })}
        />
      </label>
      <p className="muted small">When Claude warns that usage is getting high, new issues only start while fewer sessions than this are running. QA, fixes and the CEO carry on.</p>
      <label className="field" data-tour="pacing">
        <span>When Claude warns that usage is high</span>
        <select value={usageChoice(settings.usageWarnings)} onChange={(e) => set({ usageWarnings: e.target.value as UsageWarningChoice })}>
          {USAGE_WARNING_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small">
        Pace new work: your Resume full speed holds for that usage window, restarts included. Keep full speed: warnings show but never pace. Ask me each time: pace, and ask again after a restart. Reaching
        the limit still pauses new work.
      </p>
      <label className="field" data-tour="team-size">
        <span>Most agents per floor</span>
        <input
          key={settings.maxAgents}
          type="number"
          min={1}
          max={FLOOR_SEATS}
          defaultValue={settings.maxAgents}
          onBlur={(e) => {
            const n = Math.min(FLOOR_SEATS, Math.max(1, Math.round(Number(e.target.value)) || DEFAULT_MAX_AGENTS));
            if (n !== settings.maxAgents) set({ maxAgents: n });
          }}
        />
      </label>
      <p className="muted small">At most {FLOOR_SEATS}, one per desk. Adding agents past it is refused, by hand or by the CEO.</p>
    </div>
  );
}

/** Settings → Agents → Conflict-only fixes (#256): a cheaper model for fix rounds whose only cause is a merge conflict. */
function ConflictFixFields() {
  const every = useStore((s) => s.settings.everyProject);
  const fix = conflictFixSettings(every.conflictFix, {});
  const change = (patch: Partial<typeof fix>) => set({ everyProject: { ...every, conflictFix: { ...fix, ...patch } } });
  return (
    <div>
      <div className="small">
        <b>Conflict-only fixes</b>
      </div>
      <label className="field" htmlFor="conflict-fix-model">
        <span>Model</span>
        <ModelPicker id="conflict-fix-model" cli="claude" value={fix.model} resolvedDefault="" defaultLabel="The agent's own model (off)" label="Conflict-only fixes: model" onChange={(model) => change({ model })} />
      </label>
      <label className="field">
        <span>Effort</span>
        <select value={fix.effort} onChange={(e) => change({ effort: e.target.value as EffortLevel | '' })}>
          <option value="">The agent's own</option>
          {EFFORTS.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small">
        A fix round that only has to merge the base branch in (no QA findings, no red checks) runs on this model. A PR touching office logic ({fix.strongFiles.join(', ') || 'none listed'}) keeps the agent's own model, and so does the round after a cheap one.
      </p>
    </div>
  );
}

const JOB_NAMES: Record<CeoModelKind, string> = { chat: 'Chat with you', plan: 'Planning', research: 'Research', review: 'Company reviews', followup: 'Follow-ups', triage: 'Stuck PR triage' };

/** CEO settings → Model per job (#331): jobs the office starts by itself on a cheaper model, the rest always on the CEO's own (#332). */
function CeoModelsByJob() {
  const awake = useStore((s) => s.settings.ceoAwake);
  const models = awake.models;
  const ceoModel = useStore((s) => s.agents[CEO_ID]?.model) || CLAUDE_MODELS[0];
  const same = `Same as the CEO model (${modelLabel(ceoModel)})`;
  return (
    <div>
      <div className="small">
        <b>Model per job</b>
      </div>
      <label className="toggle block">
        <input type="checkbox" checked={awake.automatedOnCeo} onChange={(e) => set({ ceoAwake: { ...awake, automatedOnCeo: e.target.checked } })} />
        <span>
          <b>Run all automated jobs on {modelLabel(ceoModel)}</b>: reviews, follow-ups and triage use the CEO model, whatever is picked below.
        </span>
      </label>
      {CEO_MODEL_KINDS.map((kind) =>
        isAutomatedJob(kind) ? (
          <label key={kind} className="field" htmlFor={`ceo-model-${kind}`}>
            <span>{JOB_NAMES[kind]}</span>
            <ModelPicker id={`ceo-model-${kind}`} cli="claude" value={models[kind]} resolvedDefault={ceoModel} defaultLabel={same} label={`${JOB_NAMES[kind]}: model`} disabled={awake.automatedOnCeo} onChange={(m) => set({ ceoAwake: { ...awake, models: { ...models, [kind]: m } } })} />
          </label>
        ) : (
          <div key={kind} className="field">
            <span>{JOB_NAMES[kind]}</span>
            <span className="muted small">Always the CEO model ({modelLabel(ceoModel)})</span>
          </div>
        ),
      )}
      <p className="muted small">A job starts a fresh session when its model differs from the last one's. If a model isn't available, the job runs again on the CEO model and the office chat says so. A job's reply in the chat has Redo on {modelLabel(ceoModel)} when it ran on another model; CEO → Sessions → CEO jobs logs every job.</p>
    </div>
  );
}

export function CeoSettings() {
  const settings = useStore((s) => s.settings);
  return (
    <div className="card">
      <h3>
        <Icon name="sliders-horizontal" /> CEO settings
      </h3>
      <div role="radiogroup" aria-label="Team changes from the CEO">
        <div className="small">
          <b>Team changes from the CEO</b>
        </div>
        <label className="toggle block">
          <input type="radio" name="scaling" checked={settings.scaling === 'approve'} onChange={() => set({ scaling: 'approve' })} />
          <span>
            <b>I approve each one</b> (recommended): new agents wait in the lobby, where you can change their coding agent, model and effort before hiring them,
            and a let-go waits as an envelope on their desk.
          </span>
        </label>
        <label className="toggle block">
          <input type="radio" name="scaling" checked={settings.scaling === 'auto'} onChange={() => set({ scaling: 'auto' })} />
          <span>
            <b>Apply straight away</b>, up to the most agents per floor. Idle agents leave first; busy ones finish their task.
          </span>
        </label>
      </div>
      <label className="field">
        <span>Company review every (minutes, 0 = off)</span>
        <input type="number" min={0} max={1440} defaultValue={settings.ceoHeartbeatMin} onBlur={(e) => set({ ceoHeartbeatMin: Number(e.target.value) })} />
      </label>
      <p className="muted small">A review checks team sizes, stuck PRs and floor profiles, and is skipped when nothing changed since the last one. It never files issues: new work only comes from you. The CEO's own model and effort are in The CEO.</p>
      <CeoModelsByJob />
      <label className="field">
        <span>Research time budget (minutes)</span>
        <input type="number" min={5} max={120} defaultValue={settings.researchMin} onBlur={(e) => set({ researchMin: Number(e.target.value) })} />
      </label>
      <p className="muted small">Research (<Icon name="search" /> in the chat, or "Research first" in a floor's brief) only starts when you ask. At the budget the CEO wraps up with what it has; like every CEO job, it waits while Claude's usage is paused.</p>
      <label className="toggle block">
        <input type="checkbox" checked={!!settings.statusReactions} onChange={(e) => set({ statusReactions: e.target.checked })} />
        <span>
          <b>Status reactions</b>: {[STATUS_EMOJI.seen, STATUS_EMOJI.working, STATUS_EMOJI.done].join(' ')} under your messages while the CEO or an agent works on them. Off, the working strip shows it.
        </span>
      </label>
      <FollowupSettings />
      <AwakeSettings />
    </div>
  );
}

export function RuntimeSettings() {
  const runtime = useStore((s) => s.settings.runtime);
  const chat = useChatMode();
  return (
    <div className="card">
      <h3>
        <Icon name="keyboard" /> How agents run
      </h3>
      <label className="toggle block">
        <input type="radio" checked={runtime === 'terminal'} onChange={() => set({ runtime: 'terminal' })} />
        <span>
          <b>Real terminals</b> (recommended): every agent is its actual coding agent running in its own terminal. Open a desk to watch it live or type into it.
        </span>
      </label>
      <label className="toggle block">
        <input type="radio" checked={runtime === 'sdk'} onChange={() => set({ runtime: 'sdk' })} />
        <span>
          <b>Agent SDK</b>: Claude Code through the Claude Agent SDK, shown as a log of its steps. Claude Code only.
        </span>
      </label>
      <p className="muted small">
        Agents work like your own coding agents in a terminal, with your skills, MCP servers and settings, and don't stop to ask. The office's workflow (branches, pull requests, QA reporting
        back) is in their instructions.
      </p>
      <label className="toggle block">
        <input type="checkbox" checked={chat.on} onChange={(e) => chat.set(e.target.checked)} />
        <span>
          <b>Chat mode</b> (this device): desks, Team and Kanban open an agent's chat, their steps in plain words, instead of their terminal. Each window's Chat | Terminal switch changes it too.
        </span>
      </label>
    </div>
  );
}

export function CompanySettings() {
  const settings = useStore((s) => s.settings);
  const user = useStore((s) => s.user);
  const officeUpdate = useStore((s) => s.officeUpdate);
  return (
    <div className="card">
      <h3>
        <Icon name="store" /> Company
      </h3>
      <label className="field">
        <span>Your name</span>
        <input defaultValue={settings.managerName} placeholder={user ?? 'Boss'} onBlur={(e) => e.target.value !== settings.managerName && set({ managerName: e.target.value })} />
      </label>
      <label className="field">
        <span>Company name</span>
        <input defaultValue={settings.companyName} placeholder="cubefarm" onBlur={(e) => e.target.value !== settings.companyName && set({ companyName: e.target.value })} />
      </label>
      <label className="field">
        <span>The office dog's name</span>
        <input key={settings.dogName} defaultValue={settings.dogName} placeholder="Biscuit" maxLength={24} onBlur={(e) => e.target.value.trim() !== settings.dogName && set({ dogName: e.target.value })} />
      </label>
      <label className="field">
        <span>Projects folder (new projects are created here)</span>
        <input key={settings.projectsDir} defaultValue={settings.projectsDir} onBlur={(e) => e.target.value.trim() && e.target.value !== settings.projectsDir && set({ projectsDir: e.target.value })} />
      </label>
      <label className="field">
        <span>Free idle desks after (minutes, 0 = never)</span>
        <input
          key={settings.trimIdleDesksMin}
          type="number"
          min={0}
          max={10080}
          defaultValue={settings.trimIdleDesksMin}
          onBlur={(e) => e.target.value !== '' && Number(e.target.value) !== settings.trimIdleDesksMin && set({ trimIdleDesksMin: Number(e.target.value) })}
        />
      </label>
      <p className="muted small">A desk left idle this long loses its node_modules and build output to save disk space. Its next task installs them again.</p>
      <label className="field">
        <span>Stop a floor's app preview after (minutes unwatched, 0 = never)</span>
        <input key={settings.mainPreviewIdleMin} type="number" min={0} max={1440} defaultValue={settings.mainPreviewIdleMin} onBlur={(e) => e.target.value !== '' && Number(e.target.value) !== settings.mainPreviewIdleMin && set({ mainPreviewIdleMin: Number(e.target.value) })} />
      </label>
      <label className="field">
        <span>PRs get their own channel when updated within (hours)</span>
        <input key={settings.previewRecentHours} type="number" min={1} max={2160} defaultValue={settings.previewRecentHours} onBlur={(e) => e.target.value !== '' && Number(e.target.value) !== settings.previewRecentHours && set({ previewRecentHours: Number(e.target.value) })} />
      </label>
      <p className="muted small">Never while someone watches it or an agent tests in it. Older open PRs fold under “Older” in the app viewer.</p>
      <NumberField label="Re-check a PR waiting for you after (minutes)" value={settings.stuckRecheckMin ?? 30} max={1440} onSave={(n) => set({ stuckRecheckMin: n })} />
      <p className="muted small">If only a conflict or a CI outage holds it by then, it goes back to a developer or the merge gate by itself; otherwise the CEO looks at it again, at most every 2 hours.</p>
      {officeUpdate && <OfficeRow update={officeUpdate} />}
      {typeof settings.autoUpdate === 'boolean' && (
        <>
          <label className="field">
            <span>Update the office after merges settle (minutes)</span>
            <input key={settings.updateSettleMin ?? 3} type="number" min={0} max={60} defaultValue={settings.updateSettleMin ?? 3} onBlur={(e) => e.target.value !== '' && Number(e.target.value) !== settings.updateSettleMin && set({ updateSettleMin: Number(e.target.value) })} />
          </label>
          <p className="muted small">An automatic update waits this long after the latest merge (at most 15 minutes after the first), so a run of merges restarts the office once. Agents keep working meanwhile.</p>
        </>
      )}
      <div className="row">
        <button
          className="btn btn-small"
          onClick={() => {
            useTour.setState({ pocketTour: true, replay: null });
            set({ tutorialStep: 0 });
          }}
        >
          <Icon name="compass" /> Replay the tour
        </button>
        <button className="btn btn-small" onClick={() => openWhatsNew()}>
          <Icon name="sparkles" /> What's new
        </button>
      </div>
      <TutorialsHub />
    </div>
  );
}

/** A whole number of minutes or hours, saved on blur when it changed. */
function NumberField({ label, value, max, onSave }: { label: string; value: number; max: number; onSave: (n: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input key={value} type="number" inputMode="numeric" min={0} max={max} defaultValue={value} onBlur={(e) => e.target.value !== '' && Number(e.target.value) !== value && onSave(Number(e.target.value))} />
    </label>
  );
}

/** Settings → Previews (#252): when unused previews stop and free their memory, their max lifetime, and how many run at once. */
export function PreviewsSettings() {
  const settings = useStore((s) => s.settings);
  return (
    <div className="card">
      <h3>
        <Icon name="monitor" /> Previews
      </h3>
      <p className="muted small">A preview is in use while it's on screen in the app viewer or open in its own tab. Once nobody uses it, it stops after this long and frees its port and memory. Never while an agent tests in it or you keep it running from the viewer's More menu.</p>
      <NumberField label="Stop a PR preview after no use (minutes, 0 = never)" value={settings.prPreviewIdleMin} max={1440} onSave={(n) => set({ prPreviewIdleMin: n })} />
      <NumberField label="Stop a floor's main preview after no use (minutes, 0 = never)" value={settings.mainPreviewIdleMin} max={1440} onSave={(n) => set({ mainPreviewIdleMin: n })} />
      <NumberField label="Max lifetime (hours, 0 = off)" value={settings.previewMaxLifeHours} max={168} onSave={(n) => set({ previewMaxLifeHours: n })} />
      <p className="muted small">With a max lifetime, a preview asks “Still using it?” a minute before, in the viewer and in its own tab: Keep it running starts the time again. A reload or a quick tab switch never stops one in use.</p>
      <dl className="cn-facts small">
        <dt>Most PR previews at once</dt>
        <dd>{PR_PREVIEW_SLOTS}, beside each floor's main preview</dd>
      </dl>
    </div>
  );
}

/** The environment: versions, the GitHub account and paths. Diagnostics, so they live here rather than in the settings. */
export function AboutOffice() {
  const user = useStore((s) => s.user);
  const machinesRoot = useStore((s) => s.machinesRoot);
  const demo = useStore((s) => s.demo);
  const version = useStore((s) => s.version);
  const commit = useStore((s) => s.officeCommit);
  return (
    <div className="card">
      <h3>
        <Icon name="info" /> About this office
      </h3>
      <dl className="cn-facts small">
        <dt>Version</dt>
        <dd>
          cubefarm <b>{version ?? 'unknown'}</b>
          {commit && (
            <>
              {' '}
              (<code>{commit}</code>)
            </>
          )}
        </dd>
        <dt>GitHub account</dt>
        <dd>
          <b>{user ?? 'not signed in'}</b>
          {demo && ' (demo)'}
        </dd>
        <dt>Agents' machines</dt>
        <dd>
          <code>{machinesRoot}</code>
        </dd>
      </dl>
    </div>
  );
}
