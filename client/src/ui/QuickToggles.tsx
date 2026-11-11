// The top bar's Sound and CC buttons (#267), in pocket mode's header and the 3D office's HUD: a tap mutes or unmutes and
// turns captions on or off; hover, keyboard focus or a long-press opens a small card with the volume, soundtrack and
// chatter, or the caption size, and a link to the rest. On a phone one "Sound & captions" button opens a sheet with
// both. They read the same stores as Settings (sfx.ts, a11y.ts), so a change anywhere shows here at once.
import { useId, useSyncExternalStore } from 'react';
import { useStore } from '../store';
import { useMode } from '../pocket/mode';
import { typingIn } from '../pocket/switchOffice';
import { usePhotoGate } from '../photo/gate';
import { CHATTER_LEVELS, type ChatterLevel } from './audioPrefs';
import { LIMITS } from './a11yPrefs';
import { setA11y, useA11y } from './a11y';
import { isConfirmOpen } from './Confirm';
import { bindings, keyName, useKeyName } from './controls';
import { Peek, usePeek } from './HoverCard';
import { Icon } from './Icon';
import { flip, quickKey, setCaptions, setMuted, type QuickToggle } from './quickToggleRules';
import { getAudioPrefs, setAudioPrefs, subscribeAudio } from './sfx';
import './quickToggles.css';

const toast = (text: string | null) => text && useStore.getState().pushToast('info', text);

/** M and C (Help → Controls) in both offices, never while typing in a field or with a dialog up. */
export function installQuickKeys(): () => void {
  const onKey = (e: KeyboardEvent) => {
    const t = quickKey(bindings(), e, e.defaultPrevented || typingIn(e.target) || isConfirmOpen(), usePhotoGate.getState().active);
    if (!t) return;
    e.preventDefault();
    toast(flip(t, keyName('mute')));
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}

const tap = (t: QuickToggle) => toast(flip(t, keyName('mute')));

/** The rest of the settings: the sound's (the 3D office's Help, the 2D office's Voice) or Accessibility. */
function more(what: 'sound' | 'access') {
  const pocket = useMode.getState().mode === 'pocket';
  useStore.getState().openOverlay(what === 'sound' && !pocket ? { kind: 'help' } : { kind: 'manager', tab: what === 'access' ? 'access' : 'voice' });
}

const CHATTER: Record<ChatterLevel, string> = { off: 'Off', quiet: 'Quiet', lively: 'Lively' };

function SoundSettings({ toggle }: { toggle?: boolean }) {
  const { muted, volume, soundtrack, chatter } = useSyncExternalStore(subscribeAudio, getAudioPrefs);
  const name = useId();
  return (
    <div className="qt-card">
      {toggle ? (
        <label className="toggle qt-row">
          <input type="checkbox" checked={!muted} onChange={(e) => toast(setMuted(!e.target.checked, keyName('mute')))} /> <Icon name={muted ? 'volume-x' : 'volume-2'} /> Sound
        </label>
      ) : (
        <b className="peek-title">{muted ? 'Sound is off' : 'Sound'}</b>
      )}
      <label className="qt-row">
        <span className="qt-name">Volume</span>
        <input type="range" min={0} max={100} step={5} value={volume} disabled={muted} aria-label="Volume" onChange={(e) => setAudioPrefs({ volume: Number(e.target.value) })} />
        <span className="qt-pct">{volume}%</span>
      </label>
      <label className="toggle qt-row">
        <input type="checkbox" checked={soundtrack} onChange={(e) => setAudioPrefs({ soundtrack: e.target.checked })} /> <Icon name="music" /> Soundtrack
      </label>
      <div className="qt-row" role="radiogroup" aria-label="Agent chatter">
        <span className="qt-name">Chatter</span>
        {CHATTER_LEVELS.map((l) => (
          <label key={l} className="toggle">
            <input type="radio" name={name} checked={chatter === l} onChange={() => setAudioPrefs({ chatter: l })} /> {CHATTER[l]}
          </label>
        ))}
      </div>
      <button type="button" className="btn btn-ghost qt-more" onClick={() => more('sound')}>
        More sound settings <Icon name="chevron-right" />
      </button>
    </div>
  );
}

function CaptionSettings({ toggle }: { toggle?: boolean }) {
  const { captions, captionSize } = useA11y((s) => s.prefs);
  const { min, max, step } = LIMITS.captionSize;
  return (
    <div className="qt-card">
      {toggle ? (
        <label className="toggle qt-row">
          <input type="checkbox" checked={captions} onChange={(e) => toast(setCaptions(e.target.checked))} /> <Icon name="captions" /> Captions
        </label>
      ) : (
        <b className="peek-title">{captions ? 'Captions are on' : 'Captions are off'}</b>
      )}
      <label className="qt-row">
        <span className="qt-name">Caption size</span>
        <input type="range" min={min} max={max} step={step} value={captionSize} aria-label="Caption size" onChange={(e) => setA11y({ captionSize: Number(e.target.value) })} />
        <span className="qt-pct">{captionSize}%</span>
      </label>
      <button type="button" className="btn btn-ghost qt-more" onClick={() => more('access')}>
        More in Accessibility <Icon name="chevron-right" />
      </button>
    </div>
  );
}

function SoundButton({ className }: { className: string }) {
  const muted = useSyncExternalStore(subscribeAudio, () => getAudioPrefs().muted);
  const key = useKeyName('mute');
  const peek = usePeek();
  const label = muted ? 'Unmute sound' : 'Mute sound';
  return (
    <>
      <button
        type="button"
        data-tour="sound"
        ref={(el) => void (peek.anchor.current = el)}
        className={`${className} qt-btn ${muted ? 'qt-off' : ''}`}
        aria-label={label}
        title={`${label} (${key})`}
        aria-describedby={peek.mode ? peek.id : undefined}
        {...peek.trigger}
        onClick={() => tap('mute')}
      >
        <Icon name={muted ? 'volume-x' : 'volume-2'} />
      </button>
      <Peek peek={peek} label="Sound" anchored="center">
        <SoundSettings toggle={peek.mode === 'sheet'} />
      </Peek>
    </>
  );
}

function CaptionsButton({ className }: { className: string }) {
  const on = useA11y((s) => s.prefs.captions);
  const key = useKeyName('captions');
  const peek = usePeek();
  return (
    <>
      <button
        type="button"
        ref={(el) => void (peek.anchor.current = el)}
        className={`${className} qt-btn ${on ? 'qt-on' : ''}`}
        aria-label="Captions"
        aria-pressed={on}
        title={`Turn captions ${on ? 'off' : 'on'} (${key})`}
        aria-describedby={peek.mode ? peek.id : undefined}
        {...peek.trigger}
        onClick={() => tap('captions')}
      >
        <Icon name={on ? 'captions' : 'captions-off'} />
      </button>
      <Peek peek={peek} label="Captions" anchored="center">
        <CaptionSettings toggle={peek.mode === 'sheet'} />
      </Peek>
    </>
  );
}

/** A phone's top bar has room for one: it opens a sheet with both toggles. */
function SoundAndCaptions({ className }: { className: string }) {
  const muted = useSyncExternalStore(subscribeAudio, () => getAudioPrefs().muted);
  const captions = useA11y((s) => s.prefs.captions);
  const peek = usePeek();
  return (
    <>
      <button
        type="button"
        ref={(el) => void (peek.anchor.current = el)}
        className={`${className} qt-btn ${muted ? 'qt-off' : ''}`}
        aria-label={`Sound & captions: sound ${muted ? 'off' : 'on'}, captions ${captions ? 'on' : 'off'}`}
        aria-haspopup="dialog"
        data-tour="sound"
        title="Sound & captions"
        onClick={() => peek.ctl.sheet()}
      >
        <Icon name={muted ? 'volume-x' : 'volume-2'} />
        {captions && <span className="qt-cc-dot" aria-hidden />}
      </button>
      <Peek peek={peek} label="Sound & captions">
        <SoundSettings toggle />
        <CaptionSettings toggle />
      </Peek>
    </>
  );
}

/** Sound and CC, or on a phone (`compact`) the one button for both. */
export function QuickToggles({ className, compact }: { className: string; compact?: boolean }) {
  if (compact) return <SoundAndCaptions className={className} />;
  return (
    <>
      <SoundButton className={className} />
      <CaptionsButton className={className} />
    </>
  );
}
