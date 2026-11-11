// The Sound card's and sheet's Voice block (#500): read messages aloud, who speaks, the voice with a picker and Test,
// the speed, agents' own voices and the ElevenLabs key's state. It saves through Settings → Voice's own saveVoice and
// draws its pickers, so a change here shows there at once and the other way round. The key itself is never shown.
import { useId, useState } from 'react';
import { useStore } from '../store';
import type { VoiceProvider } from '../../../shared/types';
import { Icon } from './Icon';
import { useVoiceList, VoicePicker } from './VoiceChooser';
import { BrowserVoices, saveVoice, Speed, TestButton, useVoiceTest } from './VoiceSettings';
import { chooseVoicePatch, elevenLabsUse, readAloudPatch } from './voiceQuickRules';

/** What was speaking before read-aloud went off, to turn back to (this tab only). */
let lastProvider: VoiceProvider | null = null;

const WHO: [VoiceProvider, string][] = [
  ['elevenlabs', 'ElevenLabs'],
  ['browser', 'This browser'],
];

function ElevenLabsPicker({ chosen, t }: { chosen: string; t: ReturnType<typeof useVoiceTest> }) {
  const list = useVoiceList();
  return (
    <div className="qt-picker" data-peek-keep>
      <VoicePicker list={list} chosen={chosen} onChoose={(v) => saveVoice(chooseVoicePatch(v))} name="quick-voice" playing={t.playing} setPlaying={t.setPlaying} />
    </div>
  );
}

export function VoiceQuick() {
  const voice = useStore((s) => s.settings.voice);
  const keySet = useStore((s) => s.voiceKeySet);
  const hint = useStore((s) => s.voiceKeyHint);
  const use = useStore((s) => elevenLabsUse(s.accounts.sources));
  const t = useVoiceTest(voice, keySet);
  const [picking, setPicking] = useState(false);
  const name = useId();
  const on = voice.provider !== 'off';
  const eleven = voice.provider === 'elevenlabs';
  const readAloud = (next: boolean) => {
    if (!next) lastProvider = voice.provider;
    saveVoice(readAloudPatch(next, keySet, lastProvider));
  };
  const toSettings = () => useStore.getState().openOverlay({ kind: 'manager', tab: 'voice' });
  return (
    <div className="qt-card qt-voice" role="group" aria-label="Voice">
      <label className="toggle qt-row">
        <input type="checkbox" checked={on} onChange={(e) => readAloud(e.target.checked)} /> <Icon name="message-circle" /> Read messages aloud
      </label>
      {on && (
        <>
          <div className="qt-row qt-who" role="radiogroup" aria-label="Who speaks">
            <span className="qt-name">Who speaks</span>
            {WHO.map(([p, label]) => (
              <label key={p} className="toggle">
                <input type="radio" name={name} checked={voice.provider === p} onChange={() => saveVoice({ provider: p })} /> {label}
              </label>
            ))}
          </div>
          {eleven && keySet && (
            <>
              <div className="qt-row">
                <span className="qt-name">Voice</span>
                <b className="qt-voice-name">{voice.voiceName || 'None yet'}</b>
                <button type="button" className="btn btn-small btn-ghost" data-peek-keep aria-expanded={picking} onClick={() => setPicking(!picking)}>
                  {picking ? 'Done' : 'Change'}
                </button>
                <span data-peek-keep>
                  <TestButton t={t} />
                </span>
              </div>
              {picking && <ElevenLabsPicker chosen={voice.voiceId} t={t} />}
            </>
          )}
          {voice.provider === 'browser' && (
            <div className="qt-browser">
              <BrowserVoices voice={voice} save={saveVoice} />
              <span data-peek-keep>
                <TestButton t={t} />
              </span>
            </div>
          )}
          <Speed voice={voice} save={saveVoice} />
        </>
      )}
      <label className="toggle qt-row">
        <input type="checkbox" checked={voice.agentsSpeak} onChange={(e) => saveVoice({ agentsSpeak: e.target.checked })} /> <Icon name="users" /> Agents' own voices
      </label>
      <div className="qt-row qt-key">
        <Icon name="key-round" />
        {keySet ? (
          <span className="grow">
            ElevenLabs key saved <code>••••{hint}</code>
          </span>
        ) : (
          <>
            <span className="grow">No ElevenLabs key</span>
            <button type="button" className="btn btn-small" onClick={toSettings}>
              Add key
            </button>
          </>
        )}
      </div>
      {keySet && use && <span className="qt-name small">{use}</span>}
    </div>
  );
}
