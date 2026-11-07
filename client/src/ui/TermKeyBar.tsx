import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { barKeys, keyboardInset, MORE_KEYS, type BarKey, type Mod, type ModState } from '../../../shared/termKeys';
import type { AgentCli } from '../../../shared/types';

// The terminal key bar (#37): the keys a phone keyboard lacks (Esc, Tab, arrows, Ctrl…) and the coding agent's own
// shortcuts, docked above the on-screen keyboard. What each key sends is in shared/termKeys.ts.

const PREF = 'cubefarm:termKeys';
const touch = typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;

/**
 * Whether this device shows the bar: on for touch screens unless switched off, off elsewhere unless switched on.
 * The phone's terminal-first window (#86) passes `off` so it starts hidden there until ⌨ turns it on.
 */
export function useTermKeysPref(fallback = touch): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      const saved = localStorage.getItem(PREF);
      return saved ? saved === 'on' : fallback;
    } catch {
      return fallback;
    }
  });
  const save = (v: boolean) => {
    setOn(v);
    try {
      localStorage.setItem(PREF, v ? 'on' : 'off');
    } catch {
      // private mode: just this visit
    }
  };
  return [on, save];
}

/** How far the on-screen keyboard covers the page, in CSS px (0 when it's closed). */
function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setInset(keyboardInset(window.innerHeight, vv));
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return inset;
}

const REPEAT_DELAY = 400;
const REPEAT_EVERY = 60;

function KeyButton({ k, latch, onPress }: { k: BarKey; latch?: ModState[Mod]; onPress: (k: BarKey) => void }) {
  const delay = useRef<number | undefined>(undefined);
  const every = useRef<number | undefined>(undefined);
  const stop = () => {
    clearTimeout(delay.current);
    clearInterval(every.current);
  };
  useEffect(() => stop, []);
  const repeat = 'repeat' in k && k.repeat;
  // Paste goes on the click: a phone lets the clipboard be read only from a real activation, which a touch's pointer
  // down isn't (#278). Its pointer down still keeps the terminal focused.
  const paste = 'paste' in k;
  return (
    <button
      type="button"
      className={`term-key ${latch && latch !== 'off' ? `term-key-${latch}` : ''} ${paste && k.primary ? 'term-key-primary' : ''}`}
      title={k.title}
      aria-label={k.title}
      aria-pressed={latch ? latch !== 'off' : undefined}
      // Pressed on pointer down, with the default prevented, so the terminal keeps focus and the phone keyboard stays up.
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        if (paste) return;
        navigator.vibrate?.(8);
        onPress(k);
        if (repeat) delay.current = window.setTimeout(() => (every.current = window.setInterval(() => onPress(k), REPEAT_EVERY)), REPEAT_DELAY);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => (paste || e.detail === 0) && onPress(k)} // Enter or Space on a focused key; every Paste
    >
      {k.label}
    </button>
  );
}

/** `dock` (the default) moves the bar onto the phone keyboard while it's up; a window already above it passes false. */
export function TermKeyBar({ cli, mods, onPress, dock = true, signIn = false }: { cli: AgentCli; mods: ModState; onPress: (k: BarKey) => void; dock?: boolean; signIn?: boolean }) {
  const [more, setMore] = useState(false);
  const keyboard = useKeyboardInset();
  const inset = dock ? keyboard : 0;
  const key = (k: BarKey) => <KeyButton key={k.label} k={k} latch={'mod' in k ? mods[k.mod] : undefined} onPress={onPress} />;
  const bar = (
    <div className={`term-keys ${inset ? 'term-keys-docked' : ''}`} style={inset ? { bottom: inset } : undefined} role="toolbar" aria-label="Terminal keys">
      {more && (
        <div className="term-keys-more" role="group" aria-label="More keys">
          {MORE_KEYS.map(key)}
        </div>
      )}
      <div className="term-keys-row">
        {barKeys(cli, { signIn }).map(key)}
        <button type="button" className="term-key term-key-more" aria-label="More keys" aria-expanded={more} onPointerDown={(e) => e.preventDefault()} onClick={() => setMore((v) => !v)}>
          {more ? 'Less' : 'More'}
        </button>
      </div>
    </div>
  );
  // Docked, it goes to the body: a panel's transform would otherwise make it fixed to the panel, not the screen.
  return inset ? createPortal(bar, document.body) : bar;
}
