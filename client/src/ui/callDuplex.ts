// Half duplex on a Jarvis call (#694): the voice's own sound from the speaker is never transcribed, because nothing
// listens while it plays and for TAIL_MS after (a room's echo and a recognizer's late words), and the manager still
// cuts in: their voice's energy over the voice's own (BargeMeter) stops it at once. Pure.

/** The listener stays deaf this long after the voice's last sound. */
export const TAIL_MS = 400;
/** The mic's RMS (0..1) from which a voice can be the manager's. */
const BARGE_LEVEL = 0.03;
/** The mic must be this much louder than what the voice played lately: its echo alone never is. */
const ECHO_RATIO = 1.6;
/** Loud for this long (ms, net of quiet blocks) is the manager talking. */
const BARGE_HOLD_MS = 120;
/** What the voice played over this window (ms) counts as its echo now: the speaker-to-mic path lags. */
const ECHO_WINDOW_MS = 250;

/** Whether the call's listener must not hear now: the voice is playing, or stopped by itself under TAIL_MS ago. */
export const deafNow = (playing: boolean, endedAt: number, now: number) => playing || now - endedAt < TAIL_MS;

/** The manager's voice over the voice's own: fed every mic block while the voice plays. */
export class BargeMeter {
  private loud = 0;
  private outs: { at: number; rms: number }[] = [];

  /** One mic block (`mic` RMS) and the voice's output RMS now, `ms` long at `now`: true once it's the manager talking. */
  push(mic: number, out: number, ms: number, now: number): boolean {
    this.outs = [...this.outs.filter((o) => now - o.at <= ECHO_WINDOW_MS), { at: now, rms: out }];
    const echo = Math.max(...this.outs.map((o) => o.rms));
    if (mic >= BARGE_LEVEL && mic >= echo * ECHO_RATIO) this.loud += ms;
    else this.loud = Math.max(0, this.loud - ms / 2);
    if (this.loud < BARGE_HOLD_MS) return false;
    this.reset();
    return true;
  }

  reset() {
    this.loud = 0;
    this.outs = [];
  }
}

/** A block's loudness (RMS, 0..1). */
export function rms(samples: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}
