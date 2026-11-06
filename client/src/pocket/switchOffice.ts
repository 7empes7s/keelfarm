// The 2D / 3D office switch (#104): the 3D office's top bar, pocket mode's header on a desktop, and its key (O by
// default, Help → Controls), which works in both offices but never while typing in a field.
import { useStore } from '../store';
import { isConfirmOpen } from '../ui/Confirm';
import { isKey } from '../ui/controls';
import { otherMode, setMode, useMode } from './mode';

/** Whether a key went to a field being typed in (a checkbox or a button isn't one). */
export function typingIn(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el?.tagName) return false;
  if (el.tagName === 'INPUT') return !['range', 'checkbox', 'radio', 'button', 'submit', 'color'].includes((el as HTMLInputElement).type);
  return el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

/** Goes to the other office, closing whatever panel is open; this device remembers it. */
export function switchOffice() {
  useStore.getState().openOverlay(null);
  if (document.pointerLockElement) document.exitPointerLock();
  setMode(otherMode(useMode.getState().mode));
}

/** The switch's key, for as long as the app runs (App.tsx). */
export function installSwitchKey(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || typingIn(e.target) || isConfirmOpen() || !isKey('switchOffice', e.code)) return;
    e.preventDefault();
    switchOffice();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
