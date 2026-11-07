// Pocket mode's Team tab: everyone with their status, and the terminal panel's actions without the terminal: message,
// ■ Stop, assigning an issue (or a PR to test); ↺ Clear desk and Let go in its ⋯. The terminal itself is one tap away.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import { agentsOnRepo, kanbanFor, useStore, type Agent } from '../store';
import { CEO_ID, type RepoView } from '../../../shared/types';
import { agentLabel, signInFor } from '../ui/floorRows';
import { clearDesk, letGo, stopAgent } from '../ui/dangerActions';
import { Menu } from '../ui/Menu';
import { MessageBox } from '../ui/MessageBox';
import { badgeStatus, StatusPill as Status } from '../ui/StatusPill';
import { agentPhrase } from '../ui/statusPhrase';
import { AgentRing } from '../ui/AgentRing';
import { HoverCard } from '../ui/HoverCard';
import { AgentPeek } from '../ui/Peeks';
import { TaskRing } from '../ui/TaskProgress';
import { keyStats } from '../../../shared/careers';
import { toolVerb } from '../world/draw';
import { agentActions, assignChoices, doing } from './pocketData';
import { EmptyState } from '../ui/EmptyState';
import { flashInto } from '../ui/jumpFlash';
import { takeTeamLanding } from './pocketJump';
import { useDraft } from '../drafts';


/** Runs one REST call at a time per card; api() already toasts errors. */
function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  };
  return [busy, run] as const;
}

function AgentCard({ agent, repo }: { agent: Agent; repo: RepoView }) {
  const allAgents = useStore((s) => s.agents);
  const qa = useStore((s) => s.qa);
  const settings = useStore((s) => s.settings);
  const clis = useStore((s) => s.clis);
  const openOverlay = useStore((s) => s.openOverlay);
  const cols = useMemo(() => kanbanFor(repo, agentsOnRepo(allAgents, repo.id), qa), [repo, allAgents, qa]);
  const [busy, run] = useBusy();
  const [pick, setPick] = useState('');
  const [writing, setWriting] = useState(false);
  const [text, setText] = useDraft(`agent:${agent.id}`); // kept through a reload (#216)
  const can = agentActions(agent);
  const choices = assignChoices(cols);
  const chosen = choices.find((c) => c.key === pick);
  const working = agent.status === 'working' || agent.status === 'preparing';
  const signIn = signInFor(agent, settings);
  const send = async () => {
    const t = text.trim();
    if (!t) return;
    if (await run(() => api.message(agent.id, t))) {
      setText('');
      setWriting(false);
    }
  };
  return (
    <div className={`pk-card pk-agent ${agent.status === 'error' ? 'pk-agent-bad' : ''}`}>
      <button type="button" className="pk-agent-head pk-agent-open" title={`Open ${agent.name}'s window`} onClick={() => openOverlay({ kind: 'terminal', agentId: agent.id })}>
        <HoverCard label={agent.name} peek={<AgentPeek agent={agent} />}>
          <AgentRing agent={agent} />
        </HoverCard>
        <span className="grow">
          <span>
            <b>{agent.name}</b> <span className="muted small">{agentLabel(agent, settings, clis)}</span>
          </span>
          <span className="small pk-ellipsis">
            {doing(agent)}
            {working && agent.currentTool ? <span className="muted"> · {toolVerb(agent.currentTool) || agent.currentTool}…</span> : null}
          </span>
          {agent.career && <span className="aw-stats-line">{keyStats(agent.career, Date.now())}</span>}
        </span>
        <TaskRing agent={agent} />
        <Status status={badgeStatus(agent)} />
      </button>
      <div className="small muted pk-phrase">{agentPhrase(agent, { autoAssign: repo.autoAssign })}</div>
      {agent.lastError && !working && <div className="term-error small pk-error">⚠️ {agent.lastError}</div>}
      {agent.blocked && working && <div className="term-error small pk-error">⛔ Blocked: {agent.blocked}</div>}
      {agent.waiting && !working && <div className="small pk-sign-in">❓ {agent.waiting === 'ceo' ? 'Asked a question: waiting for the CEO.' : 'Waiting for your answer in the Chat tab.'}</div>}
      {signIn && <div className="small pk-sign-in">🔑 Waiting for you to sign {signIn} in, in their terminal.</div>}
      <div className="pk-actions">
        {signIn && (
          <button className="btn btn-small btn-good" onClick={() => openOverlay({ kind: 'terminal', agentId: agent.id })}>
            🔑 Sign in
          </button>
        )}
        {can.stop && (
          <button className="btn btn-small btn-bad" disabled={busy} onClick={() => void run(() => stopAgent(agent))}>
            ■ Stop…
          </button>
        )}
        {can.assign && (
          <>
            <select className="pk-assign" value={pick} aria-label={`Give ${agent.name} an issue or a pull request to test`} onChange={(e) => setPick(e.target.value)} disabled={busy || choices.length === 0}>
              <option value="">{choices.length ? 'Pick an issue or a PR…' : 'Nothing to pick up'}</option>
              {choices.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.kind === 'qa' ? '🔍 PR ' : ''}#{c.number} {c.title}
                </option>
              ))}
            </select>
            <button
              className="btn btn-small btn-good"
              disabled={busy || !chosen}
              onClick={() =>
                chosen && void run(() => (chosen.kind === 'qa' ? api.sendToQa(repo.id, chosen.number, agent.id) : api.assign(agent.id, chosen.number))).then((ok) => ok && setPick(''))
              }
            >
              {chosen?.kind === 'qa' ? '🔍 Test' : '▶ Start'}
            </button>
          </>
        )}
        {can.message && (
          <button className={`btn btn-small ${writing ? 'btn-ghost' : ''}`} aria-expanded={writing} onClick={() => setWriting(!writing)}>
            💬 Message
          </button>
        )}
        <button className="btn btn-small btn-ghost" onClick={() => openOverlay({ kind: 'terminal', agentId: agent.id })}>
          Terminal
        </button>
        <Menu
          label={`More for ${agent.name}`}
          title={agent.name}
          className="pk-more"
          items={[
            can.clear && { label: '↺ Clear desk…', hint: 'Drop their task so they take new work', danger: true, disabled: busy, onSelect: () => void clearDesk(agent) },
            { label: `Let ${agent.name} go…`, hint: 'Their worktree is removed', danger: true, disabled: busy, onSelect: () => void letGo(agent) },
          ]}
        />
      </div>
      {writing && can.message && (
        <form
          className="pk-msg"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <MessageBox
            value={text}
            onChange={setText}
            autoFocus
            aria-label={`Message ${agent.name}`}
            placeholder={working ? `Tell ${agent.name} something while they work…` : `Ask ${agent.name} for a follow-up…`}
          />
          <button className="btn btn-small btn-good" disabled={busy || !text.trim()}>
            Send
          </button>
        </form>
      )}
    </div>
  );
}

function CeoCard() {
  const ceo = useStore((s) => s.agents[CEO_ID]);
  const info = useStore((s) => s.ceo);
  const [busy, run] = useBusy();
  if (!ceo) return null;
  const working = ceo.status === 'working';
  return (
    <div className="pk-card pk-agent">
      <div className="pk-agent-head">
        <span className="avatar" style={{ background: ceo.color }}>
          {ceo.name[0]}
        </span>
        <div className="grow">
          <b>{ceo.name}</b> <span className="muted small">CEO</span>
          <div className="small pk-ellipsis">{working ? (info.job?.label ?? 'Working') : info.queue.length ? `Up next: ${info.queue.map((j) => j.label).join(' → ')}` : 'Free'}</div>
        </div>
        <Status status={ceo.status} />
      </div>
      {working && (
        <div className="pk-actions">
          <button className="btn btn-small btn-bad" disabled={busy} onClick={() => void run(() => api.stop(ceo.id))}>
            ■ Stop
          </button>
        </div>
      )}
    </div>
  );
}

/** `flash`: bumped by a chat link to the focused floor's team (#151), which then scrolls there and lights up, once. */
export function Team({ focusRepo, flash = 0, top }: { focusRepo: string | null; flash?: number; top?: ReactNode }) {
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const focus = useRef<HTMLElement>(null);
  useEffect(() => (takeTeamLanding() ? flashInto(focus.current) : focus.current?.scrollIntoView({ block: 'start' })), [flash]);
  return (
    <div className="pk-page">
      {top}
      <CeoCard />
      {repos.length === 0 && <EmptyState kind="projects" />}
      {repos.map((repo) => {
        const team = agentsOnRepo(agents, repo.id);
        return (
          <section key={repo.id} ref={repo.id === focusRepo ? focus : undefined} className="pk-section" style={{ ['--accent' as string]: repo.color }}>
            <h3 className="pk-h">
              <span className="floor-badge">{repo.floor}</span> {repo.fullName.split('/')[1]}
              <span className="muted small"> · {team.length} {team.length === 1 ? 'agent' : 'agents'}</span>
            </h3>
            {team.length === 0 && <EmptyState kind="team" compact />}
            {team.map((a) => (
              <AgentCard key={a.id} agent={a} repo={repo} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
