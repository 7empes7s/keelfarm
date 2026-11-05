import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../../store';
import { isConfirmOpen } from '../../ui/Confirm';
import { photoActive } from '../../photo/gate';
import { cameraMode, rigOwnsCamera } from '../camera/rig';
import { pickFocus } from '../interact';
import { leavePerch, perch } from '../perch';
import { runFocusAction } from '../Player';
import { startCharge, throwHeld } from '../toys/hands';
import { eAction } from '../toys/sip';
import { sipCoffee } from '../toys/sipping';
import { cancelAll, createGestures, fingerCancel, fingerDown, fingerMove, fingerUp, tickGestures, type GestureEvent } from './gestures';
import { knobOffset, stickVector } from './joystick';
import { isTouch, openHoldMenu, touchInput, useHoldMenu, useTouchStick } from './touchState';

// Inside the Canvas, on touch screens only: the canvas's touch pointers through the gesture grammar (gestures.ts).
// A drag anywhere walks (the floating joystick), a second finger looks, a tap acts on what's under the finger (like
// E or a click, but aimed there), and a hold opens that thing's menu. In the overview and the other views a tap is
// left to the browser's own click (CameraRig.tsx picks it up) and the joystick pans, as WASD does there.

const onFoot = () => cameraMode() === 'first' && !rigOwnsCamera();

/** The view isn't taking fingers: before the start, under a panel, a question or the hold menu, in photo mode. */
function blocked() {
  const s = useStore.getState();
  return !s.started || !!s.overlay || isConfirmOpen() || photoActive() || !!useHoldMenu.getState().focus;
}

function stopStick() {
  touchInput.x = 0;
  touchInput.y = 0;
  touchInput.run = false;
  useTouchStick.setState({ ring: null });
}

export function TouchControls() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);
  const g = useMemo(() => createGestures(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1), []);

  const handle = useMemo(() => {
    const el = gl.domElement;
    const focusAt = (x: number, y: number) => {
      const r = el.getBoundingClientRect();
      ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return pickFocus(ray);
    };
    const tap = (x: number, y: number) => {
      if (perch()) return leavePerch();
      const s = useStore.getState();
      if (s.travel) return;
      const f = focusAt(x, y);
      if (f) return runFocusAction(f, 'click');
      // nothing there: what's in your hands, as E or a click would (a sip, a shot, a toss)
      if (!s.held) return;
      if (eAction(s.held, null) === 'sip') return sipCoffee();
      startCharge();
      throwHeld();
    };
    return (evs: GestureEvent[]) => {
      for (const e of evs) {
        if (e.type === 'stick') {
          const v = stickVector(e.x - e.cx, e.y - e.cy);
          const k = knobOffset(e.x - e.cx, e.y - e.cy);
          touchInput.x = v.x;
          touchInput.y = v.y;
          touchInput.run = v.run;
          useTouchStick.setState({ ring: { cx: e.cx, cy: e.cy, kx: k.x, ky: k.y, run: v.run }, armed: null, walked: true });
        } else if (e.type === 'stickEnd') stopStick();
        else if (e.type === 'look') {
          touchInput.lookX += e.dx;
          touchInput.lookY += e.dy;
        } else if (e.type === 'armed') {
          if (onFoot()) useTouchStick.setState({ armed: { x: e.x, y: e.y } });
        } else if (e.type === 'hold') {
          useTouchStick.setState({ armed: null });
          const f = onFoot() ? focusAt(e.x, e.y) : null;
          if (f) openHoldMenu(f);
        } else if (e.type === 'tap' && onFoot()) tap(e.x, e.y);
      }
    };
  }, [gl, camera, ray, ndc]);

  useEffect(() => {
    if (!isTouch) return;
    const el = gl.domElement;
    const touch = (e: PointerEvent) => e.pointerType === 'touch';
    const onDown = (e: PointerEvent) => {
      if (!touch(e) || blocked()) return;
      // On foot, the fingers are ours: no compatibility mouse events (Player.tsx's click) and no browser gestures.
      // In a view, a tap stays a click for CameraRig.tsx.
      if (onFoot()) e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // already gone
      }
      handle(fingerDown(g, e.pointerId, e.clientX, e.clientY, performance.now()));
    };
    const onMove = (e: PointerEvent) => {
      if (touch(e)) handle(fingerMove(g, e.pointerId, e.clientX, e.clientY));
    };
    const onUp = (e: PointerEvent) => {
      if (touch(e)) handle(fingerUp(g, e.pointerId, e.clientX, e.clientY, performance.now()));
    };
    const onCancel = (e: PointerEvent) => {
      if (!touch(e)) return;
      handle(fingerCancel(g, e.pointerId));
      useTouchStick.setState({ armed: null });
    };
    const noMenu = (e: Event) => e.preventDefault(); // a long press is the hold menu's, not the browser's
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    el.addEventListener('contextmenu', noMenu);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      el.removeEventListener('contextmenu', noMenu);
      cancelAll(g);
      stopStick();
    };
  }, [gl, g, handle]);

  useFrame(() => {
    if (!isTouch || !g.fingers.size) return;
    if (blocked()) {
      handle(cancelAll(g));
      useTouchStick.setState({ armed: null });
      return;
    }
    handle(tickGestures(g, performance.now()));
  });

  return null;
}
