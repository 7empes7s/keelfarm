// The app viewer's channel row and the previews' upkeep (#204): the channel on screen first, then main, the other
// running previews and a Recent group (#414), the rest under "More (N)" in a sheet; who is testing in a preview the
// manager can't stop; how each one stands (in use, kept 📌, when it stops, #252); and the previews' stats.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { qaKey, useStore } from '../store';
import { CEO_ID, type PreviewView, type PullInfo, type RepoView } from '../../../shared/types';
import { api } from '../api';
import { busyPrs, channelLabel, channelLed, channelOrder, chipTime, clockLeft, keepOrder, pinLabel, previewingPrs, PR_PREVIEW_SLOTS, qaBadge, stopsLabel, standLabel, type Channel, type Chip } from './channels';
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

/**
 * The strip's chips in a fixed order while it's open (#414): it re-orders only when the channel changes from outside
 * the strip (the viewer opened or re-tuned on another one), not on a pick here, so the picked chip lights up in place.
 */
function useStripOrder(next: { chips: Chip[]; more: PullInfo[] }, channel: Channel) {
  const kept = useRef<{ anchor: Channel; chips: Chip[] } | null>(null);
  const picked = useRef<Channel | undefined>(undefined);
  const prev = kept.current && (channel === kept.current.anchor || channel === picked.current) ? kept.current : null;
  const order = keepOrder(prev?.chips ?? null, next);
  const anchor = prev?.anchor ?? channel;
  useLayoutEffect(() => {
    if (!prev) picked.current = undefined;
    kept.current = { anchor, chips: order.chips };
  });
  return { ...order, anchor, pick: (c: Channel) => (picked.current = c) };
}

/** The channel on screen, main, the running previews, Recent and a "More (N)" chip; picking a PR starts its preview. */
export function ChannelBar({ repo, channel, onPick }: { repo: RepoView; channel: Channel; onPick: (pr: Channel) => void }) {
  const prPreviews = useStore((s) => s.prPreviews);
  const qa = useStore((s) => s.qa);
  const agents = useStore((s) => s.agents);
  const recentHours = useStore((s) => s.settings.previewRecentHours);
  const now = useNow();
  const [showMore, setShowMore] = useState(false);
  const strip = useRef<HTMLDivElement>(null);
  const used = new Map(Object.values(prPreviews).flatMap((p) => (p.repoId === repo.id ? [[p.pr, p.viewedAt] as const] : [])));
  const { chips, more, anchor, pick } = useStripOrder(channelOrder(repo.pulls, { busy: busyPrs(Object.values(agents), repo.id), previewing: previewingPrs(prPreviews, repo.id), current: channel, now, recentHours, used }), channel);
  const choose = (c: Channel) => {
    pick(c);
    onPick(c);
  };
  // Opened (or re-tuned) on a channel: its chip, first in the strip, is in view.
  useEffect(() => {
    strip.current?.querySelector('.channel-on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [anchor]);
  const pulls = new Map(repo.pulls.map((p) => [p.number, p]));
  const stops = (p: { status: string; stopsAt?: number | null; pinned?: PreviewView['pinned'] } | undefined) => (p?.status === 'running' && p.pinned == null ? stopsLabel(p.stopsAt, now) : '');
  const pin = (p: { status: string; pinned?: PreviewView['pinned'] } | undefined) => p?.status === 'running' && p.pinned != null && <Icon name="pin" label={pinLabel(p.pinned)} />;
  const watching = <Icon name="check" label="On screen" />;
  const chip = ({ channel: c }: Chip) => {
    const on = channel === c;
    if (c == null) {
      const mainStops = stops(repo.preview);
      return (
        <button key="main" role="tab" aria-selected={on} className={`channel ${on ? 'channel-on' : ''}`} onClick={() => choose(null)} title={`The floor's app on ${repo.defaultBranch}`}>
          {on ? watching : <span className={`led led-${channelLed(repo.preview.status)}`} aria-hidden />} {repo.defaultBranch}
          {pin(repo.preview)}
          {mainStops && <span className="channel-stops">· {mainStops}</span>}
        </button>
      );
    }
    const p = pulls.get(c);
    if (!p) return null;
    const label = channelLabel(p, qa[qaKey(repo.id, c)]);
    const badge = qaBadge(qa[qaKey(repo.id, c)]);
    const preview = prPreviews[qaKey(repo.id, c)];
    const left = stops(preview);
    return (
      <button key={c} role="tab" aria-selected={on} className={`channel ${on ? 'channel-on' : ''}`} onClick={() => choose(c)} title={left ? `${label} · ${left}` : label}>
        {/* the title shortens on a phone, its QA status stays readable (#294) */}
        {on ? watching : <span className={`led led-${channelLed(preview?.status)}`} aria-hidden />} <span className="channel-name">{channelLabel(p)}</span>
        {badge && <span>· {badge}</span>}
        {pin(preview)}
        {left && <span className="channel-stops">· {left}</span>}
      </button>
    );
  };
  const firstRecent = chips.findIndex((c) => c.recent);
  return (
    <div className="channels" role="tablist" aria-label="Channels" ref={strip}>
      {chips.flatMap((c, i) => [
        i === firstRecent && (
          <span key="recent" className="channels-group small" aria-hidden>
            Recent
          </span>
        ),
        chip(c),
      ])}
      {more.length > 0 && (
        <button className="channel channel-older" aria-haspopup="dialog" onClick={() => setShowMore(true)} title="Other open PRs: older ones nobody is working on">
          More ({more.length})
        </button>
      )}
      {chips.length + more.length === 1 && <span className="muted small channels-empty">No open PRs: each one gets a channel here, to try it running beside {repo.defaultBranch}.</span>}
      {showMore && (
        <Sheet title={`More PRs (${more.length})`} onClose={() => setShowMore(false)}>
          <p className="muted small">Open PRs without a chip: older ones nobody is working on, unchanged in {recentHours} hours. Pick one to start its preview.</p>
          <ul className="older-prs">
            {more.map((p) => (
              <li key={p.number} className="older-pr">
                <span className="older-pr-title">
                  PR #{p.number} · {p.title}
                </span>
                {qaBadge(qa[qaKey(repo.id, p.number)]) && <span className="small">{qaBadge(qa[qaKey(repo.id, p.number)])}</span>}
                <button
                  className="btn btn-small"
                  aria-label={`Preview PR #${p.number}`}
                  onClick={() => {
                    setShowMore(false);
                    onPick(p.number); // not under the pointer: it comes first, as on opening
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
/** `chip`: its time is the slim bar's chip (`UseChip`); only the last-minute alert shows here. */
export function UseNote({ preview, repo, chip }: { preview: PreviewView; repo: RepoView; chip?: boolean }) {
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
      {text && !chip && (
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
/** A phone's slim bar (#382): when it stops on its own, as a small timer chip; the full words on hover and for screen readers. */
export function UseChip({ preview }: { preview: PreviewView }) {
  const settings = useStore((s) => s.settings);
  const now = useNow();
  if (preview.heldBy) return null;
  const text = standLabel(preview, preview.pr == null ? settings.mainPreviewIdleMin : settings.prPreviewIdleMin, now);
  if (!text) return null;
  const time = chipTime(text);
  return (
    <span className="chip use-chip small" role="status" title={text} aria-label={text}>
      <Icon name={preview.pinned != null ? 'pin' : 'timer'} />
      {time && ` ${time}`}
    </span>
  );
}

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
