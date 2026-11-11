// A Claude login's plan flags (#460), on every card of it (Company, Mission control, Settings → Providers, its usage
// sheet): "Signed in with a Pro account, not Ultra" with Rename to match and Sign in again, and "Same subscription as …".
import { api } from '../api';
import { planRename } from '../../../shared/accounts';
import type { AccountView } from '../../../shared/types';
import { Icon } from './Icon';
import './planFlag.css';

export function PlanFlag({ a, onSignIn }: { a: AccountView; onSignIn: () => void }) {
  if (!a.planWarning && !a.sameAs) return null;
  const fix = a.planWarning && a.loginPlan ? planRename(a.loginPlan) : null;
  return (
    <div className="plan-flag">
      {a.planWarning && (
        <span className="plan-flag-line plan-flag-warn" role="status">
          <Icon name="triangle-alert" /> {a.planWarning}
        </span>
      )}
      {a.planWarning && (
        <span className="plan-flag-actions">
          {fix && (
            <button type="button" className="ds-btn" onClick={() => void api.updateAccount(a.id, fix).catch(() => undefined)} title={`Rename to “${fix.label}”`}>
              Rename to match
            </button>
          )}
          {a.kind === 'subscription-login' && (
            <button type="button" className="ds-btn" onClick={onSignIn}>
              Sign in again
            </button>
          )}
        </span>
      )}
      {a.sameAs && (
        <span className="plan-flag-line" role="note">
          <Icon name="link" /> Same subscription as {a.sameAs}: they share its limits
        </span>
      )}
    </div>
  );
}
