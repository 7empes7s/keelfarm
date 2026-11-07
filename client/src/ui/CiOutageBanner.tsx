// A floor's CI outage (#191): one banner and one question for the manager, instead of a needs-you per parked PR.
import type { RepoView } from '../../../shared/types';
import './ciOutage.css';
import { Icon } from './Icon';

export function CiOutageBanner({ repo }: { repo: Pick<RepoView, 'ciOutage'> }) {
  const out = repo.ciOutage;
  if (!out) return null;
  const n = out.parked.length;
  return (
    <div className="ci-outage" role="status">
      <b className="ci-outage-title">
        <Icon name="circle-stop" /> CI can't run: {out.reason}
      </b>
      <span className="small">
        {n ? `${n === 1 ? `PR #${out.parked[0]} passed QA and waits` : `${n} PRs passed QA and wait`} here, not for fixes. ` : ''}
        They re-run and merge by themselves once CI is back.
      </span>
      <span className="small ci-outage-ask">Is CI off on purpose? If not, fix it on GitHub; nothing else needs you.</span>
      <a className="btn btn-small ci-outage-btn" href="https://github.com/settings/billing" target="_blank" rel="noreferrer">
        GitHub billing <Icon name="external-link" />
      </a>
    </div>
  );
}
