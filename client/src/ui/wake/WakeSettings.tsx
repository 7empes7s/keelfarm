// Settings → Voice → Wake word (#537, docs/voice.md "Wake word"): say the word while the office is open to start a
// call, no tap. On this device only (its mic); off by default; the first time it's on the browser asks for the mic.
import { useEffect, useId, useState } from 'react';
import { callAudio } from '../agentCallStore';
import { Icon } from '../Icon';
import { setWakePrefs, useWake } from './wakeStore';
import { PAUSE_WORDS, sensitivityLabel, WAKE_WORDS } from './wakeWord';

const STATUS: Record<'starting' | 'tap' | 'error', string> = {
  starting: 'Starting: loading the wake word and asking for the microphone',
  tap: 'Tap anywhere in the office to start listening (the browser wants a tap first)',
  error: "The wake word couldn't load in this browser",
};

export function WakeSettings() {
  const prefs = useWake((s) => s.prefs);
  const status = useWake((s) => s.status);
  const score = useWake((s) => s.score);
  const why = useWake((s) => s.why);
  const radio = useId();
  const [sens, setSens] = useState(prefs.sensitivity);
  useEffect(() => setSens(prefs.sensitivity), [prefs.sensitivity]);
  const commit = () => sens !== prefs.sensitivity && setWakePrefs({ sensitivity: sens });
  const words = status in STATUS ? STATUS[status as keyof typeof STATUS] : PAUSE_WORDS[status as keyof typeof PAUSE_WORDS];
  return (
    <div className="wake-settings" data-testid="wake-settings">
      <h4>
        <Icon name="mic" /> Wake word
      </h4>
      <label className="toggle">
        <input
          type="checkbox"
          checked={prefs.on}
          onChange={(e) => {
            if (e.target.checked) callAudio(); // inside the tap: iPhones only start audio from one
            setWakePrefs({ on: e.target.checked });
          }}
        />
        <span>
          Start a call by saying "{WAKE_WORDS.find((w) => w.id === prefs.word)?.label}"
          <span className="muted small"> · on this device, only while the office is open on screen</span>
        </span>
      </label>
      <p className="muted small">
        It listens on this device and nothing is sent anywhere until it hears the word: then a chime, and the call starts as if you tapped Call. A phone can't listen in the background or with the screen locked, so it's while the office is on
        screen. It pauses during a call, while the message box's mic listens, while the office is in the background and on low battery.
      </p>
      {prefs.on && (
        <>
          <p className="wake-status small" data-testid="wake-status" data-status={status || 'listening'}>
            <span>{status === 'error' && why ? `${words}: ${why}` : words}</span>
            {status === '' && (
              <span className="wake-meter" role="meter" aria-label="What it hears" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(score * 100)}>
                <span style={{ width: `${Math.round(score * 100)}%` }} />
              </span>
            )}
          </p>
          <div role="radiogroup" aria-labelledby={`${radio}-label`}>
            <div id={`${radio}-label`} className="field">
              Word
            </div>
            {WAKE_WORDS.map((w) => (
              <label key={w.id} className="toggle block">
                <input type="radio" name={radio} checked={prefs.word === w.id} onChange={() => setWakePrefs({ word: w.id })} />
                <span>
                  <b>{w.label}</b> ({w.note})
                </span>
              </label>
            ))}
          </div>
          <label className="field">
            <span>
              Sensitivity <b>{sensitivityLabel(sens)}</b>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={sens}
              onChange={(e) => setSens(Number(e.target.value))}
              onPointerUp={commit}
              onKeyUp={commit}
              onBlur={commit}
              aria-valuetext={sensitivityLabel(sens)}
            />
            <span className="muted small">Strict wakes only on a clear word; Easy hears it from across the room but may wake by mistake now and then.</span>
          </label>
        </>
      )}
    </div>
  );
}
