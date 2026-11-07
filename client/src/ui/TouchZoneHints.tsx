import { useSyncExternalStore } from 'react';
import { zoneHints } from '../world/touch/thumbs';
import { useTouchLook, useTouchStick } from '../world/touch/touchState';
import { appViewport } from '../viewport';

// The touch zones' first-time hints (#123): where to put each thumb and that a tap walks you to things, each gone
// for good on this device once it's been used (touchState.ts's markUsed).

const subscribe = (cb: () => void) => {
  window.addEventListener('resize', cb);
  return () => window.removeEventListener('resize', cb);
};
const sizeKey = () => {
  const v = appViewport(window.innerHeight, window.visualViewport);
  return `${window.innerWidth}|${v.top}|${v.height}`;
};

export function TouchZoneHints({ walked, looked }: { walked: boolean; looked: boolean }) {
  const prefs = useTouchLook();
  const tapped = useTouchStick((s) => s.tapped);
  const [width, top, height] = useSyncExternalStore(subscribe, sizeKey).split('|').map(Number);
  const spots = zoneHints({ width, top, height }, prefs);
  const at = ([x, y]: [number, number]) => ({ left: `${x}%`, top: `${y}%` });
  return (
    <>
      {!looked && (
        <div className="touch-zone-hint" style={at(spots.look)}>
          {prefs.classic ? 'Drag here to look' : '👆 Look'}
        </div>
      )}
      {!walked && (
        <div className="touch-zone-hint" style={at(spots.move)}>
          {prefs.classic ? 'Drag here to move' : '👆 Move'}
        </div>
      )}
      {!tapped && spots.world && (
        <div className="touch-zone-hint" style={at(spots.world)}>
          Tap things to go there
        </div>
      )}
    </>
  );
}
