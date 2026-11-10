// The floor theme's mood on the floor you're on (#370), as plain module state like ritualLook.ts: how bright the
// room's lights are and their tint (read by DayLights.tsx), and High's extra colour grade (read by gfx/pipeline.ts).
// `version` changes with it, so both redo their work only then. Nothing re-renders for it.
import * as THREE from 'three';
import { floorGrade, type FloorGrade } from '../gfx/grading';
import type { FloorMood } from './packs';

export const floorLook = { version: 0, light: 1, tint: new THREE.Color('#ffffff'), tintAmount: 0, grade: null as FloorGrade | null };

/** The floor on screen's mood, or null for the plain office. */
export function setFloorMood(mood: FloorMood | null) {
  floorLook.light = mood?.light ?? 1;
  floorLook.tint.set(mood?.tint ?? '#ffffff');
  floorLook.tintAmount = mood?.tintAmount ?? 0;
  floorLook.grade = mood ? floorGrade(mood.grade) : null;
  floorLook.version++;
}
