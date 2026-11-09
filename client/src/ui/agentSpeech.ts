// A clicked agent says one short line in their own voice (#321): E or a click on them in 3D, a tap on them in the team
// list or their window's header. The server picks the line from the office's state (shared/agentLines.ts) and makes
// the clip with ElevenLabs, cached; in 3D it plays from their head with their speech bubble, elsewhere straight out.
// The demo, without a key, uses the browser's voice. When nobody would say it (lineVoice), callers babble as before.
import { useSyncExternalStore } from 'react';
import { lineVoice } from '../../../shared/agentLines';
import { useStore } from '../store';
import { captionSaid } from './captions';
import { holdMusicDuck } from './music';
import { audio, getAudioPrefs, sample, subscribeAudio, type Vec3 } from './sfx';
import { playClip, speakLine } from './voicePlayback';

/** How loud a line is at a metre or so: a person talking, a little under the CEO's messages. */
const LINE_PEAK = 0.8;

/** Agents whose line is still playing (performance.now() ms when it ends): a second click doesn't talk over it. */
const talking = new Map<string, number>();

/** Who would say a clicked agent's line in this tab now (null: nobody, they babble). */
export function lineVoiceNow() {
  const s = useStore.getState();
  const v = s.settings.voice;
  return lineVoice({ agentsSpeak: v.agentsSpeak, provider: v.provider, keySet: s.voiceKeySet, demo: s.demo, muted: getAudioPrefs().muted, replaying: s.replaying, reading: s.voiceSpeaking !== null });
}

/** Whether a tap on someone's avatar says their line here (a phone message being read aloud aside), for showing it as a button. */
export function useLineVoice(): boolean {
  const v = useStore((s) => s.settings.voice);
  const keySet = useStore((s) => s.voiceKeySet);
  const demo = useStore((s) => s.demo);
  const replaying = useStore((s) => s.replaying);
  const muted = useSyncExternalStore(subscribeAudio, () => getAudioPrefs().muted);
  return !!lineVoice({ agentsSpeak: v.agentsSpeak, provider: v.provider, keySet, demo, muted, replaying, reading: false });
}

/**
 * Plays a clip from `pos` through the office's mixer (the voice group), or straight out when there's no 3D audio.
 * Resolves how long it plays, or null when the line may no longer be said once it's decoded (`stillOn`).
 */
async function playFrom(blob: Blob, pos: Vec3 | null, name: string, stillOn: () => boolean): Promise<number | null> {
  const a = pos ? audio() : null;
  if (a && pos) {
    const buffer = await a.ctx.decodeAudioData(await blob.arrayBuffer());
    if (!stillOn()) return null;
    sample({ name: `line:${name}`, group: 'voice', pos, buffer, peak: LINE_PEAK });
    const unduck = holdMusicDuck();
    setTimeout(unduck, buffer.duration * 1000);
    return buffer.duration * 1000;
  }
  const start = performance.now();
  await playClip(blob);
  return performance.now() - start;
}

/**
 * Says `id`'s line now. `place` (3D) puts up their bubble with the words and says where their head is. Resolves false
 * when nobody would say it or it couldn't be had, so the caller can babble instead. When the CEO starts talking, a
 * replay starts or sound goes off while the line is on its way, it's dropped quietly (true: no babble either).
 */
export async function speakAgent(id: string, place?: (text: string) => Vec3 | null): Promise<boolean> {
  const how = lineVoiceNow();
  const a = useStore.getState().agents[id];
  if (!how || !a) return false;
  if ((talking.get(id) ?? 0) > performance.now()) return true;
  talking.set(id, performance.now() + 2000); // until the line is in
  const stillOn = () => lineVoiceNow() === how;
  const drop = () => {
    talking.delete(id);
    return true;
  };
  try {
    const r = await fetch(`/api/voice/lines/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hour: new Date().getHours() }) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const { text, clip } = (await r.json()) as { text: string; clip: boolean };
    if (!stillOn()) return drop();
    const eleven = how === 'elevenlabs' && clip;
    if (!eleven && how !== 'browser') throw new Error('no voice'); // the key stopped working meanwhile: babble
    const blob = eleven ? await fetch(`/api/voice/lines/${encodeURIComponent(id)}`).then((x) => (x.ok ? x.blob() : Promise.reject(new Error(`HTTP ${x.status}`)))) : null;
    if (!stillOn()) return drop();
    const pos = place?.(text) ?? null;
    captionSaid(a.name, text);
    if (blob) {
      const ms = await playFrom(blob, pos, a.name, stillOn);
      if (ms === null) return drop();
      talking.set(id, performance.now() + ms);
    } else {
      const v = useStore.getState().settings.voice;
      void speakLine(text, v.provider === 'browser' ? v.voiceName : '', v.speed).finally(() => talking.delete(id));
      talking.set(id, performance.now() + 6000);
    }
    return true;
  } catch {
    talking.delete(id);
    return false;
  }
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__swarmLines = {
    /** Who says clicked agents' lines here now: 'elevenlabs', 'browser' or null (they babble). */
    get voice() {
      return lineVoiceNow();
    },
    speak: (id: string) => speakAgent(id),
  };
}
