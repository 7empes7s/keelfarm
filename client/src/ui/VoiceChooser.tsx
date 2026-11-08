// One ElevenLabs voice picker for Settings → Voice and every profile (#320): search, favourites (the star) first, then
// the Eleven v4 voices, the shortlist and the rest, each with a preview. Favourites are saved in settings.voice as ids.
// Without ElevenLabs on and a key, the profiles show a short note and a way to Settings → Voice instead. Previews are
// fetched ahead of a tap (#279): a short intro while the first five get ready, then the rest in the background.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { VoiceOption, VoiceSettings } from '../../../shared/types';
import { groupVoices, toggleFavourite } from '../../../shared/voices';
import { Icon } from './Icon';
import { getAudioPrefs } from './sfx';
import { keyName } from './controls';
import { searchVoices, voiceLabels } from './voicePicker';
import { playClip, stopVoice } from './voicePlayback';
import { previews, usePreviews } from './voicePreload';
import { introLine, introOver, WARM_CAP_MS, WARM_FIRST, warmFirst, warmKey, warmRest, type WarmState } from './voiceWarm';

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

const keyOf = (v: VoiceOption, s: VoiceSettings) => warmKey(v, s.model, s.speed);

/** Plays `v`'s preview (or the test line in it, at the office's speed), or stops it when it's the one playing. */
async function previewVoice(v: VoiceOption, key: string, playing: Playing, setPlaying: (p: Playing) => void) {
  if (playing === v.id) return stopVoice();
  hintMuted();
  setPlaying(v.id);
  try {
    // Library voices may have no preview of their own: then it's the test line, made once and cached. A clip warmed
    // ahead plays at once.
    const ok = await playClip(await previews.now(key));
    if (!ok) useStore.getState().pushToast('error', `Couldn't play ${v.name}'s preview`);
  } catch (err) {
    useStore.getState().pushToast('error', err instanceof Error ? err.message : `Couldn't load ${v.name}'s preview`);
  } finally {
    setPlaying(null);
  }
}

const WARM_TITLE: Record<WarmState, string> = { loading: 'Getting the preview ready', ready: 'Preview ready', failed: "The preview didn't load: Preview tries again" };

function VoiceRow({ v, group, chosen, fav, playing, warm, onChoose, onFav, onPreview }: { v: VoiceOption; group: string; chosen: boolean; fav: boolean; playing: boolean; warm: WarmState | undefined; onChoose: () => void; onFav: () => void; onPreview: () => void }) {
  const labels = voiceLabels(v);
  return (
    <div className={`voice-row ${chosen ? 'voice-row-on' : ''}`} data-voice={v.id} data-warm={warm}>
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
      <span className="voice-warm" title={warm && WARM_TITLE[warm]} aria-hidden="true" />
      <button type="button" className="ds-btn ds-btn-ghost ds-btn-icon" aria-label={playing ? `Stop the preview of ${v.name}` : `Preview ${v.name}`} title={v.previewUrl ? undefined : 'Says the test line in this voice'} onClick={onPreview}>
        <Icon name={playing ? 'square' : 'play'} />
      </button>
    </div>
  );
}

/** The short motion while the first previews get ready (a still bar under reduced motion), and a way past it. */
function VoiceIntro({ ready, total, onSkip }: { ready: number; total: number; onSkip: () => void }) {
  const line = introLine(ready, total);
  return (
    <div className="voice-intro" role="status" aria-label={line}>
      <div className="voice-intro-wave" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <span key={i} style={{ animationDelay: `${i * 90}ms` }} />
        ))}
      </div>
      <div className="voice-intro-bar" aria-hidden="true">
        <span style={{ width: `${total ? (100 * ready) / total : 0}%` }} />
      </div>
      <span className="small">{line}</span>
      <button type="button" className="btn btn-small btn-ghost" onClick={onSkip}>
        Show the voices now
      </button>
    </div>
  );
}

/** Getting the first previews ready, then the rest a few at a time, rows on screen first; paused when the picker closes. */
function useWarmPreviews(list: VoiceOption[] | null | 'failed', chosen: string, listRef: RefObject<HTMLDivElement | null>, query: string) {
  usePreviews();
  const voice = useStore((s) => s.settings.voice);
  const [skipped, setSkipped] = useState(false);
  const [capped, setCapped] = useState(false);
  const [shown, setShown] = useState(false);
  const loaded = Array.isArray(list) ? list : null;
  const first = loaded ? warmFirst(loaded, voice.favourites, chosen).map((v) => keyOf(v, voice)) : [];
  const done = first.filter((k) => previews.state(k) === 'ready' || previews.state(k) === 'failed').length;
  const over = shown || list === 'failed' || (!!loaded && !first.length) || introOver(done, first.length, capped ? WARM_CAP_MS : 0, skipped);
  useEffect(() => {
    const t = setTimeout(() => setCapped(true), WARM_CAP_MS);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (over && loaded) setShown(true); // once shown, the list stays
  }, [over, loaded]);
  useEffect(() => () => previews.pause(), []);
  // The first five, then the rest in the list's order (only what's free or shortlisted), and rows coming into view first.
  const order = loaded ? groupVoices(loaded, voice.favourites) : null;
  const flat = order ? [...order.favourites, ...order.latest, ...order.recommended, ...order.others] : [];
  const signature = `${flat.map((v) => v.id).join()}|${voice.model}|${voice.speed}|${voice.favourites.join()}|${chosen}`;
  useEffect(() => {
    if (!flat.length) return;
    previews.want([...first, ...warmRest(flat, voice.favourites, chosen, new Set()).map((v) => keyOf(v, voice))]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the signature names everything that changes the order
  }, [signature]);
  useEffect(() => {
    const root = listRef.current;
    if (!over || !root || !flat.length || typeof IntersectionObserver === 'undefined') return;
    const byId = new Map(flat.map((v) => [v.id, v]));
    const seen = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.voice ?? '';
          if (e.isIntersecting) seen.add(id);
          else seen.delete(id);
        }
        const visible = [...seen].flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
        previews.want(visible.map((v) => keyOf(v, voice)), true);
      },
      { root },
    );
    for (const row of root.querySelectorAll<HTMLElement>('.voice-row')) io.observe(row);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-observed when the rows change
  }, [over, signature, listRef, query]);
  return { over, ready: done, total: first.length || WARM_FIRST, skip: () => setSkipped(true) };
}

/**
 * The picker: `chosen` is the voice id in use, `onChoose` saves another. `name` tells its radio group apart from any
 * other picker on the screen. Shows the list from useVoiceList, so pass it in when the caller needs it too (Shuffle).
 */
export function VoicePicker({ list, chosen, onChoose, name, playing, setPlaying }: { list: VoiceOption[] | null | 'failed'; chosen: string; onChoose: (v: VoiceOption) => void; name: string; playing: Playing; setPlaying: (p: Playing) => void }) {
  const voice = useStore((s) => s.settings.voice);
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const warm = useWarmPreviews(list, chosen, listRef, query);
  // Show the chosen voice when the list arrives, even when it's far down.
  useEffect(() => {
    const el = listRef.current;
    const row = el?.querySelector<HTMLElement>('.voice-row-on');
    if (el && row) el.scrollTop = row.offsetTop - el.clientHeight / 2 + row.offsetHeight / 2;
  }, [list, warm.over]);
  if (list === 'failed') return <p className="muted small">Couldn't load the voices.</p>;
  if (!warm.over) return <VoiceIntro ready={warm.ready} total={warm.total} onSkip={warm.skip} />;
  if (!list) return <p className="muted small">Loading the voices…</p>;
  const hits = searchVoices(list, query);
  const g = groupVoices([...hits.recommended, ...hits.others], voice.favourites);
  const fav = (v: VoiceOption) => void api.updateSettings({ voice: { ...voice, favourites: toggleFavourite(voice.favourites, v.id) } }).catch(() => undefined);
  const row = (v: VoiceOption) => {
    const key = keyOf(v, voice);
    return (
      <VoiceRow key={v.id} v={v} group={name} chosen={chosen === v.id} fav={voice.favourites.includes(v.id)} playing={playing === v.id} warm={previews.state(key)} onChoose={() => onChoose(v)} onFav={() => fav(v)} onPreview={() => void previewVoice(v, key, playing, setPlaying)} />
    );
  };
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
