// The docked CEO chat's width on a desktop (#212): a grip on its left edge, dragged or nudged with the arrow keys
// between 360 and 520 px, remembered on this device. The pages beside it reflow into what's left.
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { DOCK_MAX, DOCK_MIN, dockWidth } from '../ui/panels';

const KEY = 'cubefarm:pocket-chat-width';

function saved(): number {
  try {
    return dockWidth(localStorage.getItem(KEY));
  } catch {
    return dockWidth(null);
  }
}

function save(w: number) {
  try {
    localStorage.setItem(KEY, String(w));
  } catch {
    // remembered for this visit only
  }
}

/** The chat's width and its grip. */
export function useDockWidth(): [number, (w: number) => void] {
  const [w, setW] = useState(saved);
  return [
    w,
    (next) => {
      const v = dockWidth(next);
      setW(v);
      save(v);
    },
  ];
}

export function DockGrip({ width, onWidth }: { width: number; onWidth: (w: number) => void }) {
  const drag = useRef<{ x: number; w: number } | null>(null);
  const [live, setLive] = useState<number | null>(null);
  const shown = live ?? width;
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const w = dockWidth(drag.current.w + drag.current.x - e.clientX); // leftwards widens the chat
    setLive(w);
    e.currentTarget.parentElement?.style.setProperty('--pk-dock-w', `${w}px`);
  };
  const end = () => {
    if (drag.current && live !== null) onWidth(live);
    drag.current = null;
    setLive(null);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 40 : 10;
    const to = { ArrowLeft: width + step, ArrowRight: width - step, Home: DOCK_MAX, End: DOCK_MIN }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    onWidth(to);
  };
  return (
    <div
      className="pk-dock-grip"
      role="separator"
      aria-orientation="vertical"
      aria-label="Chat width"
      aria-valuemin={DOCK_MIN}
      aria-valuemax={DOCK_MAX}
      aria-valuenow={shown}
      tabIndex={0}
      title="Drag to resize the chat"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, w: width };
      }}
      onPointerMove={onMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKey}
    />
  );
}
