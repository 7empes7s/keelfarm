// One ElevenLabs voice picker for Settings → Voice and every profile (#320): search, favourites (the star) first, then
// the Eleven v4 voices, the shortlist and the rest, each with a preview. Favourites are saved in settings.voice as ids.
// Without ElevenLabs on and a key, the profiles show a short note and a way to Settings → Voice instead.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { VoiceOption } from '../../../shared/types';
import { groupVoices, toggleFavourite } from '../../../shared/voices';
import { Icon } from './Icon';
import { getAudioPrefs } from './sfx';
import { keyName } from './controls';
import { searchVoices, voiceLabels } from './voicePicker';
import { playClip, stopVoice } from './voicePlayback';

/** What's playing: a voice's preview (its id), the Test line, or nothing. */
export type Playing = string | null;

export function hintMuted() {
  if (getAudioPrefs().muted) useStore.getState().pushToast('info', `Sound is off: press ${keyName('mute')} to hear it`);
}

/** The voice list from the manager's key (cached on the server for 10 minutes); null while loading, 'failed' on error. */
export function useVoiceList(): VoiceOption[] | null | 'failed' {
  const hint = useStore((s) => s.voiceKeyHint);
  const [list, setList] = useState<VoiceOption[] | null | 'failed'>(null);
  useEffect(() => {
    let live = true;
    setList(null);
    api.voices().then(
      (l) => live && setList(l),
      () => live && setList('failed'),
    );
    return () => {
      live = false;
    };
  }, [hint]);
  return list;
}

/** ElevenLabs is speaking and has a key: the pickers can show. */
export const useElevenLabsReady = () => useStore((s) => s.settings.voice.provider === 'elevenlabs' && s.voiceKeySet);

/** Why a profile shows no picker, and the way to Settings → Voice. */
export function VoiceGate() {
  return (
    <p className="muted small voice-gate">
      Voices need ElevenLabs and its key.{' '}
      <button type="button" className="btn btn-small btn-ghost" onClick={() => useStore.getState().openOverlay({ kind: 'manager', tab: 'voice' })}>
        <Icon name="settings" /> Settings → Voice
      </button>
    </p>
  );
}

/** Plays `v`'s preview (or the test line in it, at the office's speed), or stops it when it's the one playing. */
async function previewVoice(v: VoiceOption, playing: Playing, setPlaying: (p: Playing) => void) {
  if (playing === v.id) return stopVoice();
  hintMuted();
  setPlaying(v.id);
  try {
    // Library voices may have no preview of their own: then it's the test line, made once and cached.
    const ok = await playClip(v.previewUrl ?? (await api.voiceSample(v.id)));
    if (!ok) useStore.getState().pushToast('error', `Couldn't play ${v.name}'s preview`);
  } catch {
    // api already toasted the error
  } finally {
    setPlaying(null);
  }
}

function VoiceRow({ v, group, chosen, fav, playing, onChoose, onFav, onPreview }: { v: VoiceOption; group: string; chosen: boolean; fav: boolean; playing: boolean; onChoose: () => void; onFav: () => void; onPreview: () => void }) {
  const labels = voiceLabels(v);
  return (
    <div className={`voice-row ${chosen ? 'voice-row-on' : ''}`}>
      <label className="toggle grow">
        <input type="radio" name={group} checked={chosen} onChange={onChoose} />
        <span>
          <b>{v.name}</b>
          {v.labels?.description && <span className="muted"> · {v.labels.description}</span>}
          {labels && <span className="muted small voice-labels">{labels}</span>}
        </span>
      </label>
      <button type="button" className={`ds-btn ds-btn-ghost ds-btn-icon ${fav ? 'voice-fav-on' : ''}`} aria-pressed={fav} aria-label={fav ? `Remove ${v.name} from favourites` : `Add ${v.name} to favourites`} onClick={onFav}>
        <Icon name="star" />
      </button>
      <button type="button" className="ds-btn ds-btn-ghost ds-btn-icon" aria-label={playing ? `Stop the preview of ${v.name}` : `Preview ${v.name}`} title={v.previewUrl ? undefined : 'Says the test line in this voice'} onClick={onPreview}>
        <Icon name={playing ? 'square' : 'play'} />
      </button>
    </div>
  );
}

/**
 * The picker: `chosen` is the voice id in use, `onChoose` saves another. `name` tells its radio group apart from any
 * other picker on the screen. Shows the list from useVoiceList, so pass it in when the caller needs it too (Shuffle).
 */
export function VoicePicker({ list, chosen, onChoose, name, playing, setPlaying }: { list: VoiceOption[] | null | 'failed'; chosen: string; onChoose: (v: VoiceOption) => void; name: string; playing: Playing; setPlaying: (p: Playing) => void }) {
  const voice = useStore((s) => s.settings.voice);
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  // Show the chosen voice when the list arrives, even when it's far down.
  useEffect(() => {
    const el = listRef.current;
    const row = el?.querySelector<HTMLElement>('.voice-row-on');
    if (el && row) el.scrollTop = row.offsetTop - el.clientHeight / 2 + row.offsetHeight / 2;
  }, [list]);
  if (list === 'failed') return <p className="muted small">Couldn't load the voices.</p>;
  if (!list) return <p className="muted small">Loading the voices…</p>;
  const hits = searchVoices(list, query);
  const g = groupVoices([...hits.recommended, ...hits.others], voice.favourites);
  const fav = (v: VoiceOption) => void api.updateSettings({ voice: { ...voice, favourites: toggleFavourite(voice.favourites, v.id) } }).catch(() => undefined);
  const row = (v: VoiceOption) => (
    <VoiceRow key={v.id} v={v} group={name} chosen={chosen === v.id} fav={voice.favourites.includes(v.id)} playing={playing === v.id} onChoose={() => onChoose(v)} onFav={() => fav(v)} onPreview={() => void previewVoice(v, playing, setPlaying)} />
  );
  const groups: [VoiceOption[], string, ReactNode][] = [
    [g.favourites, 'Favourites', <Icon key="i" name="star" />],
    [g.latest, 'Newest (Eleven v4)', <Icon key="i" name="sparkles" />],
    [g.recommended, 'Recommended', null],
    [g.others, 'All voices', null],
  ];
  return (
    <>
      <input type="search" className="voice-search" aria-label="Search voices" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, accent, age…" />
      <div ref={listRef} className="voice-list" role="radiogroup" aria-label="ElevenLabs voices">
        {groups.map(([vs, label, icon]) =>
          vs.length ? (
            <div key={label} role="presentation">
              <div className="voice-group">
                {icon} {label}
              </div>
              {vs.map(row)}
            </div>
          ) : null,
        )}
        {hits.recommended.length + hits.others.length === 0 && <div className="muted small">No voice matches “{query}”.</div>}
      </div>
    </>
  );
}
