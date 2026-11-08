// The Team page's header once cloud agents are in play (#260, docs/cloud.md): how many agents work on this computer and
// how many in the cloud, and how full this computer's memory is, the room Hybrid hires against.
import { useStore } from '../store';
import { gb } from '../../../shared/health';
import { Icon } from './Icon';
import { ProgressBar } from './ProgressBar';

export function TeamCapacity() {
  const agents = useStore((s) => s.agents);
  const kind = useStore((s) => s.settings.cloud.machineKind);
  const keySet = useStore((s) => s.cloud.keySet);
  const memory = useStore((s) => s.health?.memory ?? null);
  const team = Object.values(agents).filter((a) => a.role !== 'ceo');
  const cloud = team.filter((a) => a.host === 'box');
  if (!keySet && !cloud.length) return null;
  const local = team.length - cloud.length;
  const burst = cloud.filter((a) => a.burst).length;
  const used = memory ? memory.totalMb - memory.availableMb : 0;
  const share = memory && memory.totalMb > 0 ? used / memory.totalMb : null;
  return (
    <div className="card team-capacity">
      <div className="ds-card-head">
        <b className="ds-row-main">
          <Icon name="monitor" /> {local} on this computer · <Icon name="cloud" /> {cloud.length} in the cloud
        </b>
        {kind === 'hybrid' && <span className="muted small nowrap">Hybrid{burst ? ` · ${burst} added for load` : ''}</span>}
      </div>
      {memory && share !== null && (
        <ProgressBar
          label="This computer"
          value={`${gb(used)} of ${gb(memory.totalMb)}`}
          pct={share}
          tone={share > 0.9 ? 'bad' : share > 0.75 ? 'warn' : 'good'}
          aria={`This computer's memory: ${gb(used)} of ${gb(memory.totalMb)} used`}
          note={kind === 'hybrid' ? 'New agents work here while it has room, then in the cloud.' : undefined}
        />
      )}
    </div>
  );
}
