// An agent's avatar with a live status ring (#117): the ring's colour, a small icon and the label say what they're doing
// (working, testing, fixing, free, needing help, waiting), never colour alone. The agent window and the team lists use it.
import type { Agent } from '../store';
import { ringStatus } from './agentWindow';
import { Icon } from './Icon';
import './agentWindow.css';

/** `phrase`: what they're doing and what happens next (statusPhrase.ts), as its tooltip. */
export function AgentRing({ agent, size = 'md', phrase }: { agent: Agent; size?: 'sm' | 'md'; phrase?: string }) {
  const r = ringStatus(agent);
  return (
    <span className={`aw-ring aw-ring-${r.ring} aw-ring-${size}`} role="img" aria-label={`${agent.name}: ${r.label}`} title={phrase ?? r.label}>
      <span className="avatar" style={{ background: agent.color }}>
        {agent.name[0]}
      </span>
      <span className="aw-ring-icon" aria-hidden="true">
        <Icon name={r.icon} />
      </span>
    </span>
  );
}
