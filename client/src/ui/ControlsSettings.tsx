import { useEffect, useState, useSyncExternalStore } from 'react';
import { SENSITIVITY_MAX, SENSITIVITY_MIN, useLookPrefs } from '../world/look';
import { pad, padName, watchPads } from '../world/gamepad';
import { isTouch, requestGyro, setTouchPrefs, useTouchLook } from '../world/touch/touchState';
import { TOUCH_DEFAULTS, TOUCH_SENS_MAX, TOUCH_SENS_MIN, type StickSide, type StickSize } from '../world/touch/thumbs';
import { clearBinding, resetControls, setBinding, setPadSensitivity, useControls } from './controls';
import { ACTIONS, PAD_SENSITIVITY_MAX, PAD_SENSITIVITY_MIN, SLOTS, actionDef, exactKeyLabel, findConflicts, keyLabel, type ActionDef, type ActionId } from './keymap';
import { Icon } from './Icon';

// Help → Controls: every key action rebindable (click a key, press the new one), conflicts called out, the mouse's
// sensitivity and invert-Y, the gamepad's sensitivity and button map, and a reset. All saved in this browser.

const GROUPS: ActionDef['group'][] = ['Moving', 'Hands', 'Office', 'Overview'];

function MouseSettings() {
  const { sensitivity, invertY, grabOnClose, set } = useLookPrefs();
  return (
    <div className="mouse-settings">
      <label className="mouse-sens">
        <span>Mouse sensitivity</span>
        <input type="range" min={SENSITIVITY_MIN} max={SENSITIVITY_MAX} step={0.05} value={sensitivity} onChange={(e) => set({ sensitivity: Number(e.target.value) })} />
        <b>{sensitivity.toFixed(2)}×</b>
        {sensitivity !== 1 && (
          <button className="btn btn-ghost btn-small" onClick={() => set({ sensitivity: 1 })}>
            Reset
          </button>
        )}
      </label>
      <label className="toggle">
        <input type="checkbox" checked={invertY} onChange={(e) => set({ invertY: e.target.checked })} /> Invert Y (push the mouse or the right stick forward to look down)
      </label>
      <label className="toggle">
        <input type="checkbox" checked={grabOnClose} onChange={(e) => set({ grabOnClose: e.target.checked })} /> Grab the mouse when panels close
      </label>
    </div>
  );
}

// The pad's state is read once a frame (Player.tsx): look again just after a plug event, and now and then.
function subscribePads(cb: () => void) {
  const off = watchPads(() => setTimeout(cb, 100));
  const t = setInterval(cb, 1000);
  return () => {
    off();
    clearInterval(t);
  };
}

/** The pad that's plugged in, or null. */
const padNow = () => (pad.connected ? padName(pad.id) : null);

function GamepadSettings() {
  const sens = useControls((s) => s.padSensitivity);
  const name = useSyncExternalStore(subscribePads, padNow);
  return (
    <div className="mouse-settings">
      <div className="pad-status">{name ? `🎮 ${name} is connected` : '🎮 No controller yet: plug one in and press a button.'}</div>
      <label className="mouse-sens">
        <span>Gamepad sensitivity</span>
        <input type="range" min={PAD_SENSITIVITY_MIN} max={PAD_SENSITIVITY_MAX} step={0.05} value={sens} onChange={(e) => setPadSensitivity(Number(e.target.value))} />
        <b>{sens.toFixed(2)}×</b>
      </label>
      <p className="muted small pad-map">
        Left stick walks (click it to run) · right stick looks · <b>A</b> uses (like E) · <b>B</b> goes back (Esc) · <b>X</b> picks up or drops · triggers throw and fire · <b>Y</b> reloads · <b>Start</b> the phone ·{' '}
        <b>Select</b> the overview (twice: the building) · <b>LB</b>/<b>RB</b> turn the overview, where the left stick pans, the right stick zooms and <b>A</b> opens what's in the middle.
      </p>
    </div>
  );
}

/** A choice of a few, as a segmented control. */
function Seg<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: [T, string][]; onPick: (v: T) => void }) {
  return (
    <div className="mouse-sens">
      <span>{label}</span>
      <div className="seg touch-seg" role="group" aria-label={label}>
        {options.map(([v, text]) => (
          <button key={v} className={`seg-btn ${value === v ? 'seg-on' : ''}`} aria-pressed={value === v} onClick={() => onPick(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function TouchSettings() {
  const p = useTouchLook();
  const [gyroNote, setGyroNote] = useState<string | null>(null);
  const toggleGyro = async (on: boolean) => {
    setGyroNote(null);
    if (on && !(await requestGyro())) return setGyroNote('Motion access was refused: allow it in the browser to look by tilting.');
    setTouchPrefs({ gyro: on });
  };
  return (
    <div className="mouse-settings">
      <label className="mouse-sens">
        <span>Look sensitivity</span>
        <input type="range" min={TOUCH_SENS_MIN} max={TOUCH_SENS_MAX} step={0.05} value={p.sensitivity} onChange={(e) => setTouchPrefs({ sensitivity: Number(e.target.value) })} />
        <b>{p.sensitivity.toFixed(2)}×</b>
      </label>
      <Seg<StickSide> label="Stick side" value={p.stickSide} options={[['left', 'Left'], ['right', 'Right']]} onPick={(stickSide) => setTouchPrefs({ stickSide })} />
      <Seg<StickSize> label="Stick size" value={p.stickSize} options={[['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']]} onPick={(stickSize) => setTouchPrefs({ stickSize })} />
      <label className="toggle">
        <input type="checkbox" checked={p.invertY} onChange={(e) => setTouchPrefs({ invertY: e.target.checked })} /> Invert Y (drag up to look down)
      </label>
      <label className="toggle">
        <input type="checkbox" checked={p.follow} onChange={(e) => setTouchPrefs({ follow: e.target.checked })} /> Camera follows (levels out and turns your way as you walk)
      </label>
      <label className="toggle">
        <input type="checkbox" checked={p.oneThumb} onChange={(e) => setTouchPrefs({ oneThumb: e.target.checked })} /> One thumb (the stick with a look strip above it, on the stick's side)
      </label>
      <label className="toggle">
        <input type="checkbox" checked={p.gyro} onChange={(e) => void toggleGyro(e.target.checked)} /> Tilt the phone to look
      </label>
      {gyroNote && (
        <p className="controls-note" role="status">
          {gyroNote}
        </p>
      )}
      <label className="toggle">
        <input type="checkbox" checked={p.classic} onChange={(e) => setTouchPrefs({ classic: e.target.checked })} /> Classic halves (top half looks, bottom half walks)
      </label>
      <p className="muted small pad-map">
        {p.classic
          ? 'Drag in the bottom half to walk (push far to run) · drag in the top half to look around · tap something to use it · hold it, then let go, for more options.'
          : 'Touch near the ghost stick to walk (push far to run) · drag in the other bottom corner to look, let go mid-swipe to keep turning, double-tap there to level the view · pinch to zoom · tap a thing or the floor to walk there · hold a thing, then let go, for more options.'}
      </p>
    </div>
  );
}

export function ControlsSettings() {
  const b = useControls((s) => s.bindings);
  const [listen, setListen] = useState<{ action: ActionId; slot: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Waiting for a key: it's caught before the office (or the panel's Esc) sees it.
  useEffect(() => {
    if (!listen) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === 'Escape') return setListen(null);
      const r = setBinding(listen.action, listen.slot, e.code);
      if (!r) return setNote(`${keyLabel(e.code)} can't be bound: it belongs to the browser (Esc always backs out).`);
      const what = actionDef(listen.action).label;
      setNote(
        r.displaced
          ? `${keyLabel(e.code)} is now ${what}. It was ${actionDef(r.displaced.action).label}'s, which ${r.displaced.key ? `moved to ${keyLabel(r.displaced.key)}` : 'has no key now'}.`
          : `${keyLabel(e.code)} is now ${what}.`,
      );
      setListen(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [listen]);

  const conflicts = findConflicts(b);
  const clash = new Set(conflicts.flatMap((c) => c.actions.map((a) => `${a}|${c.code}`)));
  const reset = () => {
    resetControls();
    useLookPrefs.getState().set({ sensitivity: 1, invertY: false, grabOnClose: true });
    setTouchPrefs(TOUCH_DEFAULTS);
    setListen(null);
    setNote('Every control is back to how it came.');
  };

  return (
    <div className="controls">
      <p className="muted small">Click a key and press the new one (Esc cancels). A key another action uses moves over, and that action gets your old key. Esc always backs out and frees the mouse.</p>
      {GROUPS.map((g) => (
        <div key={g} className="controls-group">
          <h3>{g === 'Overview' ? 'Overview and views' : g}</h3>
          <div className="controls-table" role="table" aria-label={`${g} keys`}>
            {ACTIONS.filter((a) => a.group === g).map((a) => (
              <div key={a.id} className="controls-row" role="row">
                <span role="cell" className="controls-name">
                  {a.label}
                </span>
                {Array.from({ length: SLOTS }, (_, slot) => {
                  const code = b[a.id][slot];
                  const waiting = listen?.action === a.id && listen.slot === slot;
                  return (
                    <span key={slot} role="cell" className="controls-slot">
                      <button
                        className={`key-btn ${waiting ? 'key-btn-wait' : ''} ${code && clash.has(`${a.id}|${code}`) ? 'key-btn-clash' : ''} ${!code ? 'key-btn-empty' : ''}`}
                        aria-label={`${a.label}: ${slot ? 'other key' : 'key'} ${code ? exactKeyLabel(code) : 'none'}. Click to change`}
                        onClick={(e) => {
                          e.currentTarget.blur();
                          setNote(null);
                          setListen(waiting ? null : { action: a.id, slot });
                        }}
                      >
                        {waiting ? 'press a key…' : code ? exactKeyLabel(code) : slot ? '+' : '—'}
                      </button>
                      {code && slot > 0 && (
                        <button className="key-clear" title="Remove this key" aria-label={`Remove ${exactKeyLabel(code)} from ${a.label}`} onClick={() => clearBinding(a.id, slot)}>
                          <Icon name="x" />
                        </button>
                      )}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ))}
      {note && (
        <p className="controls-note" role="status">
          {note}
        </p>
      )}
      {conflicts.length > 0 && (
        <p className="controls-clash" role="alert">
          ⚠️ {conflicts.map((c) => `${keyLabel(c.code)} does both ${actionDef(c.actions[0]).label} and ${actionDef(c.actions[1]).label}`).join('; ')}. Give one of them another key.
        </p>
      )}
      <h3>Mouse</h3>
      <MouseSettings />
      {isTouch && (
        <>
          <h3>Touch</h3>
          <TouchSettings />
        </>
      )}
      <h3>Gamepad</h3>
      <GamepadSettings />
      <div className="controls-reset">
        <button className="btn btn-small" onClick={reset}>
          ↺ Reset to defaults
        </button>
      </div>
    </div>
  );
}
