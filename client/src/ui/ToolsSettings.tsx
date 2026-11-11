import { useId, useMemo, useState } from 'react';
import { api } from '../api';
import { useStore, type Agent, type State } from '../store';
import { costLabel, groupItems, itemState, type Profile, type ToolItem, type ToolRole, type ToolSwitches } from '../../../shared/tooling';
import { Icon } from './Icon';

// Settings → Tools & skills (and each agent's ⚙️ Setup): what a Claude Code session on the office's computer loads
// (server/tooling.ts), and switches for Everyone, a role profile (builders and fixers, QA), the CEO or one agent. The
// office applies them only to the sessions it starts (shared/tooling.ts sessionTools); the manager's own Claude Code
// files are never touched.

async function attempt(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch {
    // api() already toasted the error
  }
}

function ago(at: number) {
  const min = Math.round((Date.now() - at) / 60_000);
  return min < 1 ? 'just now' : min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
}

const RESET: Record<string, string> = { ceo: "the CEO's", build: "the profile's", qa: "the profile's" };

interface Layers {
  everyone: ToolSwitches;
  own?: ToolSwitches;
  profile?: ToolSwitches;
  lean: Profile | null;
}

function ToolRow({ item, role, layers, scope, pluginOff }: { item: ToolItem; role: ToolRole; layers: Layers; scope: string; pluginOff: boolean }) {
  const { everyone, own, profile, lean } = layers;
  const st = itemState(item, role, everyone, own, profile, lean);
  const on = st.on && !pluginOff;
  const cost = costLabel(item);
  const c = item.contents;
  const brings = c && [c.skills.length && `skills: ${c.skills.join(', ')}`, c.commands.length && `commands: ${c.commands.join(', ')}`, c.agents.length && `agents: ${c.agents.join(', ')}`, c.mcp.length && `MCP: ${c.mcp.join(', ')}`].filter(Boolean).join(' · ');
  return (
    <li className="tool-row">
      <label className="toggle" title={st.lock?.why ?? (pluginOff ? 'Off with its plugin' : undefined)}>
        <input type="checkbox" checked={on} disabled={!!st.lock || pluginOff} onChange={(e) => void attempt(() => api.switchTool(scope, item.id, e.target.checked))} />
        <b className="tool-name">{item.name}</b>
      </label>
      <div className="tool-chips">
        <span className="chip">{item.source}</span>
        {cost && <span className="chip">{cost}</span>}
        {st.lock && (
          <span className="chip chip-warn" title={st.lock.why}>
            always {st.lock.on ? 'on' : 'off'}
          </span>
        )}
        {pluginOff && !st.lock && <span className="chip">off with its plugin</span>}
        {st.from === 'own' && (
          <button className="chip tool-reset" title="Follow Everyone's switch again" onClick={() => void attempt(() => api.switchTool(scope, item.id, null))}>
            <Icon name="rotate-ccw" /> {RESET[scope] ?? 'their own'}
          </button>
        )}
        {st.from === 'everyone' && own && <span className="chip">as Everyone</span>}
        {st.from === 'profile' && <span className="chip">as the builders' profile</span>}
        {st.from === 'lean' && <span className="chip" title="Lean sessions: not in this role's profile until you switch it on">not in the profile</span>}
      </div>
      <div className="muted small tool-desc">{st.lock ? `${item.description} ${st.lock.why}.` : item.description}</div>
      {brings && <div className="muted small tool-desc">{brings}</div>}
      {item.detail && <code className="small tool-desc">{item.detail}</code>}
    </li>
  );
}

const SCOPES = ['everyone', 'ceo', 'build', 'qa'];

/** The list for one scope: 'everyone', 'ceo', a role profile ('build', 'qa') or an agent's id. */
function ToolsList({ scope }: { scope: string }) {
  const tooling = useStore((s) => s.tooling);
  const tools = useStore((s) => s.settings.tools);
  const agent = useStore((s) => (SCOPES.includes(scope) ? null : s.agents[scope]));
  const runtime = useStore((s) => s.settings.runtime);
  const defaultCli = useStore((s) => s.settings.defaultCli);
  const clis = useStore((s) => s.clis);
  const [query, setQuery] = useState('');
  const id = useId();
  const role: ToolRole = scope === 'ceo' ? 'ceo' : 'agent';
  // An agent's own switches sit on the builders' profile; Everyone shows its own switches, not a role's lean start.
  const layers: Layers = {
    everyone: tools.everyone,
    own: scope === 'everyone' ? undefined : scope === 'ceo' || scope === 'build' || scope === 'qa' ? tools[scope] : (agent?.tools ?? {}),
    profile: agent ? tools.build : undefined,
    lean: !tools.lean || scope === 'everyone' ? null : scope === 'ceo' || scope === 'qa' ? scope : 'build',
  };
  const groups = useMemo(() => groupItems(tooling.items, query), [tooling.items, query]);
  const offPlugins = new Set(tooling.items.filter((i) => i.kind === 'plugin' && !itemState(i, role, layers.everyone, layers.own, layers.profile, layers.lean).on).map((i) => i.id));
  // Codex and OpenCode load their own setup: the switches are Claude Code's.
  const cli = agent && runtime === 'terminal' ? agent.cli || defaultCli : 'claude';
  return (
    <div className="tools-list">
      {cli !== 'claude' && (
        <p className="chip-warn tool-note" role="note">
          Not supported for {clis.find((c) => c.id === cli)?.label ?? cli}: it loads its own setup. These switches apply to {agent?.name ?? 'an agent'}'s Claude Code sessions only.
        </p>
      )}
      <div className="row wrap">
        <input id={`${id}-q`} className="grow" type="search" placeholder="Search tools, plugins, skills…" aria-label="Search tools, plugins and skills" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn btn-small" disabled={tooling.scanning} onClick={() => void attempt(() => api.refreshTools())}>
          {tooling.scanning ? (
            'Scanning…'
          ) : (
            <>
              <Icon name="refresh-cw" /> Scan again
            </>
          )}
        </button>
      </div>
      <p className="muted small">
        {tooling.scannedAt ? `Read ${ago(tooling.scannedAt)} from ${tooling.via}.` : tooling.scanning ? 'Reading your Claude Code setup…' : 'Not read yet.'}
        {tooling.error && <span className="tool-error"> {tooling.error}</span>}
      </p>
      {groups.length === 0 && <p className="muted">{query ? 'Nothing matches.' : 'Nothing found yet.'}</p>}
      {groups.map((g) => (
        <section key={g.kind} aria-label={g.label}>
          <h4 className="tool-group">
            {g.label} <span className="muted small">({g.items.length})</span>
          </h4>
          <ul className="tool-rows">
            {g.items.map((item) => (
              <ToolRow key={item.id} item={item} role={role} layers={layers} scope={scope} pluginOff={!!item.plugin && offPlugins.has(item.plugin)} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Settings → 🧰 Tools & skills: pick a scope, then switch. */
export function ToolsTab() {
  const tools = useStore((s) => s.settings.tools);
  const agents = useStore((s) => s.agents);
  const repos = useStore((s) => s.repos);
  const [scope, setScope] = useState('everyone');
  const id = useId();
  const people = Object.values(agents)
    .filter((a) => a.role !== 'ceo')
    .sort((a, b) => a.name.localeCompare(b.name));
  const floor = (a: Agent) => repos.find((r) => r.id === a.repoId)?.floor;
  return (
    <div className="card tools-card">
      <h3>
        <Icon name="toolbox" /> Tools &amp; skills
      </h3>
      <label className="field" htmlFor={`${id}-scope`}>
        <span>Switches for</span>
        <select id={`${id}-scope`} value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="everyone">Everyone (the default)</option>
          <option value="build">Builders &amp; fixers (role profile)</option>
          <option value="qa">QA (role profile)</option>
          <option value="ceo">The CEO</option>
          {people.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {floor(a) ? ` · floor ${floor(a)}` : ''}
              {a.tools && Object.keys(a.tools).length ? ` (${Object.keys(a.tools).length} own)` : ''}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small">
        What a Claude Code session on this computer loads, from your own setup. Every MCP server and plugin costs context in every session: switch off what a role doesn't need. Each kind of session follows
        Everyone, then its role profile (builders and fixers, QA, the CEO), then an agent's own switches. Changes apply from their next session; your ~/.claude files are never changed.
      </p>
      <label className="toggle">
        <input type="checkbox" checked={tools.lean} onChange={(e) => void attempt(() => api.updateSettings({ tools: { ...tools, lean: e.target.checked } }))} />
        <span>
          <b>Lean sessions</b>{' '}
          <span className="muted small">
            Plugins, MCP servers and claude.ai connectors nobody switched on stay off, except the repo's own and the review plugins builders and QA use. QA keeps the office's browser. The usage view shows
            what each kind of session loads.
          </span>
        </span>
      </label>
      <details className="small">
        <summary>How the office switches them</summary>
        <p className="muted small">
          MCP servers and built-in tools go into that session's <code>--disallowedTools</code> (<code>mcp__server__*</code>): the server still starts, but its tools are taken out of the session.
          Skills become <code>Skill(name)</code> there too: hidden and refused, though their files stay readable. Plugins are turned off with <code>enabledPlugins</code> in the session's own
          settings file, which takes its skills, commands, agents and MCP servers with it. With every claude.ai connector off, the session runs with <code>ENABLE_CLAUDEAI_MCP_SERVERS=false</code>
          instead. The office's own servers and the tools it disables stay as the office needs them.
        </p>
      </details>
      <ToolsList scope={scope} />
    </div>
  );
}

const NO_TOOLS: ToolSwitches = {};
/** An agent's own switches (the CEO's are the office's). One {} for none: a new one each read loops the store (#351). */
export const ownTools = (s: State, agent: Agent): ToolSwitches => (agent.role === 'ceo' ? s.settings.tools.ceo : (s.agents[agent.id]?.tools ?? NO_TOOLS));

/** In an agent's ⚙️ Setup: their own switches. */
export function AgentTools({ agent }: { agent: Agent }) {
  const own = useStore((s) => ownTools(s, agent));
  const n = Object.keys(own).length;
  return (
    <details className="agent-tools">
      <summary>
        <Icon name="toolbox" /> Tools &amp; skills <span className="muted small">{n ? `(${n} of their own)` : '(as Everyone)'}</span>
      </summary>
      <ToolsList scope={agent.role === 'ceo' ? 'ceo' : agent.id} />
    </details>
  );
}
