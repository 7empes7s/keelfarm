// The camera tile (#539): picture-in-picture of whoever turned their camera on, over the call screen, the chat and the
// office alike (2D, pocket and 3D). Drags anywhere on screen and stays inside it; × (or "turn off your camera") hides
// it. App.tsx loads it only while a camera is on; the 3D view inside is world/AgentCamTile.tsx, loaded with it.
import { lazy, Suspense, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useStore } from '../store';
import { cameraOff, useCamera } from './agentCameraStore';
import { Icon } from './Icon';
import './cameraTile.css';

const AgentCamTile = lazy(() => import('../world/AgentCamTile'));

/** Keeps a tile of size w×h at (x, y) inside the window, a 16px gutter all round. */
function clampTile(x: number, y: number, w: number, h: number, vw: number, vh: number) {
  const g = 16;
  return { x: Math.min(Math.max(g, x), Math.max(g, vw - w - g)), y: Math.min(Math.max(g, y), Math.max(g, vh - h - g)) };
}

export default function CameraTile() {
  const { agent: id, saying } = useCamera();
  const name = useStore((s) => (id ? s.agents[id]?.name : undefined));
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const press = useRef<{ dx: number; dy: number } | null>(null);
  const box = useRef<HTMLElement>(null);
  if (!id || !name) return null;

  const down = (e: ReactPointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    press.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const p = press.current;
    const r = box.current?.getBoundingClientRect();
    if (!p || !r) return;
    setPos(clampTile(e.clientX - p.dx, e.clientY - p.dy, r.width, r.height, window.innerWidth, window.innerHeight));
  };
  const up = () => (press.current = null);

  return (
    <section ref={box} className="cam-tile" role="dialog" aria-label={`${name}'s camera`} style={pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <div className="cam-frame">
        <Suspense fallback={<div className="cam-view cam-loading">{name.charAt(0)}</div>}>
          <AgentCamTile id={id} label={`${name} on camera, at their desk`} />
        </Suspense>
        <span className="cam-name">
          <span className="cam-live" aria-hidden /> {name}
        </span>
        <button type="button" className="ds-btn ds-btn-icon cam-close" aria-label={`Turn off ${name}'s camera`} title="Turn off the camera" onClick={cameraOff}>
          <Icon name="x" />
        </button>
      </div>
      {saying && (
        <p className="cam-saying" aria-live="polite">
          {saying}
        </p>
      )}
    </section>
  );
}
