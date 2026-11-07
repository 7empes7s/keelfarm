// Where a chat link lands (#151): the section it names scrolled into view and tinted for a second, as iOS does.
// Under reduced motion it jumps there instead of scrolling.
import { reduceMotion } from './a11y';

const FLASH_MS = 1000;

/** Scrolls `el` into view and tints it briefly. */
export function flashInto(el: HTMLElement | null) {
  if (!el) return;
  el.scrollIntoView({ block: 'start', behavior: reduceMotion() ? 'auto' : 'smooth' });
  el.classList.add('jump-flash');
  setTimeout(() => el.classList.remove('jump-flash'), FLASH_MS);
}
