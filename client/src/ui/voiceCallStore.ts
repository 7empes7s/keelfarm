// The voice call's app-level state (voiceCall.ts's machine), apart from the chat and every screen, so nothing shown
// over the call can reset it. The store (toasts, cues), the voice (voiceMessages.ts) and the engine
// (voiceCallEngine.ts) all go through dispatchCall; it imports nothing of theirs, so none of them import in a circle.
import { create } from 'zustand';
import type { VoiceSettings } from '../../../shared/types';
import { callStep, inCall, NO_CALL, type Call, type CallEvent, type CallStep, type HeldNote } from './voiceCall';

export interface CallView {
  call: Call;
  /** What the mic heard of your turn so far, for the captions. */
  heard: string;
  managerSpeaking: boolean;
  /** The phone's call screen is folded to the pill at the top; the desktop orb is closed to its bubble. */
  minimised: boolean;
  captions: boolean;
  /** The CEO's voice at full volume (on) or quieter, like a phone's earpiece (off). */
  speaker: boolean;
  /** Pocket mode's docked chat (desktop) is hidden behind the call, until it ends or you open the chat. */
  chatTucked: boolean;
}

export const useCall = create<CallView>(() => ({ call: NO_CALL, heard: '', managerSpeaking: false, minimised: false, captions: true, speaker: true, chatTucked: false }));

let onStep: ((step: CallStep, ev: CallEvent) => void) | null = null;

/** The engine runs each step's effects. */
export function onCallStep(fn: typeof onStep) {
  onStep = fn;
}

export function dispatchCall(ev: CallEvent): CallStep {
  const step = callStep(useCall.getState().call, ev);
  if (step.call !== useCall.getState().call) useCall.setState({ call: step.call });
  onStep?.(step, ev);
  return step;
}

/** A call is on. */
export const callOn = () => inCall(useCall.getState().call);

/** The voice a message is read in: a call speaks even with Speak messages off, in the browser's voice then. */
export const callVoice = (v: VoiceSettings): VoiceSettings => (callOn() && v.provider === 'off' ? { ...v, provider: 'browser' } : v);

/** The office's automatic toast: held while a call is on (true), else for the caller to show (false). */
export function holdNote(note: HeldNote): boolean {
  if (!callOn()) return false;
  dispatchCall({ type: 'note', note });
  return true;
}
