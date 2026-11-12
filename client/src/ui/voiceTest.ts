// Settings → Voice's Test with ElevenLabs (#545). Phones only let sound start from a tap, and the Test line arrives
// after a fetch, outside it: so the tap first unlocks the one <audio> element replays use (voiceTap.ts) and the line
// plays on that element. Anything that goes wrong comes back in plain words for the Test to show.
import { api } from '../api';
import { playClip } from './voicePlayback';
import { primeVoice } from './voiceTap';

/** Call inside the tap. Resolves null once the Test line in `voiceId` has played (or was stopped), else why it didn't. */
export async function testElevenLabs(voiceId: string): Promise<string | null> {
  const el = primeVoice();
  let clip: Blob;
  try {
    clip = await api.voiceSample(voiceId);
  } catch (err) {
    const e = err as Error;
    return `Couldn't make the test: ${e.name === 'TypeError' ? "the office didn't answer" : e.message}`;
  }
  return (await playClip(clip, el)) ? null : "Couldn't play the test: the browser blocked the sound. Tap Test again, and check the phone isn't on silent.";
}
