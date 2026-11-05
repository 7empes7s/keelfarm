import { STICK } from '../world/touch/joystick';
import { useTouchStick } from '../world/touch/touchState';

// The floating joystick's ring and knob, only while a finger walks (world/touch/TouchControls.tsx), and the cue on a
// held press that lifting opens the menu. Outside the HUD so the UI scale doesn't move it off the finger.
export function TouchStick() {
  const ring = useTouchStick((s) => s.ring);
  const armed = useTouchStick((s) => s.armed);
  return (
    <>
      {ring && (
        <div className={`touch-stick ${ring.run ? 'touch-stick-run' : ''}`} style={{ left: ring.cx, top: ring.cy, width: STICK.radius * 2, height: STICK.radius * 2 }} aria-hidden="true">
          <div className="touch-knob" style={{ transform: `translate(${ring.kx}px, ${ring.ky}px)` }} />
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
