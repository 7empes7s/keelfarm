// The voice pickers' preview clips, fetched ahead of a tap (#279): one queue for the tab, so a clip loaded in Settings
// plays at once in a profile too. A clip is a blob URL kept for the tab's life; the office makes each test line once.
import { useSyncExternalStore } from 'react';
import { WarmQueue } from './voiceWarm';

const AUDIO_READY_MS = 15_000;

/** Where a CDN preview won't let the page read it (CORS), the browser still caches it: preload it and play the URL. */
function preloadAudio(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const el = new Audio();
    const t = setTimeout(() => reject(new Error('The preview took too long to load')), AUDIO_READY_MS);
    el.preload = 'auto';
    el.oncanplaythrough = () => (clearTimeout(t), resolve(url));
    el.onerror = () => (clearTimeout(t), reject(new Error("Couldn't load the preview")));
    el.src = url;
    el.load();
  });
}

async function blobUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `${res.status} ${res.statusText}`);
  }
  return URL.createObjectURL(await res.blob());
}

/** A key from warmKey: a voice's own preview, or the office's test line in that voice (made once, cached on disk). */
function load(key: string): Promise<string> {
  if (key.startsWith('url:')) {
    const url = key.slice(4);
    return blobUrl(url).catch(() => preloadAudio(url));
  }
  const voiceId = key.split(':')[1];
  return blobUrl(`/api/voice/sample?voiceId=${encodeURIComponent(voiceId)}`);
}

let version = 0;
const listeners = new Set<() => void>();

export const previews = new WarmQueue(load, undefined, () => {
  version++;
  for (const l of listeners) l();
});

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Re-renders the caller whenever a preview starts or finishes loading. */
export const usePreviews = () => useSyncExternalStore(subscribe, () => version);
