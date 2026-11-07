// The app viewer's channel row and the previews' upkeep (#204): main, then only the PRs that are live (an agent on
// them, a preview up, updated lately), the rest folded under "Older (N)" in a sheet; who is testing in a preview the
// manager can't stop; and the previews' stats.
import { useEffect, useState } from 'react';
import { qaKey, useStore } from '../store';
import { CEO_ID, type PreviewView, type RepoView } from '../../../shared/types';
import { busyPrs, channelLabel, channelLed, liveChannels, previewingPrs, PR_PREVIEW_SLOTS, qaBadge, stopsLabel, type Channel } from './channels';
import { sendToCeo } from './chatSend';
import { ProgressBar } from './ProgressBar';
import { Sheet } from './Sheet';

/** Re-render every minute, for "stops in N min". */
function useMinute(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** main, then the live PRs and an "Older (N)" chip; picking a PR starts its preview. */
export function ChannelBar({ repo, channel, onPick }: { repo: RepoView; channel: Channel; onPick: (pr: Channel) => void }) {
  const prPreviews = useStore((s) => s.prPreviews);
  const qa = useStore((s) => s.qa);
  const agents = useStore((s) => s.agents);
  const recentHours = useStore((s) => s.settings.previewRecentHours);
  const now = useMinute();
  const [showOlder, setShowOlder] = useState(false);
  const { live, older } = liveChannels(repo.pulls, { busy: busyPrs(Object.values(agents), repo.id), previewing: previewingPrs(prPreviews, repo.id), current: channel, now, recentHours });
  const stops = (p: { status: string; stopsAt?: number | null } | undefined) => (p?.status === 'running' ? stopsLabel(p.stopsAt, now) : '');
  const mainStops = stops(repo.preview);
  return (
    <div className="channels" role="tablist" aria-label="Channels">
      <button role="tab" aria-selected={channel == null} className={`channel ${channel == null ? 'channel-on' : ''}`} onClick={() => onPick(null)} title={`The floor's app on ${repo.defaultBranch}`}>
        <span className={`led led-${channelLed(repo.preview.status)}`} aria-hidden /> {repo.defaultBranch}
        {mainStops && <span className="channel-stops">· {mainStops}</span>}
      </button>
      {live.map((p) => {
        const label = channelLabel(p, qa[qaKey(repo.id, p.number)]);
        const preview = prPreviews[qaKey(repo.id, p.number)];
        const left = stops(preview);
        return (
          <button key={p.number} role="tab" aria-selected={channel === p.number} className={`channel ${channel === p.number ? 'channel-on' : ''}`} onClick={() => onPick(p.number)} title={left ? `${label} · ${left}` : label}>
            <span className={`led led-${channelLed(preview?.status)}`} aria-hidden /> {label}
            {left && <span className="channel-stops">· {left}</span>}
          </button>
        );
      })}
      {older.length > 0 && (
        <button className="channel channel-older" aria-haspopup="dialog" onClick={() => setShowOlder(true)} title="Open PRs nobody is working on, untouched for a while">
          Older ({older.length})
        </button>
      )}
      {live.length + older.length === 0 && <span className="muted small channels-empty">No open PRs: each one gets a channel here, to try it running beside {repo.defaultBranch}.</span>}
      {showOlder && (
        <Sheet title={`Older PRs (${older.length})`} onClose={() => setShowOlder(false)}>
          <p className="muted small">Open, but nobody is working on them and nothing changed in {recentHours} hours. Pick one to start its preview.</p>
          <ul className="older-prs">
            {older.map((p) => (
              <li key={p.number} className="older-pr">
                <span className="older-pr-title">
                  PR #{p.number} · {p.title}
                </span>
                {qaBadge(qa[qaKey(repo.id, p.number)]) && <span className="small">{qaBadge(qa[qaKey(repo.id, p.number)])}</span>}
                <button
                  className="btn btn-small"
                  aria-label={`Preview PR #${p.number}`}
                  onClick={() => {
                    setShowOlder(false);
                    onPick(p.number);
                  }}
                >
                  ▶ Preview
                </button>
              </li>
            ))}
          </ul>
        </Sheet>
      )}
    </div>
  );
}

/** A preview an agent is testing in: Stop and Restart are off, and the manager can ask the CEO instead. */
export function HeldNote({ preview, label, repo }: { preview: PreviewView; label: string; repo: RepoView }) {
  const ceo = useStore((s) => s.agents[CEO_ID]?.name ?? 'the CEO');
  if (!preview.heldBy) return null;
  return (
    <div className="held-note small" role="note">
      <span>
        🔒 @{preview.heldBy} is testing in this
      </span>
      <button
        className="btn btn-small"
        onClick={() => {
          sendToCeo(`The manager wants to stop the preview of ${preview.pr ? `PR #${preview.pr}` : `${label} (main)`} on ${repo.fullName}, which @${preview.heldBy} is testing in. Can it stop once they're done?`);
          useStore.getState().pushToast('info', `Told ${ceo}.`);
        }}
      >
        Tell {ceo}
      </button>
    </div>
  );
}

const size = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`);

/** The previews' upkeep at a glance: PR slots in use, this floor's main preview, disk, memory and the last cleanup. */
export function PreviewStats({ repo, onClose }: { repo: RepoView; onClose: () => void }) {
  const prPreviews = useStore((s) => s.prPreviews);
  const stats = useStore((s) => s.previewStats);
  const used = Object.values(prPreviews).filter((p) => channelLed(p.status) === 'live' || channelLed(p.status) === 'busy').length;
  const mainOn = channelLed(repo.preview.status) === 'live' || channelLed(repo.preview.status) === 'busy';
  const cleaned = stats.cleanedAt ? `${Math.max(0, Math.round((Date.now() - stats.cleanedAt) / 60_000))} min ago` : 'not yet';
  return (
    <Sheet title="Previews" onClose={onClose}>
      <ProgressBar label="PR preview slots" value={`${used} of ${PR_PREVIEW_SLOTS}`} pct={Math.min(1, used / PR_PREVIEW_SLOTS)} tone={used >= PR_PREVIEW_SLOTS ? 'warn' : 'good'} aria={`${used} of ${PR_PREVIEW_SLOTS} PR preview slots in use`} />
      <dl className="preview-stats small">
        <dt>{repo.defaultBranch}</dt>
        <dd>{mainOn ? 'running' : 'stopped'}</dd>
        <dt>Disk (preview desks)</dt>
        <dd>{stats.diskBytes == null ? '—' : size(stats.diskBytes)}</dd>
        <dt>Memory (previews)</dt>
        <dd>{stats.memMb == null ? '—' : size(stats.memMb * 1024 ** 2)}</dd>
        <dt>Last cleaned</dt>
        <dd>{cleaned}</dd>
      </dl>
    </Sheet>
  );
}
