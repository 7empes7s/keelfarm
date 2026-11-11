// Pocket mode's Team tab: everyone with their status, and the terminal panel's actions without the terminal: message,
// Stop, assigning an issue (or a PR to test); Clear desk and Let go in its overflow menu. The terminal itself is one tap away.
// Each floor's header has its busy / free count and "+ Agent", which opens the add sheet (#243).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import { agentsOnRepo, kanbanFor, useStore, type Agent } from '../store';
import { CEO_ID, type AgentView, type RepoView } from '../../../shared/types';
import { agentLabel, signInFor } from '../ui/floorRows';
import { clearDesk, letGo, stopAgent } from '../ui/dangerActions';
import { Menu } from '../ui/Menu';
import { MessageBox } from '../ui/MessageBox';
import { badgeStatus, StatusPill as Status } from '../ui/StatusPill';
import { agentPhrase } from '../ui/statusPhrase';
import { AgentRing } from '../ui/AgentRing';
import { RunChip } from '../ui/RunChip';
import { speakAgent, useLineVoice } from '../ui/agentSpeech';
import { HoverCard } from '../ui/HoverCard';
import { AgentPeek } from '../ui/Peeks';
import { TaskRing } from '../ui/TaskProgress';
import { keyStats } from '../../../shared/careers';
import { toolVerb } from '../world/draw';
import { agentActions, assignChoices, doing } from './pocketData';
import { EmptyState } from '../ui/EmptyState';
import { flashInto } from '../ui/jumpFlash';
import { takeTeamLanding } from './pocketJump';
import { Icon } from '../ui/Icon';
import { needsYou } from '../../../shared/needsYou';
import { useDraft } from '../drafts';
import { Sheet } from '../ui/Sheet';
import { pushLayer } from '../ui/backStack';
import { AddAgentForm } from '../ui/AddAgentForm';
import { teamStats } from '../ui/addAgent';
import { HostBadge } from '../ui/HostBadge';
import { TeamCapacity } from '../ui/TeamCapacity';


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

function AgentCard({ agent, repo, fresh }: { agent: Agent; repo: RepoView; fresh?: boolean }) {
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
    <div className={`pk-card pk-agent ${agent.status === 'error' ? 'pk-agent-bad' : needsYou(agent) ? 'pk-agent-needs' : ''} ${fresh ? 'pk-agent-new' : ''}`} data-agent={agent.id}>
      <button
        type="button"
        className="pk-agent-head pk-agent-open"
        title={`Open ${agent.name}'s window`}
        onClick={() => {
          openOverlay({ kind: 'terminal', agentId: agent.id });
          void speakAgent(agent.id); // they say what they're on as their window opens (#321)
        }}
      >
        <HoverCard label={agent.name} peek={<AgentPeek agent={agent} />}>
          <AgentRing agent={agent} />
        </HoverCard>
        <span className="grow">
          <span>
            <b>{agent.name}</b>
            <HostBadge agent={agent} short /> <span className="muted small">{agentLabel(agent, settings, clis)}</span>
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
      {agent.run && <RunChip run={agent.run} className="pk-run" />}
      {agent.lastError && !working && (
        <div className="term-error small pk-error">
          <Icon name="triangle-alert" /> {agent.lastError}
        </div>
      )}
      {agent.blocked && working && (
        <div className="term-error small pk-error">
          <Icon name="ban" /> Blocked: {agent.blocked}
        </div>
      )}
      {agent.waiting && !working && (
        <div className="small pk-sign-in">
          <Icon name="circle-help" /> {agent.waiting === 'ceo' ? 'Asked a question: waiting for the CEO.' : 'Waiting for your answer in the Chat tab.'}
        </div>
      )}
      {signIn && (
        <div className="small pk-sign-in">
          <Icon name="key-round" /> Waiting for you to sign {signIn} in, in their terminal.
        </div>
      )}
      <div className="pk-actions">
        {signIn && (
          <button className="btn btn-small btn-good" onClick={() => openOverlay({ kind: 'terminal', agentId: agent.id })}>
            <Icon name="key-round" /> Sign in
          </button>
        )}
        {can.stop && (
          <button className="btn btn-small btn-bad" disabled={busy} onClick={() => void run(() => stopAgent(agent))}>
            <Icon name="square" /> Stop…
          </button>
        )}
        {can.assign && (
          <>
            <select className="pk-assign" value={pick} aria-label={`Give ${agent.name} an issue or a pull request to test`} onChange={(e) => setPick(e.target.value)} disabled={busy || choices.length === 0}>
              <option value="">{choices.length ? 'Pick an issue or a PR…' : 'Nothing to pick up'}</option>
              {choices.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.kind === 'qa' ? 'PR ' : ''}#{c.number} {c.title}
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
              {chosen?.kind === 'qa' ? (
                <>
                  <Icon name="search" /> Test
                </>
              ) : (
                <>
                  <Icon name="play" /> Start
                </>
              )}
            </button>
          </>
        )}
        {can.message && (
          <button className={`btn btn-small ${writing ? 'btn-ghost' : ''}`} aria-expanded={writing} onClick={() => setWriting(!writing)}>
            <Icon name="message-circle" /> Message
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
            can.clear && { label: 'Clear desk…', hint: 'Drop their task so they take new work', danger: true, disabled: busy, onSelect: () => void clearDesk(agent) },
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
  const speaks = useLineVoice();
  if (!ceo) return null;
  const working = ceo.status === 'working';
  const avatar = (
    <span className="avatar" style={{ background: ceo.color }}>
      {ceo.name[0]}
    </span>
  );
  return (
    <div className="pk-card pk-agent">
      <div className="pk-agent-head">
        {speaks ? (
          <button type="button" className="aw-hear" aria-label={`Hear ${ceo.name}`} title="Hear how the company is doing" onClick={() => void speakAgent(ceo.id)}>
            {avatar}
          </button>
        ) : (
          avatar
        )}
        <div className="grow">
          <b>{ceo.name}</b> <span className="muted small">CEO</span>
          <div className="small pk-ellipsis">{working ? (info.job?.label ?? 'Working') : info.queue.length ? `Up next: ${info.queue.map((j) => j.label).join(' → ')}` : 'Free'}</div>
        </div>
        <Status status={ceo.status} />
      </div>
      {working && (
        <div className="pk-actions">
          <button className="btn btn-small btn-bad" disabled={busy} onClick={() => void run(() => api.stop(ceo.id))}>
            <Icon name="square" /> Stop
          </button>
        </div>
      )}
    </div>
  );
}

/** "+ Agent"'s sheet: a bottom sheet on a phone, a small card in front on a computer; ×, Esc, the backdrop and Back close it. */
function AddAgentSheet({ repo, size, onClose, onAdded }: { repo: RepoView; size: number; onClose: () => void; onAdded: (agent: AgentView) => void }) {
  useEffect(() => pushLayer(onClose), [onClose]);
  return (
    <Sheet title={`New agent on floor ${repo.floor}`} onClose={onClose} className="add-agent-panel">
      <AddAgentForm repo={repo} size={size} sheet onAdded={onAdded} />
    </Sheet>
  );
}

/** `flash`: bumped by a chat link to the focused floor's team (#151), which then scrolls there and lights up, once. */
export function Team({ focusRepo, flash = 0, top }: { focusRepo: string | null; flash?: number; top?: ReactNode }) {
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const pushToast = useStore((s) => s.pushToast);
  const focus = useRef<HTMLElement>(null);
  const [adding, setAdding] = useState<RepoView | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const closeSheet = useCallback(() => setAdding(null), []);
  useEffect(() => (takeTeamLanding() ? flashInto(focus.current) : focus.current?.scrollIntoView({ block: 'start' })), [flash]);
  // The new agent's card shows up (from the websocket) highlighted and scrolled to, then settles.
  const freshShown = !!fresh && !!agents[fresh];
  useEffect(() => {
    if (freshShown) document.querySelector(`[data-agent="${fresh}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [fresh, freshShown]);
  useEffect(() => {
    if (!fresh) return;
    const t = setTimeout(() => setFresh(null), 2500);
    return () => clearTimeout(t);
  }, [fresh]);
  const added = (agent: AgentView, repo: RepoView) => {
    setAdding(null);
    setFresh(agent.id);
    pushToast('success', `${agent.name} joined floor ${repo.floor}`);
  };
  return (
    <div className="pk-page">
      {top}
      <TeamCapacity />
      <CeoCard />
      {repos.length === 0 && <EmptyState kind="projects" />}
      {repos.map((repo) => {
        const team = agentsOnRepo(agents, repo.id);
        return (
          <section key={repo.id} ref={repo.id === focusRepo ? focus : undefined} className="pk-section" style={{ ['--accent' as string]: repo.color }}>
            <h3 className="pk-h">
              <span className="floor-badge">{repo.floor}</span> {repo.fullName.split('/')[1]}
              <span className="muted small"> · {teamStats(team)}</span>
              <button type="button" className="btn btn-small pk-add-agent" aria-label={`Add an agent to floor ${repo.floor}`} onClick={() => setAdding(repo)}>
                <Icon name="plus" /> Agent
              </button>
            </h3>
            {team.length === 0 && <EmptyState kind="team" compact />}
            {team.map((a) => (
              <AgentCard key={a.id} agent={a} repo={repo} fresh={a.id === fresh} />
            ))}
          </section>
        );
      })}
      {adding && <AddAgentSheet repo={adding} size={agentsOnRepo(agents, adding.id).length} onClose={closeSheet} onAdded={(a) => added(a, adding)} />}
    </div>
  );
}
