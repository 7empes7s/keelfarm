// An agent's camera (#539): who's on camera, since when, what they say as it comes on, and the voice level a fake or
// demo voice feeds the mouth (QA's `__swarmAgentCam.level`). Off by default; one camera at a time; nothing here is sent
// anywhere: turning it on or off, or a refusal, never reaches the agent or costs a token. The rules are agentCamera.ts.
import { create } from 'zustand';
import { CEO_ID } from '../../../shared/types';
import { useStore } from '../store';
import { cameraCommand, demoCamera, hello, sayMs, shyLine } from './agentCamera';

export interface CamView {
  /** The agent on camera, or null. */
  agent: string | null;
  since: number;
  /** The line on the tile (the greeting) and until when it's said. */
  saying: string;
  sayUntil: number;
  /** A voice level set from outside (QA's fake audio), or null to follow the call's voice. */
  level: number | null;
}

export const useCamera = create<CamView>(() => ({ agent: null, since: 0, saying: '', sayUntil: 0, level: null }));

/** What the tile drew last, for QA: its mouth's opening and frames drawn. */
export const camProbe = { mouth: 0, frames: 0 };

/** When each agent last refused, so a second ask turns the camera on. */
const refused = new Map<string, number>();

/** Asks `id` to turn their camera on: they do, or refuse playfully (a toast in their words) while busy. */
export function cameraOn(id: string, now = Date.now()) {
  const a = useStore.getState().agents[id];
  if (!a) return;
  const shy = shyLine(a, refused.get(id), now);
  if (shy) {
    refused.set(id, now);
    useStore.getState().pushToast('info', `${a.name}: ${shy}`);
    return;
  }
  refused.delete(id);
  const saying = hello(a.name, id === CEO_ID);
  useCamera.setState({ agent: id, since: now, saying, sayUntil: now + sayMs(saying) });
  setTimeout(() => useCamera.getState().since === now && useCamera.setState({ saying: '' }), sayMs(saying) + 2500); // the greeting's line goes once said
}

export const cameraOff = () => useCamera.setState({ agent: null, saying: '', sayUntil: 0, level: null });

/** The 📷 button: on for `id`, or off when they're already on camera. */
export const toggleCamera = (id: string) => (useCamera.getState().agent === id ? cameraOff() : cameraOn(id));

/** A message to `id` that's only a camera ask, handled here (true: don't send it on), else false. */
export function cameraWords(text: string, id: string): boolean {
  const c = cameraCommand(text);
  if (!c) return false;
  if (c === 'on') cameraOn(id);
  else if (useCamera.getState().agent === id) cameraOff();
  return true;
}

if (typeof window !== 'undefined') {
  // the demo's `?camera=<id>`: on once the office's snapshot is in
  const want = demoCamera(window.location.search, true);
  if (want) {
    const stop = useStore.subscribe((s) => {
      if (!s.loaded) return;
      stop();
      if (demoCamera(window.location.search, s.demo) && s.agents[want]) cameraOn(want);
    });
  }

  (window as unknown as Record<string, unknown>).__swarmAgentCam = {
    get state() {
      return useCamera.getState();
    },
    get mouth() {
      return camProbe.mouth;
    },
    get frames() {
      return camProbe.frames;
    },
    on: (id: string) => cameraOn(id),
    off: cameraOff,
    /** A fake voice level (0..1) for the mouth, or null to follow the call's own voice. */
    level: (v: number | null) => useCamera.setState({ level: v }),
  };
}
