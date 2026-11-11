import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { taskStage } from '../../../shared/progressBars';
import { ACTIVITY_ICONS, ACTIVITY_LABELS, clipText, recentActions, redact } from '../../../shared/activity';
import { isBusy, qaKey, useStore, type Agent } from '../store';
import { reportCard } from '../world/activityProbe';
import { useKeyName } from './controls';
import { agentLabel, signInFor } from './floorRows';
import { HostBadge } from './HostBadge';
import { CloseButton, Icon } from './Icon';
import { iconFor, type IconName } from './icons';
import { isTouch, openHoldMenu } from '../world/touch/touchState';
import { agentTask, agentWorking, TaskBar, taskSince } from './TaskProgress';
import { Avatar } from './phoneParts';
import { aimProgress, aimStatus, prLabel, type PrMark } from './aimCardRules';
import { tourAllows, useTourGate } from './tourGate';

// The card at the left edge (clear of their monitor) when you keep someone in your sights for a moment: who they are,
// what they're on and for how long, what they're doing now and their last few steps, turns and cost on this task, and
// the QA round while they're testing or fixing a PR. It only reads the store: E still opens their terminal.
// On a touch screen it starts compact (#406): name, one status line, a thin bar and their PR; a tap shows the rest.

const AIM_MS = 400;
const STATUS: Record<Agent['status'], string> = { idle: 'free', preparing: 'setting up', working: 'working', done: 'done', error: 'stuck', stopped: 'stopped' };

const MARK_ICON: Record<PrMark, IconName> = { passed: 'circle-check', failed: 'circle-x', waiting: 'hourglass', you: 'hand' };
const MARK_WORD: Record<PrMark, string> = { passed: 'passed', failed: 'failed', waiting: 'waiting', you: 'needs you' };

/** A touch screen's card is expanded: its details and the career peek show (HUD.tsx). */
export const useAimCard = create<{ open: boolean }>(() => ({ open: false }));

function elapsed(ms: number) {
  const m = Math.floor(ms / 60_000);
  return m < 1 ? `${Math.max(0, Math.floor(ms / 1000))}s` : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function onWhat(a: Agent): string | null {
  const title = a.issueTitle ? ` · ${a.issueTitle}` : '';
  if (a.role === 'ceo') return a.issueTitle;
  if (a.task === 'qa' && a.prNumber) return `testing PR #${a.prNumber}${title}`;
  if (a.task === 'fix' && a.prNumber) return `fixing PR #${a.prNumber}${title}`;
  if (a.issueNumber) return `#${a.issueNumber}${a.issueTitle ? ` ${a.issueTitle}` : ''}${a.prNumber ? ` · PR #${a.prNumber}` : ''}`;
  return null;
}

export function AgentCard() {
  const allowed = useTourGate((s) => tourAllows(s.step, { kind: 'card' }));
  const aimed = useStore((s) => (allowed && s.started && !s.overlay && !s.travel && s.focus?.action.kind === 'terminal' ? s.focus.action.agentId : null));
  const [held, setHeld] = useState<string | null>(null);
  useEffect(() => {
    setHeld(null);
    if (!aimed) return;
    const t = setTimeout(() => setHeld(aimed), AIM_MS);
    return () => clearTimeout(t);
  }, [aimed]);
  // Looking away (or at someone else) hides it at once; the new person's card waits for its own moment.
  const id = held !== null && held === aimed ? held : null;
  const open = useAimCard((s) => s.open);
  useEffect(() => useAimCard.setState({ open: false }), [id]);
  const agent = useStore((s) => (id ? s.agents[id] : undefined));
  const log = useStore((s) => (id ? s.logs[id] : undefined));
  const qa = useStore((s) => (agent?.prNumber ? s.qa[qaKey(agent.repoId, agent.prNumber)] : undefined));
  const repo = useStore((s) => (agent ? s.repos.find((r) => r.id === agent.repoId) : undefined));
  const settings = useStore((s) => s.settings);
  const clis = useStore((s) => s.clis);
  const use = useKeyName('interact');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!id) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [id]);

  const actions = agent ? recentActions(log ?? [], 3) : [];
  const actionsKey = actions.join('\n');
  useEffect(() => {
    reportCard(agent ? { agentId: agent.id, name: agent.name, lines: actionsKey ? actionsKey.split('\n') : [] } : null);
  }, [agent, actionsKey]);
  useEffect(() => () => reportCard(null), []);
  if (!agent) return null;

  const busy = isBusy(agent);
  const act = busy ? agent.activity : null;
  const on = onWhat(agent);
  const round = (agent.task === 'fix' || agent.task === 'qa') && qa ? qa.round : null;
  const signIn = signInFor(agent, settings);
  const more = () => openHoldMenu({ id: `agent-${agent.id}`, label: `Watch ${agent.name}`, action: { kind: 'terminal', agentId: agent.id } });
  if (isTouch && !open) {
    const stage = taskStage(agentTask(agent, qa));
    const status = aimStatus(agent, stage, round);
    const pr = prLabel(agent, qa?.status);
    const n = agent.prNumber;
    return (
      <div className="agent-card ac-compact" style={{ ['--who' as string]: agent.color }}>
        <div className="ac-head">
          <button type="button" className="ac-open" onClick={() => useAimCard.setState({ open: true })} aria-label={`${agent.name}: ${status}. Show their card`}>
            <Avatar name={agent.name} color={agent.color} size={36} />
            <span className="ac-who">
              <span className="ac-name">{agent.name}</span>
              <span className="ac-line">{signIn ? `Sign ${signIn} in` : status}</span>
            </span>
          </button>
          {pr && n != null && (
            <button type="button" className="btn btn-small ac-pr" onClick={() => useStore.getState().openOverlay({ kind: 'card', repoId: agent.repoId, key: `pr-${n}`, number: n, pr: true })} aria-label={`Open ${pr.text}${pr.mark ? `, QA: ${MARK_WORD[pr.mark]}` : ''}`}>
              {pr.text} {pr.mark && <Icon name={MARK_ICON[pr.mark]} />}
            </button>
          )}
          <button className="ac-more" onClick={more} aria-label={`More for ${agent.name}`} title="More options">
            <Icon name="ellipsis" />
          </button>
        </div>
        <div className="ac-bar" aria-hidden>
          <span style={{ width: `${aimProgress(stage) * 100}%` }} />
        </div>
      </div>
    );
  }
  return (
    <div className={`agent-card ${isTouch ? 'ac-full' : ''}`} style={{ ['--who' as string]: agent.color }}>
      <div className="ac-head">
        <span className="ac-dot" />
        <span className="ac-who">
          <span className="ac-name">
            {agent.name}
            <HostBadge agent={agent} />
          </span>
          <span className="ac-title">{agentLabel(agent, settings, clis)}</span>
        </span>
        <span className="ac-time">
          {busy && agent.startedAt ? (
            <>
              <Icon name="clock" /> {elapsed(now - agent.startedAt)}
            </>
          ) : agent.waiting && !busy ? (
            `waiting for ${agent.waiting === 'ceo' ? 'CEO' : 'you'}`
          ) : (
            STATUS[agent.status]
          )}
        </span>
        {isTouch && (
          <>
            <button className="ac-more" onClick={more} aria-label={`More for ${agent.name}`} title="More options">
              <Icon name="ellipsis" />
            </button>
            <CloseButton className="ac-more" onClick={() => useAimCard.setState({ open: false })} label="Show less" />
          </>
        )}
      </div>
      {signIn && (
        <div className="ac-sign-in">
          <Icon name="key-round" /> Sign {signIn} in: <kbd>{use}</kbd> opens their terminal
        </div>
      )}
      {on && <div className="ac-on">{clipText(redact(on), 64)}</div>}
      <div className="ac-stage">
        <TaskBar input={agentTask(agent, qa)} repoId={agent.repoId} since={taskSince(repo, agent.issueNumber, agent.prNumber)} working={agentWorking(agent)} name={`${agent.name}'s task`} compact />
      </div>
      {act && (
        <div className="ac-now">
          <Icon name={iconFor(ACTIVITY_ICONS[act.kind], 'circle-dot')} /> {ACTIVITY_LABELS[act.kind]}
          {act.detail && <span className="ac-detail"> · {act.detail}</span>}
        </div>
      )}
      {actions.length > 0 && (
        <ul className="ac-steps">
          {actions.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
      <div className="ac-foot">
        this task so far: {agent.turns} turn{agent.turns === 1 ? '' : 's'} · ${agent.costUsd.toFixed(2)}
        {round ? ` · QA round ${round}` : ''}
      </div>
    </div>
  );
}
