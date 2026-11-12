// The Jarvis voice's app-level state (#534), apart from its engine (agentCallEngine.ts, loaded on a call) so the store
// and the call screens can ask "is ElevenLabs talking?" without loading it. Also the call's audio, made in the tap
// that starts the call: iPhones only let sound start from a tap, and set the audio session for talking both ways.
import { create } from 'zustand';
import type { SwarmSettings } from '../../../shared/types';
import { agentWhy, DEFAULT_VOICE_AGENT, type VoiceAgentView } from '../../../shared/voiceAgent';
import type { AgentMode } from './agentCall';

export interface AgentCallView {
  mode: AgentMode;
  /** The agent's latest reply, for the captions. */
  saying: string;
  /** The mic's and the voice's levels (0..1), for the orb. */
  input: number;
  output: number;
}

export const useAgentCall = create<AgentCallView>(() => ({ mode: 'off', saying: '', input: 0, output: 0 }));

/** The Jarvis voice drives the call now. */
export const agentOn = () => useAgentCall.getState().mode !== 'off';

/** Why a call now would use today's voice mode instead ('' when it would be the Jarvis voice), from the store's state (not imported: the store imports this). */
export function agentCallWhy(st: { settings: SwarmSettings; voiceKeySet: boolean; voiceAgent: VoiceAgentView }): string {
  return agentWhy({ settings: st.settings.voice.agent ?? DEFAULT_VOICE_AGENT, keySet: st.voiceKeySet, officeUrl: st.settings.notify?.officeUrl ?? '', minutesMonth: st.voiceAgent.minutesMonth, fake: st.voiceAgent.fake });
}

let ctx: AudioContext | null = null;

/** The call's audio context, made (or woken) inside the tap that starts or resumes the call. */
export function callAudio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
    const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'play-and-record'; // Safari 16.4+: talking and listening at once, not the earpiece-quiet default
  } catch {
    ctx = null;
  }
  return ctx;
}

/** The call is over: the audio session back to normal playback. */
export function releaseCallAudio() {
  const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
  if (session) session.type = 'auto';
}

type Relay = (kind: 'msg' | 'line', id: number) => void;
let relay: Relay | null = null;

/** The engine takes the CEO's messages and progress lines while it's live. */
export function onAgentRelay(fn: Relay | null) {
  relay = fn;
}

/** Hands a CEO message or progress line to the Jarvis voice to say; false when it isn't live (today's voice reads it). */
export function agentRelay(kind: 'msg' | 'line', id: number): boolean {
  if (useAgentCall.getState().mode !== 'live' || !relay) return false;
  relay(kind, id);
  return true;
}
