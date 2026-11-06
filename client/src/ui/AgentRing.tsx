// An agent's avatar with a live status ring (#117): the ring's colour, a small icon and the label say what they're doing
// (working, testing, fixing, free, needing help, waiting), never colour alone. The agent window and the team lists use it.
import type { Agent } from '../store';
import { ringStatus } from './agentWindow';
import './agentWindow.css';

export function AgentRing({ agent, size = 'md' }: { agent: Agent; size?: 'sm' | 'md' }) {
  const r = ringStatus(agent);
  return (
    <span className={`aw-ring aw-ring-${r.ring} aw-ring-${size}`} role="img" aria-label={`${agent.name}: ${r.label}`} title={r.label}>
      <span className="avatar" style={{ background: agent.color }}>
        {agent.name[0]}
      </span>
      <span className="aw-ring-icon" aria-hidden="true">
        {r.icon}
      </span>
    </span>
  );
}
