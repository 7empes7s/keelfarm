// The call's captions as every screen shows them (the call window, the meeting room's wall screen and its live view in
// the window, #369): who's on the call, how it's going and the line being said.
import { CEO_ID } from '../../../shared/types';
import { messageSpeech } from '../../../shared/speech';
import { useStore } from '../store';
import { callStatus, captionLine, splitSentences } from './voiceCall';
import { useCall } from './voiceCallStore';

/** The CEO's name, the call's status and the captions' line ('' when nobody is saying anything). */
export function useCallCaptions() {
  const { call, heard } = useCall();
  const ceo = useStore((s) => s.agents[CEO_ID]?.name ?? 'CEO');
  const message = useStore((s) => (call.reply ? s.messages.find((m) => m.id === call.reply!.id) : undefined));
  const saying = message && call.reply ? (splitSentences(messageSpeech(message))[call.reply.sentence] ?? '') : '';
  return { ceo, status: callStatus(call, ceo), line: captionLine(call, ceo, saying, heard) };
}
