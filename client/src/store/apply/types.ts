// What an area's handlers get (#257): each ServerEvent type has one handler, in its area's file (index.ts lists them).
import type { ServerEvent, WorldSnapshot } from '../../../../shared/types';
import type { State } from '../../store';

export interface ApplyCtx {
  set(partial: Partial<State>): void;
  get(): State;
  /** The change is shown: after the first snapshot, and not while the time-lapse seeks. */
  live: boolean;
  /** Sounds and voice may play: live, and not a replay. */
  cues: boolean;
  /** The time-lapse's: 'play' shows it (gong and confetti, no cues, toasts or voice), 'seek' only moves the state. */
  replay?: 'play' | 'seek';
}

/** The events applied one by one: not the snapshot, nor the heartbeat (net.ts drops it). */
export type Live = Exclude<ServerEvent['type'], 'snapshot' | 'beat'>;

export type Handler<K extends Live> = (ev: Extract<ServerEvent, { type: K }>, c: ApplyCtx) => void;

/** An area's handlers: written `{ … } satisfies ApplyHandlers`, so index.ts can check every event has one. */
export type ApplyHandlers = { [K in Live]?: Handler<K> };

/** An area's share of the state a snapshot (page load, reconnect) replaces. */
export type SnapshotPart = (d: WorldSnapshot, c: ApplyCtx) => Partial<State>;
