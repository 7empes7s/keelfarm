import { useSyncExternalStore } from 'react';
import { useStore } from '../store';
import { useCameraView } from '../world/camera/rig';
import { STICK_RADIUS, stickRest } from '../world/touch/thumbs';
import { isTouch, useTouchLook, useTouchStick } from '../world/touch/touchState';
import { appViewport } from '../viewport';

// The floating joystick's ring and knob while a finger walks (world/touch/TouchControls.tsx), its faint ghost where
// it rests in the thumb zones (#123), and the cue on a held press that lifting opens the menu. Outside the HUD so
// the UI scale doesn't move it off the finger.

function subscribeSize(cb: () => void) {
  window.addEventListener('resize', cb);
  window.visualViewport?.addEventListener('resize', cb);
  return () => {
    window.removeEventListener('resize', cb);
    window.visualViewport?.removeEventListener('resize', cb);
  };
}
const sizeKey = () => {
  const v = appViewport(window.innerHeight, window.visualViewport);
  return `${window.innerWidth}|${v.top}|${v.height}`;
};

export function TouchStick() {
  const ring = useTouchStick((s) => s.ring);
  const armed = useTouchStick((s) => s.armed);
  const prefs = useTouchLook();
  const idle = useStore((s) => s.started && !s.overlay && !s.travel);
  const onFoot = useCameraView((s) => s.mode) === 'first';
  const [width, top, height] = useSyncExternalStore(subscribeSize, sizeKey).split('|').map(Number);
  const rest = isTouch && !ring && idle && onFoot && !prefs.classic ? stickRest({ width, top, height }, prefs) : null;
  return (
    <>
      {ring && (
        <div className={`touch-stick ${ring.run ? 'touch-stick-run' : ''}`} style={{ left: ring.cx, top: ring.cy, width: ring.r * 2, height: ring.r * 2 }} aria-hidden="true">
          <div className="touch-knob" style={{ transform: `translate(${ring.kx}px, ${ring.ky}px)` }} />
        </div>
      )}
      {rest && (
        <div className="touch-stick touch-ghost" data-testid="stick-ghost" style={{ left: rest.x, top: rest.y, width: STICK_RADIUS[prefs.stickSize] * 2, height: STICK_RADIUS[prefs.stickSize] * 2 }} aria-hidden="true">
          <div className="touch-knob" />
        </div>
      )}
      {armed && (
        <div className="touch-armed" style={{ left: armed.x, top: armed.y }} aria-hidden="true">
          <span>Let go for options</span>
        </div>
      )}
    </>
  );
}
