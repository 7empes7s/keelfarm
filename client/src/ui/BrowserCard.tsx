// An agent's browser card (#230): their last known address (a link to the same page in the floor's preview when it
// is one of its apps), the latest screenshot at the panel's full width, "@Grace's browser · 2 min ago" with a live dot
// while they browse, and the session's earlier screenshots as a filmstrip. A tap opens a picture full screen, where
// it pinches, wheels or double-taps to zoom (the HIG's image viewer).
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useStore, type Agent } from '../store';
import { addressBar, clampPan, clampZoom, isBrowsing, previewTarget, shotCaption } from './browserRules';
import { touchDistance } from './chatPinch';
import { useBackLayer } from './Panel';
import { isTopDialog, useDialogFocus } from './dialogFocus';
import { CloseButton, Icon } from './Icon';
import './browser.css';

const shotUrl = (agentId: string, at: number) => `/api/agents/${agentId}/screen?at=${at}`;

/** img: the latest screenshot, already loaded (TerminalView keeps it, so showing it never asks the server again). */
export function BrowserCard({ agent, img }: { agent: Agent; img: HTMLImageElement | null }) {
  const view = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<{ src: string; at: number | null } | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    view.current?.replaceChildren(...(img ? [img] : []));
  }, [img]);
  const now = Date.now();
  const address = addressBar(agent.browserUrl);
  const live = isBrowsing(agent, now);
  // This session's earlier shots, as screen events said (a new task's first shot starts the strip again).
  const times = useStore((st) => st.shotTimes[agent.id]);
  const earlier = (times ?? []).filter((at) => at >= (agent.startedAt ?? 0) && at < (agent.screenshotAt ?? 0)).slice(-5);
  const openPreview = () => {
    const st = useStore.getState();
    const pulls = st.repos.find((r) => r.id === agent.repoId)?.pulls ?? [];
    if (address.previewPath && agent.repoId) st.openOverlay({ kind: 'app', repoId: agent.repoId, ...previewTarget(agent.prNumber, pulls, address.previewPath) });
  };

  return (
    <figure className="bc" aria-label={`${agent.name}'s browser`}>
      <div className="bc-bar">
        <Icon name={address.secure ? 'lock' : 'globe'} />
        {address.previewPath ? (
          <button type="button" className="bc-url bc-link" title={`Open ${address.previewPath} in the floor's preview`} onClick={openPreview}>
            {address.text}
          </button>
        ) : (
          <span className={`bc-url ${address.unknown ? 'muted' : ''}`} title={address.unknown ? 'Their screenshots haven’t said which page they are of' : address.text}>
            {address.text}
          </span>
        )}
      </div>
      <button type="button" className="bc-shot" ref={view} aria-label="Their latest screenshot, full screen" onClick={() => img && setOpen({ src: img.src, at: agent.screenshotAt })} />
      <figcaption className="bc-caption small">
        {live && <span className="bc-live" aria-label="Browsing now" />}
        <span className="grow">{shotCaption(agent.name, agent.screenshotAt, now)}</span>
      </figcaption>
      {earlier.length > 0 && (
        <div className="bc-strip" role="list" aria-label="Earlier screenshots">
          {earlier.map((at) => (
            <button key={at} type="button" role="listitem" className="bc-thumb" title={shotCaption(agent.name, at, now)} aria-label={`Earlier screenshot, ${shotCaption(agent.name, at, now)}`} onClick={() => setOpen({ src: shotUrl(agent.id, at), at })}>
              <img src={shotUrl(agent.id, at)} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {open && <ShotViewer src={open.src} caption={shotCaption(agent.name, open.at, now)} onClose={() => setOpen(null)} />}
    </figure>
  );
}

/** A screenshot full screen: pinch, Ctrl/⌘ + wheel or double-tap zooms, a drag pans while zoomed; × or Esc or Back closes. */
function ShotViewer({ src, caption, onClose }: { src: string; caption: string; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const points = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; zoom: number } | null>(null);
  const drag = useRef<{ x: number; y: number; pan: { x: number; y: number } } | null>(null);
  const lastTap = useRef(0);
  useDialogFocus(box);
  useBackLayer(onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !isTopDialog(box.current)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const size = () => ({ w: stage.current?.clientWidth ?? 0, h: stage.current?.clientHeight ?? 0 });
  const zoomTo = (z: number) => {
    const next = clampZoom(z);
    setZoom(next);
    setPan((p) => clampPan(p, next, size()));
  };
  const down = (e: ReactPointerEvent) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    points.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [a, b] = [...points.current.values()];
    if (b) {
      pinch.current = { d: touchDistance(a, b), zoom };
      drag.current = null;
    } else {
      drag.current = { x: e.clientX, y: e.clientY, pan };
      const t = Date.now();
      if (t - lastTap.current < 300) zoomTo(zoom > 1 ? 1 : 2.5);
      lastTap.current = t;
    }
  };
  const move = (e: ReactPointerEvent) => {
    if (!points.current.has(e.pointerId)) return;
    points.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [a, b] = [...points.current.values()];
    if (pinch.current && b) zoomTo(pinch.current.zoom * (touchDistance(a, b) / Math.max(1, pinch.current.d)));
    else if (drag.current && zoom > 1) setPan(clampPan({ x: drag.current.pan.x + e.clientX - drag.current.x, y: drag.current.pan.y + e.clientY - drag.current.y }, zoom, size()));
  };
  const up = (e: ReactPointerEvent) => {
    points.current.delete(e.pointerId);
    if (points.current.size < 2) pinch.current = null;
    if (!points.current.size) drag.current = null;
  };

  return createPortal(
    <div ref={box} className="bc-viewer" role="dialog" aria-modal="true" aria-label={caption} tabIndex={-1}>
      <div className="bc-viewer-head">
        <span className="grow bc-viewer-caption">{caption}</span>
        {zoom > 1 && (
          <button type="button" className="btn btn-small" onClick={() => zoomTo(1)}>
            Fit
          </button>
        )}
        <CloseButton onClick={onClose} />
      </div>
      <div
        ref={stage}
        className="bc-stage"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onWheel={(e) => (e.ctrlKey || e.metaKey || zoom > 1) && zoomTo(zoom * Math.exp(-e.deltaY * 0.002))}
      >
        <img src={src} alt={caption} draggable={false} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} />
      </div>
    </div>,
    document.body,
  );
}
