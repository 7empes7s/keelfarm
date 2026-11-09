// Mission control's disk card (#340): free space on each disk the office writes to (a warning chip before one fills,
// the hold when it nearly has), "Free up space" with a preview of what goes, what stays and why, and what is left
// alone outside the office's folders, the last cleanup, and the demo's "Simulate low disk". Also Settings → Agents'
// disk fields.
import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { cleanTotals, DEFAULT_DISK, diskSettings, sizeText, type CleanItem, type CleanPlan, type DiskLevel, type DiskSettings } from '../../../shared/disk';
import { gb } from '../../../shared/health';
import type { BarTone } from '../../../shared/progressBars';
import { confirmDialog } from './Confirm';
import { Section } from './DetailsPage';
import { Icon } from './Icon';
import { ProgressBar } from './ProgressBar';
import './diskCard.css';

const TONE: Record<DiskLevel, BarTone> = { ok: 'good', warn: 'warn', hold: 'bad' };
const WORD: Record<DiskLevel, string> = { ok: 'Room to spare', warn: 'Getting full', hold: 'Almost full: new work waits' };

function ItemList({ title, items, tone }: { title: string; items: CleanItem[]; tone?: 'muted' }) {
  if (!items.length) return null;
  return (
    <div className="disk-plan-group">
      <h5 className="disk-plan-h">
        {title} · {sizeText(cleanTotals(items).mb)}
      </h5>
      {items.map((i) => (
        <div key={i.id} className={`disk-plan-item${tone ? ' muted' : ''}`}>
          <span className="grow">
            <b>{i.label}</b> <span className="muted small">{i.why}</span>
          </span>
          <span className="small disk-plan-size">{sizeText(i.mb)}</span>
        </div>
      ))}
    </div>
  );
}

async function freeUpSpace(setBusy: (b: boolean) => void) {
  if (document.pointerLockElement) document.exitPointerLock();
  setBusy(true);
  let plan: CleanPlan;
  try {
    plan = await api.diskPlan();
  } catch {
    setBusy(false);
    return; // api() already toasted it
  }
  setBusy(false);
  const total = cleanTotals(plan.go);
  const ok = await confirmDialog({
    icon: 'trash-2',
    tone: 'warn',
    title: total.count ? `Free up ${sizeText(total.mb)}?` : 'Nothing to free up now',
    body: (
      <div className="disk-plan">
        {!total.count && <p className="muted small">Nothing of the office's own is left over. Idle desks lose their node_modules after the time in Settings → Agents.</p>}
        <ItemList title="Goes" items={plan.go} />
        <ItemList title="Stays" items={plan.kept} />
        <ItemList title="Left alone (not the office's)" items={plan.outside} tone="muted" />
      </div>
    ),
    confirm: total.count ? 'Free up space' : 'OK',
    cancel: total.count ? 'Cancel' : undefined,
  });
  if (!ok || !total.count) return;
  setBusy(true);
  try {
    const r = await api.cleanDisk();
    useStore.getState().pushToast(r.failed.length ? 'error' : 'success', `Freed ${sizeText(r.freedMb)}${r.failed.length ? `; ${r.failed.length} could not be removed` : ''}`);
  } catch {
    // api() already toasted it
  } finally {
    setBusy(false);
  }
}

export function DiskCard() {
  const disk = useStore((s) => s.health?.disk);
  const demo = useStore((s) => s.demo);
  const openOverlay = useStore((s) => s.openOverlay);
  const [busy, setBusy] = useState(false);
  if (!disk) return null;
  const last = disk.lastClean;
  return (
    <Section
      id="ops-card-disk"
      className="disk-card"
      tone={disk.level === 'ok' ? undefined : disk.level === 'warn' ? 'warn' : 'bad'}
      title={
        <>
          <Icon name="hard-drive" /> Disk
        </>
      }
    >
      {disk.level !== 'ok' && (
        <p className={`disk-chip disk-chip-${disk.level}`} role="status">
          <Icon name="triangle-alert" /> {WORD[disk.level]}
        </p>
      )}
      {disk.disks.map((d) => (
        <ProgressBar
          key={d.path}
          label={d.label}
          value={`${gb(d.freeMb)} free of ${gb(d.totalMb)}`}
          pct={d.totalMb ? 1 - d.freeMb / d.totalMb : 0}
          tone={TONE[d.level]}
          note={<span className="disk-path">{d.path}</span>}
          aria={`${d.label}: ${gb(d.freeMb)} free of ${gb(d.totalMb)}, ${WORD[d.level].toLowerCase()}`}
          onClick={() => openOverlay({ kind: 'manager', tab: 'agents' })}
          tap="Open the disk settings"
        />
      ))}
      {last && (
        <p className="muted small">
          {last.auto ? 'Last hourly cleanup' : 'Last cleanup'} {new Date(last.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: freed {sizeText(last.freedMb)}
          {last.kept ? `, kept ${last.kept}` : ''}
        </p>
      )}
      <div className="row wrap disk-actions">
        <button className="btn btn-small" disabled={busy} onClick={() => void freeUpSpace(setBusy)}>
          <Icon name="trash-2" /> {busy ? 'Looking…' : 'Free up space…'}
        </button>
        {demo && (
          <button className="btn btn-small btn-ghost" disabled={busy} onClick={() => void api.simulateDisk(disk.level !== 'hold').catch(() => undefined)} title="The demo only: pretend the disk is nearly full, or has room again">
            {disk.level === 'hold' ? 'Disk has room' : 'Simulate low disk'}
          </button>
        )}
      </div>
    </Section>
  );
}

/** Settings → Agents: the disk's warning and hold, the cleanup, and where agents' working copies are stored. */
export function DiskFields({ disk }: { disk: DiskSettings | undefined }) {
  const s = diskSettings(DEFAULT_DISK, disk);
  const save = (patch: Partial<DiskSettings>) => void api.diskSettings(patch).catch(() => undefined); // api() already toasted it
  const num = (key: 'warnPct' | 'warnGb' | 'holdGb' | 'keepDays' | 'cleanEveryHours', label: string, max: number) => (
    <label className="field">
      <span>{label}</span>
      <input key={s[key]} type="number" inputMode="decimal" min={0} max={max} defaultValue={s[key]} onBlur={(e) => e.target.value !== '' && Number(e.target.value) !== s[key] && save({ [key]: Number(e.target.value) })} />
    </label>
  );
  return (
    <>
      {num('warnPct', 'Warn me when a disk has less free than (%)', 90)}
      {num('warnGb', '…or less free than (GB)', 10_000)}
      {num('holdGb', 'Hold new builds, QA and previews below (GB free)', 10_000)}
      <p className="muted small">You get one notification when a disk goes below the warning. Below the hold, running work carries on and new work waits until there is room again.</p>
      {num('cleanEveryHours', 'Clean up the office’s leftovers every (hours, 0 = only by hand)', 168)}
      {num('keepDays', 'Remove agents’ temp files untouched for (days)', 365)}
      <p className="muted small">
        A cleanup removes former agents’ machines and copies of floors an agent has left, never a running task’s, a PR in QA or being fixed, or work not on GitHub. Free up space in Mission control shows
        what goes first.
      </p>
      <label className="field">
        <span>Store agents’ working copies on</span>
        <input key={s.workRoot} defaultValue={s.workRoot} placeholder="The office folder" spellCheck={false} onBlur={(e) => e.target.value.trim() !== s.workRoot && save({ workRoot: e.target.value.trim() })} />
      </label>
      <p className="muted small">A folder of its own on another mounted disk, like /mnt/disk2/cubefarm. New working copies go there; idle agents’ move at their next quiet moment. Leave empty for the office folder.</p>
    </>
  );
}
