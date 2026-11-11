// The Settings tab's Voice section: who reads messages aloud, the ElevenLabs key (write-only), the voice, and a Test;
// then talking instead of typing: who turns speech into text, auto-send and hands-free. The key lives on the server;
// the browser only ever sees its last 4 characters.
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { SAMPLE_LINE } from '../../../shared/speech';
import { cacheLabel, clampKeepDays, KEEP_DAYS_MAX, KEEP_DAYS_MIN } from '../../../shared/voiceClips';
import { CEO_ID, type ListenProvider, type ListenSettings, type VoiceProvider, type VoiceSettings as Voice } from '../../../shared/types';
import { confirmDialog } from './Confirm';
import { Icon } from './Icon';
import { Menu } from './Menu';
import { micCaps, setHandsFree } from './mic';
import { pauseLabel, useMicPause } from './micPause';
import { PAUSE_CHOICES } from './micSilence';
import { cantListen } from './micText';
import { Key } from './Key';
import { browserVoices, type BrowserVoice } from './voicePicker';
import { playClip, speakLine, stopVoice } from './voicePlayback';
import { hintMuted, useVoiceList, VoicePicker, type Playing } from './VoiceChooser';
import { clampSpeed, modelPrice, SPEED_MAX, SPEED_MIN, SPEED_STEP, speedLabel, VOICE_MODELS } from '../../../shared/voices';
import { SecretInput } from './SecretInput';
import { chooseVoicePatch } from './voiceQuickRules';

const DOCS = 'https://github.com/leonvanzyl/cubefarm/blob/main/docs/voice.md';

const PROVIDERS: [VoiceProvider, string, string][] = [
  ['off', 'Off', ''],
  ['browser', 'Browser voice', 'free, built in'],
  ['elevenlabs', 'ElevenLabs', 'natural voices, with your own key'],
];

const LISTENERS: [ListenProvider, string, string][] = [
  ['off', 'Off', 'no mic'],
  ['browser', 'Browser', 'free, built in'],
  ['elevenlabs', 'ElevenLabs Speech to Text', 'with your own key'],
];

type Save = (patch: Partial<Voice>) => void;

/** Saves a change to settings.voice over what the store has now: Settings → Voice and the Sound sheet (#500) both. */
export const saveVoice: Save = (patch) => void api.updateSettings({ voice: { ...useStore.getState().settings.voice, ...patch } }).catch(() => undefined);

/** The browser's voices, which arrive asynchronously; null where the browser can't speak. */
function useBrowserVoices(): BrowserVoice[] | null {
  const read = () => (typeof speechSynthesis === 'undefined' ? null : browserVoices(speechSynthesis.getVoices(), navigator.language));
  const [voices, setVoices] = useState(read);
  useEffect(() => {
    if (typeof speechSynthesis === 'undefined') return;
    const update = () => setVoices(read());
    speechSynthesis.addEventListener('voiceschanged', update);
    update();
    return () => speechSynthesis.removeEventListener('voiceschanged', update);
  }, []);
  return voices;
}

function ElevenLabsKey() {
  const keySet = useStore((s) => s.voiceKeySet);
  const hint = useStore((s) => s.voiceKeyHint);
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const errorId = useId();
  const save = async (value: string) => {
    setBusy(true);
    setError('');
    try {
      await api.setVoiceKey(value);
      setKey(''); // the key is never kept or shown again once it's saved
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  if (keySet && !editing)
    return (
      <div className="row wrap">
        <span className="grow">
          <Icon name="key-round" /> Key saved <code>••••{hint}</code>
        </span>
        <button className="btn btn-small" onClick={() => setEditing(true)}>
          Replace
        </button>
        <Menu
          label="More for the ElevenLabs key"
          title="ElevenLabs key"
          items={[
            {
              label: 'Remove the key…',
              danger: true,
              disabled: busy,
              onSelect: () =>
                void confirmDialog({ tone: 'danger', title: 'Remove the ElevenLabs key?', body: 'It is deleted from this PC. Messages are not read aloud by ElevenLabs until you add a key again.', confirm: 'Remove' }).then((ok) => {
                  if (ok) void save('');
                }),
            },
          ]}
        />
      </div>
    );
  return (
    <form
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        if (key.trim()) void save(key.trim());
      }}
    >
      <label className="field">
        <span>ElevenLabs API key</span>
        <SecretInput
          name="elevenlabs-key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={keySet ? 'Paste the new key' : 'Paste your key'}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
        />
      </label>
      {error && (
        <div id={errorId} className="term-error small" role="alert">
          {error}
        </div>
      )}
      <div className="row">
        <button className="btn btn-small btn-good" disabled={busy || !key.trim()}>
          {busy ? 'Checking…' : 'Save key'}
        </button>
        {editing && (
          <button
            type="button"
            className="btn btn-small btn-ghost"
            onClick={() => {
              setEditing(false);
              setKey('');
              setError('');
            }}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function ElevenLabsVoices({ voice, save, playing, setPlaying }: { voice: Voice; save: Save; playing: Playing; setPlaying: (p: Playing) => void }) {
  const list = useVoiceList();
  const chars = useStore((s) => s.voiceCache.charsToday);
  const model = VOICE_MODELS.find((m) => m.id === voice.model);
  return (
    <>
      <div className="field">
        <span>
          Voice{voice.voiceName && <span className="muted"> · {voice.voiceName}</span>} <span className="muted small">(the CEO's, also in their profile)</span>
        </span>
      </div>
      <VoicePicker list={list} chosen={voice.voiceId} onChoose={(v) => save(chooseVoicePatch(v))} name="elevenlabs-voice" playing={playing} setPlaying={setPlaying} />
      <label className="field">
        <span>Model</span>
        <select value={voice.model} onChange={(e) => save({ model: e.target.value })}>
          {!VOICE_MODELS.some((m) => m.id === voice.model) && <option value={voice.model}>{voice.model}</option>}
          {VOICE_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} · {modelPrice(m)}
            </option>
          ))}
        </select>
        {model && <span className="muted small">{model.note}</span>}
        <span className="muted small">
          {chars.toLocaleString()} characters used today{model && ` · about $${((chars / 1000) * model.usdPer1k).toFixed(2)}`}
        </span>
      </label>
    </>
  );
}

/** Speech speed, 0.7–1.2: ElevenLabs' voice_settings.speed, or the browser voice's rate. Saved when let go. */
export function Speed({ voice, save }: { voice: Voice; save: Save }) {
  const [speed, setSpeed] = useState(voice.speed);
  useEffect(() => setSpeed(voice.speed), [voice.speed]);
  const commit = () => speed !== voice.speed && save({ speed });
  return (
    <label className="field">
      <span>
        Speed <b>{speedLabel(speed)}</b>
      </span>
      <input
        type="range"
        min={SPEED_MIN}
        max={SPEED_MAX}
        step={SPEED_STEP}
        value={speed}
        onChange={(e) => setSpeed(clampSpeed(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        aria-valuetext={speedLabel(speed)}
      />
    </label>
  );
}

export function BrowserVoices({ voice, save }: { voice: Voice; save: Save }) {
  const voices = useBrowserVoices();
  if (!voices) return <p className="muted small">This browser can't speak. Try Chrome or Edge, or pick ElevenLabs.</p>;
  const chosen = voices.some((v) => v.name === voice.voiceName) ? voice.voiceName : '';
  return (
    <label className="field">
      <span>Browser voice</span>
      <select value={chosen} onChange={(e) => save({ voiceName: e.target.value })}>
        <option value="">The browser's default</option>
        {voices.map((v) => (
          <option key={v.name} value={v.name}>
            {v.name}
            {v.lang && ` (${v.lang})`}
          </option>
        ))}
      </select>
      {voices.length === 0 && <span className="muted small">The browser hasn't listed its voices yet; its default voice is used.</span>}
    </label>
  );
}

/** How long ElevenLabs clips are kept for the phone's ▶, how much is saved now, and a way to clear it. */
function SavedClips({ voice, save }: { voice: Voice; save: Save }) {
  const cache = useStore((s) => s.voiceCache);
  const [days, setDays] = useState(String(voice.keepDays));
  const [busy, setBusy] = useState(false);
  useEffect(() => setDays(String(voice.keepDays)), [voice.keepDays]);
  const commit = () => {
    const n = clampKeepDays(days);
    setDays(String(n));
    if (n !== voice.keepDays) save({ keepDays: n });
  };
  const clear = async () => {
    const ok = await confirmDialog({
      tone: 'danger',
      title: 'Clear saved clips?',
      body: "Messages read by ElevenLabs can't be replayed from the phone after this. New messages are saved again as they arrive.",
      confirm: 'Clear',
    });
    if (!ok) return;
    setBusy(true);
    await api.clearVoiceCache().catch(() => undefined);
    setBusy(false);
  };
  return (
    <div className="voice-clips">
      <label className="field">
        <span>Keep voice clips for</span>
        <span className="row">
          <input
            type="number"
            min={KEEP_DAYS_MIN}
            max={KEEP_DAYS_MAX}
            step={1}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && commit()}
            style={{ width: '5em' }}
          />
          <span>days</span>
        </span>
      </label>
      <div className="row wrap">
        <span className="grow small">
          <Icon name="save" /> {cacheLabel(cache.clips, cache.bytes)}
          <span className="muted">
            {' '}
            · the newest 20 CEO messages always keep theirs, so <Icon name="play" /> on the phone replays them for free
          </span>
        </span>
        <Menu label="More for saved clips" title="Saved voice clips" items={[{ label: 'Clear saved clips…', danger: true, disabled: busy || cache.clips === 0, onSelect: () => void clear() }]} />
      </div>
    </div>
  );
}

/** The Test line in the voice in use, and which preview is playing; closing the screen stops it. */
export function useVoiceTest(voice: Voice, keySet: boolean) {
  const [playing, setPlaying] = useState<Playing>(null);
  const mine = useRef(playing);
  mine.current = playing;
  // Closing the screen stops its own preview or test, never another voice (an agent's line under the Sound card).
  useEffect(() => () => void (mine.current && stopVoice()), []);
  const eleven = voice.provider === 'elevenlabs';
  const canTest = voice.provider === 'browser' || (eleven && keySet && !!voice.voiceId);
  const test = async () => {
    if (playing === 'test') return stopVoice();
    hintMuted();
    setPlaying('test');
    try {
      const ok = eleven ? await playClip(await api.voiceSample(voice.voiceId)) : await speakLine(SAMPLE_LINE, voice.voiceName, voice.speed);
      if (!ok) useStore.getState().pushToast('error', eleven ? "Couldn't play the test" : "The browser couldn't speak the test line");
    } catch {
      // api already toasted the error
    } finally {
      setPlaying(null);
    }
  };
  return { playing, setPlaying, canTest, test };
}

/** The Test button: Stop while it plays. */
export function TestButton({ t }: { t: ReturnType<typeof useVoiceTest> }) {
  return (
    <button className="btn btn-small" disabled={!t.canTest} onClick={() => void t.test()} title={t.canTest ? undefined : 'Save a key and pick a voice first'}>
      {t.playing === 'test' ? (
        <>
          <Icon name="square" /> Stop
        </>
      ) : (
        <>
          <Icon name="volume-1" /> Test
        </>
      )}
    </button>
  );
}

export function VoiceSettings() {
  const voice = useStore((s) => s.settings.voice);
  const keySet = useStore((s) => s.voiceKeySet);
  const cache = useStore((s) => s.voiceCache);
  const radioName = useId();
  const save = saveVoice;
  const eleven = voice.provider === 'elevenlabs';
  const t = useVoiceTest(voice, keySet);
  const { playing, setPlaying } = t;
  return (
    <div className="card">
      <h3>
        <Icon name="volume-2" /> Voice
      </h3>
      <p className="muted small">Hear the CEO's messages read aloud the moment they arrive, without opening the phone.</p>
      <div role="radiogroup" aria-labelledby={`${radioName}-label`}>
        <div id={`${radioName}-label`} className="field">
          Speak messages
        </div>
        {PROVIDERS.map(([p, label, note]) => (
          <label key={p} className="toggle block">
            <input type="radio" name={radioName} checked={voice.provider === p} onChange={() => save({ provider: p })} />
            <span>
              <b>{label}</b>
              {note && ` (${note})`}
            </span>
          </label>
        ))}
      </div>
      {eleven && (
        <>
          <p className="muted small">
            Get a key at{' '}
            <a href="https://elevenlabs.io" target="_blank" rel="noreferrer">
              elevenlabs.io
            </a>{' '}
            (Developers → API Keys). It stays on this PC and is never shown again. Costs and voice tips are in{' '}
            <a href={DOCS} target="_blank" rel="noreferrer">
              docs/voice.md
            </a>
            .
          </p>
          <ElevenLabsKey />
          {keySet && <ElevenLabsVoices voice={voice} save={save} playing={playing} setPlaying={setPlaying} />}
        </>
      )}
      {voice.provider === 'browser' && <BrowserVoices voice={voice} save={save} />}
      {voice.provider !== 'off' && (
        <>
          <Speed voice={voice} save={save} />
          <label className="toggle">
            <input type="checkbox" checked={voice.speakOffice} onChange={(e) => save({ speakOffice: e.target.checked })} /> Also speak office alerts
          </label>
          <div className="row">
            <TestButton t={t} />
            <span className="muted small">Previews and tests play at your volume; M mutes them.</span>
          </div>
        </>
      )}
      <label className="toggle">
        <input type="checkbox" checked={voice.agentsSpeak} onChange={(e) => save({ agentsSpeak: e.target.checked })} />
        {/* one span: pocket mode's switch rows put the label's parts in reverse */}
        <span>
          Agents speak when clicked
          <span className="muted small"> · a short line in their own voice{eleven && keySet ? '' : ', with ElevenLabs and a key'}</span>
        </span>
      </label>
      {(eleven || cache.clips > 0) && <SavedClips voice={voice} save={save} />}
      <Listening keyShown={eleven} />
    </div>
  );
}

/** How long a quiet after speech means you've finished, on this device (the 🎙, hands-free and calls). */
function PauseChoice() {
  const { ms, set } = useMicPause();
  const label = useId();
  return (
    <div className="field">
      <span id={label}>Pause before I'm done</span>
      <div className="seg pause-seg" role="group" aria-labelledby={label}>
        {PAUSE_CHOICES.map((v) => (
          <button key={v} type="button" className={`seg-btn ${ms === v ? 'seg-on' : ''}`} aria-pressed={ms === v} onClick={() => set(v)}>
            {pauseLabel(v)}
          </button>
        ))}
      </div>
      <span className="muted small">On this device. A sentence left on "uh", "and" or a comma waits up to 3 times longer.</span>
    </div>
  );
}

/** Talking instead of typing: who turns speech into text, sending when you stop talking, and the hands-free phone. */
function Listening({ keyShown }: { keyShown: boolean }) {
  const listen = useStore((s) => s.settings.listen);
  const keySet = useStore((s) => s.voiceKeySet);
  const voiceOn = useStore((s) => s.settings.voice.provider !== 'off');
  const ceoName = useStore((s) => s.agents[CEO_ID]?.name ?? 'the CEO');
  const radioName = useId();
  if (!listen) return null;
  const save = (patch: Partial<ListenSettings>) => void api.updateSettings({ listen: { ...listen, ...patch } }).catch(() => undefined);
  const why = listen.provider === 'off' ? '' : cantListen(listen.provider, micCaps(), keySet || listen.provider !== 'elevenlabs');
  return (
    <div className="listen-settings">
      <h4>
        <Icon name="mic" /> Talk instead of type
      </h4>
      <p className="muted small">
        Hold the <Icon name="mic" /> next to Send (or hold <Key action="talk" /> in the message box) and speak: your words fill the box, to edit before you send. A quick tap listens until you stop talking. <kbd>Esc</kbd> stops listening.
      </p>
      <div role="radiogroup" aria-labelledby={`${radioName}-label`}>
        <div id={`${radioName}-label`} className="field">
          Turn speech into text with
        </div>
        {LISTENERS.map(([p, label, note]) => (
          <label key={p} className="toggle block">
            <input type="radio" name={radioName} checked={listen.provider === p} onChange={() => save({ provider: p })} />
            <span>
              <b>{label}</b> ({note})
            </span>
          </label>
        ))}
      </div>
      {why && <p className="term-error small">{why}</p>}
      <PauseChoice />
      {listen.provider === 'elevenlabs' && (
        <>
          <p className="muted small">
            What you say is recorded in this browser (60 seconds at most) and sent through the office to ElevenLabs, which charges by the length of the audio. A restricted key needs the{' '}
            <b>Speech to Text</b> permission.
          </p>
          {!keyShown && <ElevenLabsKey />}
        </>
      )}
      {listen.provider !== 'off' && (
        <>
          <label className="toggle">
            <input type="checkbox" checked={listen.autoSend} onChange={(e) => save({ autoSend: e.target.checked })} /> Send automatically when I stop talking
          </label>
          <label className="toggle" title={voiceOn ? undefined : `Needs ${ceoName}'s voice: pick one under Speak messages`}>
            <input type="checkbox" checked={listen.handsFree} disabled={!voiceOn && !listen.handsFree} onChange={(e) => void setHandsFree(e.target.checked, ceoName)} /> Hands-free on the phone: after{' '}
            {ceoName}'s spoken reply, listen for up to 8 s and send what I say{!voiceOn && <span className="muted"> (needs Speak messages above)</span>}
          </label>
        </>
      )}
    </div>
  );
}
