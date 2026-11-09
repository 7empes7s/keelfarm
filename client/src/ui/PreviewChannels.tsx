// The app viewer's channel row and the previews' upkeep (#204): main, then only the PRs that are live (an agent on
// them, a preview up, updated lately), the rest folded under "Older (N)" in a sheet; who is testing in a preview the
// manager can't stop; how each one stands (in use, kept 📌, when it stops, #252); and the previews' stats.
import { useEffect, useState } from 'react';
import { qaKey, useStore } from '../store';
import { CEO_ID, type PreviewView, type RepoView } from '../../../shared/types';
import { api } from '../api';
import { busyPrs, channelLabel, channelLed, clockLeft, liveChannels, pinLabel, previewingPrs, PR_PREVIEW_SLOTS, qaBadge, stopsLabel, standLabel, type Channel } from './channels';
import { sendToCeo } from './chatSend';
import { ProgressBar } from './ProgressBar';
import { Sheet } from './Sheet';
import { Icon } from './Icon';

/** Re-render every second, for "stops in 0:42". */
function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
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
  const now = useNow();
  const [showOlder, setShowOlder] = useState(false);
  const { live, older } = liveChannels(repo.pulls, { busy: busyPrs(Object.values(agents), repo.id), previewing: previewingPrs(prPreviews, repo.id), current: channel, now, recentHours });
  const stops = (p: { status: string; stopsAt?: number | null; pinned?: PreviewView['pinned'] } | undefined) => (p?.status === 'running' && p.pinned == null ? stopsLabel(p.stopsAt, now) : '');
  const pin = (p: { status: string; pinned?: PreviewView['pinned'] } | undefined) => p?.status === 'running' && p.pinned != null && <Icon name="pin" label={pinLabel(p.pinned)} />;
  const mainStops = stops(repo.preview);
  return (
    <div className="channels" role="tablist" aria-label="Channels">
      <button role="tab" aria-selected={channel == null} className={`channel ${channel == null ? 'channel-on' : ''}`} onClick={() => onPick(null)} title={`The floor's app on ${repo.defaultBranch}`}>
        <span className={`led led-${channelLed(repo.preview.status)}`} aria-hidden /> {repo.defaultBranch}
        {pin(repo.preview)}
        {mainStops && <span className="channel-stops">· {mainStops}</span>}
      </button>
      {live.map((p) => {
        const label = channelLabel(p, qa[qaKey(repo.id, p.number)]);
        const badge = qaBadge(qa[qaKey(repo.id, p.number)]);
        const preview = prPreviews[qaKey(repo.id, p.number)];
        const left = stops(preview);
        return (
          <button key={p.number} role="tab" aria-selected={channel === p.number} className={`channel ${channel === p.number ? 'channel-on' : ''}`} onClick={() => onPick(p.number)} title={left ? `${label} · ${left}` : label}>
            {/* the title shortens on a phone, its QA status stays readable (#294) */}
            <span className={`led led-${channelLed(preview?.status)}`} aria-hidden /> <span className="channel-name">{channelLabel(p)}</span>
            {badge && <span>· {badge}</span>}
            {pin(preview)}
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
                  <Icon name="play" /> Preview
                </button>
              </li>
            ))}
          </ul>
        </Sheet>
      )}
    </div>
  );
}

/**
 * How a running preview stands (#252): "In use (own tab)", "Stops 1:00 after you leave", "📌 until 15:00" (with Unpin),
 * and in its max lifetime's last minute "Still using it?" with Keep it running. An agent's hold is HeldNote's.
 */
export function UseNote({ preview, repo }: { preview: PreviewView; repo: RepoView }) {
  const settings = useStore((s) => s.settings);
  const now = useNow();
  if (preview.status !== 'running' || preview.heldBy) return null;
  const idleMin = preview.pr == null ? settings.mainPreviewIdleMin : settings.prPreviewIdleMin;
  const text = standLabel(preview, idleMin, now);
  const lifeLeft = preview.lifeEndsAt == null ? null : preview.lifeEndsAt - now;
  return (
    <>
      {lifeLeft != null && lifeLeft <= 60_000 && (
        <div className="held-note small use-life" role="alert">
          <span>Still using it? It stops in {clockLeft(lifeLeft)}, its max lifetime.</span>
          <button className="btn btn-small btn-good" onClick={() => void api.keepPreview(repo.id, preview.pr).catch(() => undefined)}>
            Keep it running
          </button>
        </div>
      )}
      {text && (
        <div className="held-note small use-note" role="status">
          <span>
            {preview.pinned != null && <Icon name="pin" />} {text}
          </span>
          {preview.pinned != null && (
            <button className="btn btn-small" onClick={() => void api.keepPreview(repo.id, preview.pr, 'off').catch(() => undefined)} title="Let it stop by itself again">
              Unpin
            </button>
          )}
        </div>
      )}
    </>
  );
}

/** The ⋯ menu's 📌 items for a running preview the manager may stop: keep it an hour, until stopped, or let it go again. */
export function keepItems(repo: RepoView, preview: PreviewView) {
  if (preview.status !== 'running' || preview.heldBy) return [];
  const pin = (how: 'hour' | 'forever' | 'off') => void api.keepPreview(repo.id, preview.pr, how).catch(() => undefined);
  return [
    { label: 'Keep running 1 h', onSelect: () => pin('hour') },
    { label: 'Keep running until I stop it', onSelect: () => pin('forever') },
    preview.pinned != null && { label: 'Let it stop by itself', hint: pinLabel(preview.pinned), onSelect: () => pin('off') },
  ];
}

/** A preview an agent is testing in: Stop and Restart are off, and the manager can ask the CEO instead. */
export function HeldNote({ preview, label, repo }: { preview: PreviewView; label: string; repo: RepoView }) {
  const ceo = useStore((s) => s.agents[CEO_ID]?.name ?? 'the CEO');
  if (!preview.heldBy) return null;
  return (
    <div className="held-note small" role="note">
      <span>
        <Icon name="lock" /> @{preview.heldBy} is testing in this
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
        <dt>Freed by stopping unused ones</dt>
        <dd>{stats.freed?.count ? `${size(stats.freed.mb * 1024 ** 2)} from ${stats.freed.count} preview${stats.freed.count === 1 ? '' : 's'}` : '—'}</dd>
        <dt>Last cleaned</dt>
        <dd>{cleaned}</dd>
      </dl>
    </Sheet>
  );
}
