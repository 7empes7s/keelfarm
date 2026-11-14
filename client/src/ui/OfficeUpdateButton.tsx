// The header's one Update control (#673; #600, #216). "Update office" when the office has commits ready: a tap asks
// once, runs the same Update now as the console's Office row and Settings → Company, and reloads the page once the
// office is back. Else "Reload app" when only this tab is behind the office's new client (drafts are kept).
import { useState } from 'react';
import { api } from '../api';
import { updateControl } from '../officeUpdate';
import { useStore } from '../store';
import { loadUpdate, reloadAfterUpdate } from '../updateLoad';
import { confirmDialog } from './Confirm';
import { Icon } from './Icon';

export function OfficeUpdateButton({ className }: { className: string }) {
  const update = useStore((s) => s.officeUpdate);
  const ready = useStore((s) => s.updateReady !== null);
  const [busy, setBusy] = useState(false);
  const kind = updateControl(update, ready);
  if (!kind) return null;
  if (kind === 'reload') {
    const title = 'Reload app: load the office’s newest version in this browser (your drafts are kept)';
    return (
      <button className={className} onClick={() => loadUpdate({ kind: 'tap' })} aria-label="Reload app" title={title}>
        <Icon name="refresh-cw" /> <span className="office-update-label">Reload app</span>
      </button>
    );
  }
  const why = update!.wait?.text ?? `${update!.behind} new commit${update!.behind === 1 ? '' : 's'} ready.`;
  const go = async () => {
    const ok = await confirmDialog({
      title: 'Update the office now?',
      body: (
        <>
          <p>{why}</p>
          <p className="muted small">The preflight checks it while agents keep working, then the office restarts for a few seconds and is watched on probation. A failure rolls back. This page reloads once the office is back.</p>
        </>
      ),
      icon: 'arrow-up',
      confirm: 'Update now',
      tone: 'good',
    });
    if (!ok) return;
    setBusy(true);
    const started = await api.updateOffice('now').then(
      () => true,
      () => false, // api() already toasted the error
    );
    if (started) reloadAfterUpdate();
    setBusy(false);
  };
  return (
    <button className={className} disabled={busy} onClick={() => void go()} aria-label="Update office: install its new commits, then reload this page" title={`Update office: ${why} This page reloads afterwards.`}>
      <Icon name="arrow-up" /> <span className="office-update-label">Update office</span>
    </button>
  );
}
