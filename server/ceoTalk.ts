// The CEO talking while it works (#286): the instant ack of a manager's message mid-job, and progress lines from its
// steps, sent to the tabs as `voiceLine` events (never chat messages). The words and pacing are shared/voiceTalk.ts's.
import { currentStep, type CeoLive } from '../shared/ceoStream.ts';
import type { VoiceLine } from '../shared/types.ts';
import { pickAck, progressCue, talkStart, TALK_PACE, type TalkPace, type TalkState } from '../shared/voiceTalk.ts';

export class CeoTalk {
  private lastAckAt = -Infinity;
  private acks = 0;
  private seq = Date.now(); // ids stay new across restarts, so a tab never takes a fresh line for one it heard
  private job: TalkState | null = null;

  /** `on`: the CEO has a voice (Settings → Voice); `say`: sends a line to the tabs. */
  constructor(
    private readonly on: () => boolean,
    private readonly say: (line: VoiceLine) => void,
    private readonly pace: TalkPace = TALK_PACE,
  ) {}

  /** A CEO job starts: its first regular line comes a window from now. */
  started(now: number) {
    this.job = talkStart(now);
  }

  ended() {
    this.job = null;
  }

  /** The manager's message found the CEO mid-job: a short ack, unless one was said moments ago. */
  ack(now: number) {
    if (!this.on()) return;
    const text = pickAck(this.lastAckAt, now, this.acks);
    if (!text) return;
    this.lastAckAt = now;
    this.acks++;
    this.emit({ kind: 'ack', text }, now);
  }

  /** The job's steps moved on: a milestone, or a regular line when the window is up. */
  steps(live: CeoLive | null, now: number) {
    if (!this.job || !live || !this.on()) return;
    const cue = progressCue(this.job, currentStep(live), live.stepCount, now, this.pace);
    if (!cue) return;
    this.job = cue.state;
    this.emit({ kind: 'progress', text: cue.text, milestone: cue.milestone }, now);
  }

  private emit(line: Pick<VoiceLine, 'kind' | 'text' | 'milestone'>, now: number) {
    this.say({ id: ++this.seq, ...line, at: now });
  }
}
