// The header's Update for the office's own ready update (#600): shown whenever Update now can apply one, its title the
// reason it waits; a tap asks once, then runs the same Update now as the console's Office row and Settings → Company.
import { useState } from 'react';
import { api } from '../api';
import { canUpdateNow } from '../officeUpdate';
import { useStore } from '../store';
import { confirmDialog } from './Confirm';
import { Icon } from './Icon';

export function OfficeUpdateButton({ className }: { className: string }) {
  const update = useStore((s) => s.officeUpdate);
  const [busy, setBusy] = useState(false);
  if (!update || !canUpdateNow(update)) return null;
  const why = update.wait?.text ?? `${update.behind} new commit${update.behind === 1 ? '' : 's'} ready.`;
  const go = async () => {
    const ok = await confirmDialog({
      title: 'Update the office now?',
      body: (
        <>
          <p>{why}</p>
          <p className="muted small">The preflight checks it while agents keep working, then the office restarts for a few seconds and is watched on probation. A failure rolls back.</p>
        </>
      ),
      icon: 'arrow-up',
      confirm: 'Update now',
      tone: 'good',
    });
    if (!ok) return;
    setBusy(true);
    await api.updateOffice('now').catch(() => undefined); // api() already toasted the error
    setBusy(false);
  };
  return (
    <button className={className} disabled={busy} onClick={() => void go()} aria-label="Update the office" title={why}>
      <Icon name="arrow-up" /> <span className="office-update-label">Update</span>
    </button>
  );
}
