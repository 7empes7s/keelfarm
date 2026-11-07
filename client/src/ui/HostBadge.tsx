// Where an agent works, on their card and in the team list (#260): a cloud badge for an Upstash Box, and once the
// office uses the cloud, a "this computer" one for the rest, so a mixed team reads at a glance.
import { useStore, type Agent } from '../store';
import { Icon } from './Icon';

export function HostBadge({ agent, short }: { agent: Agent; short?: boolean }) {
  const cloudOn = useStore((s) => s.cloud.keySet);
  if (agent.role === 'ceo') return null;
  if (agent.host === 'box') {
    const title = agent.burst ? 'Added in the cloud because this computer was full: leaves once idle' : 'Works in an Upstash Box: carries on when the office is closed';
    return (
      <span className="cloud-badge" title={title}>
        {' '}
        <Icon name="cloud" />
        {!short && (agent.burst ? ' cloud · for load' : ' cloud')}
      </span>
    );
  }
  if (!cloudOn) return null;
  return (
    <span className="cloud-badge host-local" title="Works on this computer">
      {' '}
      <Icon name="monitor" />
      {!short && ' here'}
    </span>
  );
}
