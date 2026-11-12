// The wake word at app level (#537): WakeRunner decides when it listens (on, no call, the tab on screen, not on low
// battery) and loads the engine only then; WakeLight is the header's mic light while it listens, in the 3D office's
// HUD, the phone HUD and pocket mode. window.__swarmWake is the probe.
import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { Icon } from '../Icon';
import { inCall } from '../voiceCall';
import { useCall } from '../voiceCallStore';
import type * as Engine from './wakeEngine';
import { micLit, useWake } from './wakeStore';
import { batterySaver, wakePause, wakeWord } from './wakeWord';
import './wake.css';

let engine: Promise<typeof Engine> | null = null;
const loadEngine = () => (engine ??= import('./wakeEngine'));

function useHidden() {
  const [hidden, setHidden] = useState(() => document.visibilityState === 'hidden');
  useEffect(() => {
    const on = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return hidden;
}

type Battery = EventTarget & { charging: boolean; level: number };

/** Unplugged at 20% or less, where the browser says (Chrome's Battery API; Safari doesn't). */
function useBatterySaver(on: boolean) {
  const [saver, setSaver] = useState(false);
  useEffect(() => {
    const get = (navigator as unknown as { getBattery?: () => Promise<Battery> }).getBattery;
    if (!on || !get) return;
    let battery: Battery | null = null;
    const update = () => setSaver(batterySaver(battery));
    void get.call(navigator).then((b) => {
      battery = b;
      update();
      b.addEventListener('chargingchange', update);
      b.addEventListener('levelchange', update);
    }, () => undefined);
    return () => {
      battery?.removeEventListener('chargingchange', update);
      battery?.removeEventListener('levelchange', update);
    };
  }, [on]);
  return saver;
}

export function WakeRunner() {
  const prefs = useWake((s) => s.prefs);
  const micRefused = useWake((s) => s.micRefused);
  const calling = useCall((s) => inCall(s.call));
  const hidden = useHidden();
  const saver = useBatterySaver(prefs.on);
  const pause = wakePause({ on: prefs.on, inCall: calling, hidden, batterySaver: saver, micRefused });
  useEffect(() => {
    if (pause) {
      if (pause !== 'no-mic') useWake.setState({ status: pause });
      void engine?.then((e) => e.stopWake());
      return;
    }
    void loadEngine().then((e) => e.listen(prefs), (err: Error) => useWake.setState({ status: 'error', why: err.message }));
  }, [pause, prefs]);
  return null;
}

/** The header's mic light: on whenever the wake word is listening; a tap opens Settings → Voice. */
export function WakeLight({ className }: { className: string }) {
  const status = useWake((s) => s.status);
  const word = wakeWord(useWake((s) => s.prefs.word)).label;
  if (!micLit(status)) return null;
  const label = status === 'tap' ? `Tap anywhere to start listening for "${word}"` : status === 'starting' ? 'Starting the wake word' : `Listening for "${word}" on this device`;
  return (
    <button type="button" className={`wake-light xbtn ${className}`} data-wake={status || 'listening'} aria-label={label} title={label} onClick={() => useStore.getState().openOverlay({ kind: 'manager', tab: 'voice' })}>
      <Icon name="mic" />
      <span className="wake-dot" aria-hidden />
    </button>
  );
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__swarmWake = {
    get status() {
      return useWake.getState().status;
    },
    get wakes() {
      return useWake.getState().wakes;
    },
    stats: () => engine?.then((e) => e.wakeStats()) ?? null,
  };
}
