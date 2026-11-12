// The bundled Claude Code's row in Settings → Providers (#546, #569): its version, the npm registry's latest and when
// it was checked, Check now, the bump in flight, and the alarm card when it's been behind a week with none.
import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { bundledLabel } from '../../../shared/claudeCode';
import { latestLabel } from '../../../shared/agentSdk';
import { clock } from '../../../shared/usage';
import { Icon } from './Icon';
import './bundledClaude.css';

export function BundledClaude({ version }: { version: string | null }) {
  const v = useStore((s) => s.sdkUpdate);
  const [asked, setAsked] = useState(false);
  const label = bundledLabel(version);
  if (!label) return null;
  const latest = v && latestLabel(v, (at) => clock(at, Date.now()));
  const checking = asked || !!v?.checking;
  const check = () => {
    setAsked(true);
    void api.agentSdkCheck().finally(() => setAsked(false));
  };
  return (
    <div className="bundled-claude">
      <div className="bundled-claude-row">
        <p className="muted small grow">
          {label}
          {latest && <span className="bundled-claude-latest">{latest}</span>}
        </p>
        {v && (
          <button className="btn btn-small" disabled={checking} onClick={check}>
            {checking ? 'Checking…' : 'Check now'}
          </button>
        )}
      </div>
      {v?.bump && (
        <p className="acc-flag" role="status">
          <Icon name="refresh-cw" /> Updating: #{v.bump.issue} on floor {v.bump.floor} {v.bump.merged ? 'is merged and goes live with the office’s next update' : 'goes live once it’s built, checked and merged'}.
        </p>
      )}
      {v?.alarm && (
        <div className="bundled-claude-alarm" role="alert">
          <Icon name="triangle-alert" /> <span>{v.alarm}</span>
        </div>
      )}
    </div>
  );
}
