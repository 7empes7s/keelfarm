// The memory map's canvas (#136): the graph drawn in a 2D canvas (fast on phones), its physics (mapForce.ts) running
// only until it rests, and the gestures: one finger pans, two pinch, a tap selects, a long press opens the node's
// card; a mouse drags, wheels and hovers; the keyboard steps through the nodes. Live changes pulse, a merge bursts.
import { useEffect, useRef, useState } from 'react';
import type { MapChange, MapNode, MemoryGraph } from '../../../shared/memoryMap';
import { createSim, fitView, hitTest, settle, tick, zoomAt, ALPHA_MIN, type Body, type Sim, type View } from './mapForce';
import { reduceMotion } from './a11y';

export interface MapPaint {
  fill: (n: MapNode) => string;
  ring: (n: MapNode) => string | null;
  byType?: boolean; // coloured by type: the map room draws agents in their shirts' colours
}

/** What the map's stage gets: this 2D canvas, or the map room's 3D constellation (Constellation.tsx). */
export interface MapStageProps {
  graph: MemoryGraph;
  paint: MapPaint;
  selected: string | null;
  lit: Set<string> | null; // what stands out (the selection's neighbours, an insight's nodes); the rest fades
  pulses: { changes: MapChange[]; at: number };
  centre: { id: string; at: number } | null; // pan to this node (a search pick)
  onSelect: (id: string | null) => void;
  onMenu: (id: string) => void;
}

const HOLD_MS = 500;
const SLOP = 8;
const PULSE_MS = 1400;

export function MapCanvas({ graph, paint, selected, lit, pulses, centre, onSelect, onMenu }: MapStageProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const sim = useRef<Sim>({ bodies: [], links: [], alpha: 0 });
  const view = useRef<View | null>(null);
  const size = useRef({ w: 0, h: 0 });
  const live = useRef<{ id: string; kind: MapChange['kind']; t0: number }[]>([]);
  const frame = useRef(0);
  const props = useRef({ graph, paint, selected, lit });
  props.current = { graph, paint, selected, lit };
  const [hover, setHover] = useState<{ node: MapNode; x: number; y: number } | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const hoverId = useRef<string | null>(null);
  hoverId.current = hover?.node.id ?? null;

  const draw = () => {
    const c = canvas.current;
    const v = view.current;
    if (!c || !v) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const { graph, paint, selected, lit } = props.current;
    const dpr = c.width / Math.max(1, size.current.w);
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const bodies = new Map(sim.current.bodies.map((b) => [b.id, b]));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(dpr * v.k, 0, 0, dpr * v.k, dpr * v.x, dpr * v.y);
    const faded = (id: string) => !!lit && !lit.has(id);
    // links
    ctx.lineCap = 'round';
    for (const e of graph.edges) {
      const a = bodies.get(e.source);
      const b = bodies.get(e.target);
      if (!a || !b) continue;
      const on = !!lit && lit.has(e.source) && lit.has(e.target);
      ctx.globalAlpha = lit && !on ? 0.06 : on ? 0.7 : 0.22;
      ctx.strokeStyle = e.kind === 'overlap' ? '#ef476f' : '#1f1d2b';
      ctx.lineWidth = (on ? 1.8 : 1) / Math.sqrt(v.k);
      ctx.setLineDash(e.kind === 'overlap' ? [4, 3] : []);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // nodes, then their labels on top
    const now = performance.now();
    for (const b of sim.current.bodies) {
      const n = byId.get(b.id);
      if (!n) continue;
      ctx.globalAlpha = faded(b.id) ? 0.18 : 1;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = paint.fill(n);
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = '#1f1d2b';
      ctx.stroke();
      const ring = paint.ring(n);
      if (ring) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r + 2.5, 0, Math.PI * 2);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = ring;
        ctx.stroke();
      }
      if (b.id === selected || b.id === focusRef.current) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r + 6, 0, Math.PI * 2);
        ctx.lineWidth = 2.5 / v.k;
        ctx.strokeStyle = '#ff9f1c';
        ctx.stroke();
      }
    }
    live.current = live.current.filter((p) => now - p.t0 < PULSE_MS);
    for (const p of live.current) {
      const b = bodies.get(p.id);
      if (!b) continue;
      const t = (now - p.t0) / PULSE_MS;
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = p.kind === 'merged' ? '#2dc653' : '#ff9f1c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 4 + t * 22, 0, Math.PI * 2);
      ctx.stroke();
      if (p.kind === 'merged') {
        ctx.fillStyle = '#ffd166';
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(b.x + Math.cos(a) * (b.r + t * 34), b.y + Math.sin(a) * (b.r + t * 34), 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.font = `600 ${12 / v.k}px ${getComputedStyle(c).fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    for (const b of sim.current.bodies) {
      const n = byId.get(b.id);
      if (!n) continue;
      const near = !!lit && lit.has(b.id);
      const show = b.id === selected || b.id === hoverId.current || b.id === focusRef.current || near || n.type === 'company' || n.type === 'floor' || b.r * v.k >= 11;
      if (!show || faded(b.id)) continue;
      ctx.globalAlpha = 1;
      const text = n.label.length > 22 ? `${n.label.slice(0, 21)}…` : n.label;
      ctx.lineWidth = 3 / v.k;
      ctx.strokeStyle = '#fffaf0';
      ctx.strokeText(text, b.x, b.y + b.r + 4);
      ctx.fillStyle = '#1f1d2b';
      ctx.fillText(text, b.x, b.y + b.r + 4);
    }
    ctx.globalAlpha = 1;
  };

  // one loop while something moves: the physics, a pulse
  const kick = () => {
    if (frame.current) return;
    const loop = () => {
      const moving = tick(sim.current);
      draw();
      frame.current = moving || live.current.length ? requestAnimationFrame(loop) : 0;
    };
    frame.current = requestAnimationFrame(loop);
  };
  const redraw = () => (frame.current ? undefined : requestAnimationFrame(draw));

  // a new graph: keep where nodes were, settle at once under reduced motion
  useEffect(() => {
    const prev = new Map(sim.current.bodies.map((b) => [b.id, b] as [string, Body]));
    sim.current = createSim(graph.nodes, graph.edges, prev);
    if (reduceMotion()) settle(sim.current);
    if (!view.current && size.current.w) {
      settle(sim.current);
      view.current = fitView(sim.current.bodies, size.current.w, size.current.h);
    }
    if (sim.current.alpha >= ALPHA_MIN) kick();
    else redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  useEffect(() => {
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, lit, paint, focus]);

  useEffect(() => {
    if (!pulses.changes.length || reduceMotion()) return;
    const t0 = performance.now();
    live.current.push(...pulses.changes.map((c) => ({ ...c, t0 })));
    kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulses]);

  useEffect(() => {
    const b = centre && sim.current.bodies.find((x) => x.id === centre.id);
    if (!b || !view.current) return;
    const k = Math.max(view.current.k, 1.4);
    view.current = { k, x: size.current.w / 2 - b.x * k, y: size.current.h / 2 - b.y * k };
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centre]);

  // the canvas follows its box, sharp on any screen
  useEffect(() => {
    const el = wrap.current;
    const c = canvas.current;
    if (!el || !c) return;
    const fit = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      if (!view.current && w) {
        settle(sim.current);
        view.current = fitView(sim.current.bodies, w, h);
      } else if (view.current && size.current.w) {
        view.current = { ...view.current, x: view.current.x + (w - size.current.w) / 2, y: view.current.y + (h - size.current.h) / 2 };
      }
      size.current = { w, h };
      draw();
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- gestures ----------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ x: number; y: number; t: number; moved: boolean; held: boolean; timer: number; pinch: number | null } | null>(null);
  const at = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const nodeAt = (x: number, y: number, touch: boolean) => {
    const b = view.current && hitTest(sim.current.bodies, view.current, x, y, touch ? 14 : 6);
    return b ? (props.current.graph.nodes.find((n) => n.id === b.id) ?? null) : null;
  };

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      if (!view.current) return;
      e.preventDefault();
      const p = at(e);
      view.current = zoomAt(view.current, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), p.x, p.y);
      redraw();
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const down = (e: React.PointerEvent) => {
    canvas.current?.setPointerCapture(e.pointerId);
    const p = at(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 1) {
      const touch = e.pointerType !== 'mouse';
      const timer = window.setTimeout(() => {
        const g = gesture.current;
        const n = g && !g.moved ? nodeAt(g.x, g.y, touch) : null;
        if (!g || !n) return;
        g.held = true;
        navigator.vibrate?.(12);
        onMenu(n.id);
      }, HOLD_MS);
      gesture.current = { ...p, t: performance.now(), moved: false, held: false, timer, pinch: null };
    } else if (gesture.current) {
      clearTimeout(gesture.current.timer);
      gesture.current.moved = true;
      const [a, b] = [...pointers.current.values()];
      gesture.current.pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const move = (e: React.PointerEvent) => {
    const p = at(e);
    const g = gesture.current;
    const last = pointers.current.get(e.pointerId);
    if (!last || !g || !view.current) {
      if (e.pointerType === 'mouse') {
        const n = nodeAt(p.x, p.y, false);
        setHover(n ? { node: n, x: p.x, y: p.y } : null);
        if (n?.id !== hoverId.current) redraw();
      }
      return;
    }
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size >= 2 && g.pinch) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      // the midpoint moved by half of this pointer's move
      view.current = zoomAt({ ...view.current, x: view.current.x + (p.x - last.x) / 2, y: view.current.y + (p.y - last.y) / 2 }, d / g.pinch, mid.x, mid.y);
      g.pinch = d;
      redraw();
      return;
    }
    if (!g.moved && Math.hypot(p.x - g.x, p.y - g.y) < SLOP) return;
    if (!g.moved) {
      g.moved = true;
      clearTimeout(g.timer);
    }
    view.current = { ...view.current, x: view.current.x + p.x - last.x, y: view.current.y + p.y - last.y };
    setHover(null);
    redraw();
  };
  const up = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size > 0 || !g) return;
    clearTimeout(g.timer);
    gesture.current = null;
    if (g.moved || g.held || e.type === 'pointercancel') return;
    const n = nodeAt(g.x, g.y, e.pointerType !== 'mouse');
    if (n) navigator.vibrate?.(8);
    onSelect(n?.id ?? null);
  };

  // ---------- keyboard ----------
  const order = () => [...graph.nodes].sort((a, b) => b.weight - a.weight).map((n) => n.id);
  const key = (e: React.KeyboardEvent) => {
    const v = view.current;
    if (!v) return;
    const step = (d: number) => {
      const ids = order();
      const i = focus ? ids.indexOf(focus) : -1;
      const next = ids[(i + d + ids.length) % ids.length];
      setFocus(next);
      const b = sim.current.bodies.find((x) => x.id === next);
      if (b) view.current = { ...v, x: size.current.w / 2 - b.x * v.k, y: size.current.h / 2 - b.y * v.k };
    };
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') step(1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') step(-1);
    else if (e.key === 'Enter' && focus) onSelect(focus);
    else if ((e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) && focus) onMenu(focus);
    else if (e.key === '+' || e.key === '=') view.current = zoomAt(v, 1.25, size.current.w / 2, size.current.h / 2);
    else if (e.key === '-') view.current = zoomAt(v, 0.8, size.current.w / 2, size.current.h / 2);
    else if (e.key === '0') view.current = fitView(sim.current.bodies, size.current.w, size.current.h);
    else if (e.key === 'Escape' && (selected || focus)) {
      setFocus(null);
      onSelect(null);
    } else return;
    e.preventDefault();
    e.stopPropagation();
    redraw();
  };
  const focused = focus ? graph.nodes.find((n) => n.id === focus) : null;

  return (
    <div className="mm-canvas" ref={wrap}>
      <canvas
        ref={canvas}
        tabIndex={0}
        role="application"
        aria-roledescription="memory map"
        aria-label={`Memory map, ${graph.nodes.length} things and ${graph.edges.length} links. Arrow keys step through them, Enter opens one, plus and minus zoom, 0 fits the map.`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(null)}
        onKeyDown={key}
        onContextMenu={(e) => {
          e.preventDefault();
          const p = at(e);
          const n = nodeAt(p.x, p.y, false);
          if (n) onMenu(n.id);
        }}
      />
      <span className="sr-only" aria-live="polite">
        {focused ? focused.title : ''}
      </span>
      {hover && (
        <div className="mm-tip" style={{ left: hover.x, top: hover.y }} role="tooltip">
          <b>{hover.node.title}</b>
          {hover.node.status && <span className="muted"> · {hover.node.status}</span>}
        </div>
      )}
      <div className="mm-zoom">
        <button type="button" className="mm-zoom-btn" aria-label="Zoom in" onClick={() => view.current && ((view.current = zoomAt(view.current, 1.4, size.current.w / 2, size.current.h / 2)), redraw())}>
          +
        </button>
        <button type="button" className="mm-zoom-btn" aria-label="Zoom out" onClick={() => view.current && ((view.current = zoomAt(view.current, 1 / 1.4, size.current.w / 2, size.current.h / 2)), redraw())}>
          −
        </button>
        <button type="button" className="mm-zoom-btn" aria-label="Fit the map" title="Fit the map" onClick={() => ((view.current = fitView(sim.current.bodies, size.current.w, size.current.h)), redraw())}>
          ⤢
        </button>
      </div>
    </div>
  );
}
