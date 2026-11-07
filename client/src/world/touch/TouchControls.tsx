import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../../store';
import { isConfirmOpen } from '../../ui/Confirm';
import { photoActive } from '../../photo/gate';
import { cameraMode, rigOwnsCamera } from '../camera/rig';
import { pickFar, pickFocus } from '../interact';
import { leavePerch, perch } from '../perch';
import { runFocusAction } from '../Player';
import { startCharge, throwHeld } from '../toys/hands';
import { eAction } from '../toys/sip';
import { sipCoffee } from '../toys/sipping';
import { appViewport } from '../../viewport';
import { ROOF } from '../layout';
import { findPath, standable, walkways } from '../walkways';
import { cancelAll, createGestures, fingerCancel, fingerDown, fingerMove, fingerUp, tickGestures, type GestureEvent } from './gestures';
import { knobOffset, stickVector } from './joystick';
import { flingVelocity, gyroTurn, isDoubleTap, pinchZoom, STICK_RADIUS, thumbZone, trackLook, type LookTrail, type Screen } from './thumbs';
import { approach, cancelTapWalk, floorTarget, startTapWalk, type Pt } from './tapWalk';
import { isTouch, markUsed, openHoldMenu, touchInput, useHoldMenu, useTouchLook, useTouchStick } from './touchState';

// Inside the Canvas, on touch screens only: the canvas's touch pointers through the gesture grammar (gestures.ts) and
// the thumb zones (thumbs.ts, #123): the stick's corner walks (the floating joystick), the other corner looks, two
// looking fingers pinch to zoom, and a tap acts on what's under the finger (like E or a click, but aimed there),
// walking up to it first when it's out of reach; a tap on the floor above the thumbs walks there (tapWalk.ts). A
// hold opens that thing's menu. In the overview and the other views a tap is left to the browser's own click
// (CameraRig.tsx picks it up) and the joystick pans, as WASD does there.

/** How far a tap can send you: to a thing, and across the floor. */
const TAP_FAR = 14;
const FLOOR_FAR = 25;
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

const screenNow = (): Screen => ({ width: window.innerWidth, ...appViewport(window.innerHeight, window.visualViewport) });

/** Where you can stand on the floor you're on (the roof has no walk grid: its walls stop you). */
function floorOpen(): { open: (x: number, z: number) => boolean; path: (from: Pt, to: Pt) => Pt[] } {
  const floor = useStore.getState().floor;
  if (floor === ROOF) return { open: () => true, path: (_, to) => [to] };
  const w = walkways(floor === 0 ? 'lobby' : 'office');
  return { open: (x, z) => standable(w, x, z), path: (from, to) => findPath(w, from, to) ?? [to] };
}

/** window.__swarmTouch: the last gestures seen, and focusAt(x, y): what a tap there would act on, for QA and Playwright. */
const recent: string[] = [];
const probe: { recent: string[]; focusAt?: (x: number, y: number) => string | null } = { recent };
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__swarmTouch = probe;

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

const looking = (g: ReturnType<typeof createGestures>) => [...g.fingers.values()].some((f) => f.role === 'look');

export function TouchControls() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);
  const g = useMemo(() => createGestures(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1), []);
  const trail = useMemo<LookTrail>(() => [], []);
  const gyro = useTouchLook((s) => s.gyro);

  const handle = useMemo(() => {
    const el = gl.domElement;
    const focusAt = (x: number, y: number) => {
      const r = el.getBoundingClientRect();
      ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return pickFocus(ray);
    };
    Object.assign(probe, { focusAt: (x: number, y: number) => focusAt(x, y)?.label ?? null });
    /** Walks to what the tap just aimed at, out of reach: a thing (then uses it), else in the world zone the floor. */
    const walkTo = (floor: boolean) => {
      const from = { x: camera.position.x, z: camera.position.z };
      const { open, path } = floorOpen();
      const far = pickFar(ray, TAP_FAR); // focusAt just aimed the ray here
      if (far) {
        const at = { x: far.point.x, z: far.point.z };
        const focus = far.focus;
        if (!useTouchStick.getState().tapped) markUsed('tapped');
        return startTapWalk(path(from, approach(from, at, open)), { at, reach: Math.max(1.2, far.range - 0.4), arrive: () => runFocusAction(focus, 'click') });
      }
      const hit = floor ? ray.ray.intersectPlane(floorPlane, new THREE.Vector3()) : null;
      const to = hit && hit.distanceTo(camera.position) <= FLOOR_FAR ? floorTarget(from, { x: hit.x, z: hit.z }, open) : null;
      if (to) startTapWalk(path(from, to));
      if (to && !useTouchStick.getState().tapped) markUsed('tapped');
    };
    let lastTap: { x: number; y: number; t: number } | null = null;
    const tap = (x: number, y: number, t: number) => {
      if (perch()) return leavePerch();
      const s = useStore.getState();
      if (s.travel) return;
      const prefs = useTouchLook.getState();
      const zone = prefs.classic ? null : thumbZone(x, y, screenNow(), prefs);
      // a double tap in the look corner recentres the view
      const double = zone === 'look' && isDoubleTap(lastTap, x, y, t);
      lastTap = double ? null : { x, y, t };
      if (double) {
        touchInput.recentre = true;
        return;
      }
      cancelTapWalk();
      const f = focusAt(x, y);
      if (f) return runFocusAction(f, 'click');
      // nothing in reach: what's in your hands, as E or a click would (a sip, a shot, a toss)
      if (s.held) {
        if (eAction(s.held, null) === 'sip') return sipCoffee();
        startCharge();
        throwHeld();
        return;
      }
      if (zone) walkTo(zone === 'world');
    };
    return (evs: GestureEvent[], t: number) => {
      for (const e of evs) {
        if (e.type !== 'stick' && e.type !== 'look' && e.type !== 'pinch') {
          recent.push(e.type);
          if (recent.length > 20) recent.shift();
        }
        if (e.type === 'stick') {
          const r = STICK_RADIUS[useTouchLook.getState().stickSize];
          const v = stickVector(e.x - e.cx, e.y - e.cy, r);
          const k = knobOffset(e.x - e.cx, e.y - e.cy, r);
          touchInput.x = v.x;
          touchInput.y = v.y;
          touchInput.run = v.run;
          cancelTapWalk(); // the stick takes over from a tap's walk
          useTouchStick.setState({ ring: { cx: e.cx, cy: e.cy, r, kx: k.x, ky: k.y, run: v.run }, armed: null });
          if (!useTouchStick.getState().walked) markUsed('walked');
        } else if (e.type === 'stickEnd') stopStick();
        else if (e.type === 'look') {
          if (!useTouchStick.getState().looked) markUsed('looked');
          touchInput.lookX += e.dx;
          touchInput.lookY += e.dy;
          touchInput.flingX = 0;
          touchInput.flingY = 0;
          trackLook(trail, e.dx, e.dy, t);
        } else if (e.type === 'pinch') {
          if (onFoot()) touchInput.zoom = pinchZoom(touchInput.zoom, e.scale);
        } else if (e.type === 'armed') {
          if (onFoot()) useTouchStick.setState({ armed: { x: e.x, y: e.y } });
        } else if (e.type === 'hold') {
          useTouchStick.setState({ armed: null });
          const f = onFoot() ? focusAt(e.x, e.y) : null;
          if (f) openHoldMenu(f);
        } else if (e.type === 'tap' && onFoot()) tap(e.x, e.y, t);
      }
      touchInput.looking = looking(g);
    };
  }, [gl, camera, ray, ndc, g, trail]);

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
      const zone = onFoot() ? thumbZone(e.clientX, e.clientY, screenNow(), useTouchLook.getState()) : 'stick'; // a view's drag pans
      if (!looking(g)) trail.length = 0;
      handle(fingerDown(g, e.pointerId, e.clientX, e.clientY, e.timeStamp, zone === 'world' ? 'look' : zone), e.timeStamp); // when it happened, not when a slow frame let us see it
    };
    const onMove = (e: PointerEvent) => {
      if (touch(e)) handle(fingerMove(g, e.pointerId, e.clientX, e.clientY), e.timeStamp);
    };
    const onUp = (e: PointerEvent) => {
      if (!touch(e)) return;
      const lookFinger = g.fingers.get(e.pointerId)?.role === 'look';
      handle(fingerUp(g, e.pointerId, e.clientX, e.clientY, e.timeStamp), e.timeStamp);
      if (!lookFinger || looking(g) || !onFoot()) return;
      // a look drag let go while still moving carries on turning, slowing down (Player.tsx)
      const v = flingVelocity(trail, e.timeStamp);
      touchInput.flingX = v.x;
      touchInput.flingY = v.y;
      trail.length = 0;
    };
    const onCancel = (e: PointerEvent) => {
      if (!touch(e)) return;
      handle(fingerCancel(g, e.pointerId), e.timeStamp);
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
      touchInput.looking = false;
    };
  }, [gl, g, handle, trail]);

  // Tilting the phone looks around too (Help → Controls → Touch; the permission was asked there).
  useEffect(() => {
    if (!isTouch || !gyro) return;
    let prev: { alpha: number; beta: number; gamma: number } | null = null;
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.alpha == null || e.beta == null || e.gamma == null) return;
      const cur = { alpha: e.alpha, beta: e.beta, gamma: e.gamma };
      if (prev && onFoot() && !blocked()) {
        const d = gyroTurn(prev, cur, screen.orientation?.angle ?? 0);
        touchInput.gyroYaw += d.yaw;
        touchInput.gyroPitch += d.pitch;
      }
      prev = cur;
    };
    window.addEventListener('deviceorientation', onTilt);
    return () => window.removeEventListener('deviceorientation', onTilt);
  }, [gyro]);

  useFrame(() => {
    if (!isTouch || !g.fingers.size) return;
    if (blocked()) {
      handle(cancelAll(g), performance.now());
      useTouchStick.setState({ armed: null });
      return;
    }
    handle(tickGestures(g, performance.now()), performance.now());
  });

  return null;
}
