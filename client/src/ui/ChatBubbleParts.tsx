import { useStore } from '../store';
import type { Delivery, PhoneMessage } from '../../../shared/types';
import { DELIVERY_LABEL } from '../../../shared/chat';
import { replayKind } from './voiceQueue';
import type { Item } from './ChatActions';

// The small parts of a chat bubble (ui/Phone.tsx): the ▶ replay, the delivery tick, and the hover buttons.

/** Replays a CEO message from its saved clip (or the browser's voice); stops it while it plays. */
export function ReplayButton({ m }: { m: PhoneMessage }) {
  const saved = useStore((s) => s.voiceCache.saved.includes(m.id));
  const playing = useStore((s) => s.voiceSpeaking === m.id);
  const kind = replayKind(m, saved, typeof speechSynthesis !== 'undefined');
  if (!kind) return null;
  const gone = kind === 'gone';
  return (
    <button
      type="button"
      className={`bubble-play ${playing ? 'bubble-play-on' : ''}`}
      disabled={gone && !playing}
      title={gone ? 'Audio no longer saved' : undefined}
      aria-label={playing ? 'Stop this message' : 'Play this message'}
      onClick={() => void import('./voiceMessages').then((v) => (playing ? v.stopSpeaking() : kind !== 'gone' && v.replayMessage(m, kind)))}
    >
      {playing ? '⏹' : '▶'}
    </button>
  );
}

export function DeliveryTick({ d }: { d: Delivery }) {
  const icon = { sending: '🕓', sent: '✓', read: '✓✓', replied: '↩', failed: '⚠' }[d];
  return (
    <span className={`bubble-tick bubble-tick-${d}`} title={DELIVERY_LABEL[d]}>
      <span aria-hidden>{icon}</span>
      <span className="sr-only">{DELIVERY_LABEL[d]}</span>
    </span>
  );
}

/** The hover (and keyboard) buttons by a bubble: Reply, and the actions menu. */
export function BubbleTools({ id, item, onReply, onActions }: { id: number | undefined; item: Item; onReply: (id: number) => void; onActions: (item: Item) => void }) {
  return (
    <div className="bubble-tools">
      {id !== undefined && (
        <button type="button" className="bubble-tool" aria-label="Reply to this message" title="Reply" onClick={() => onReply(id)}>
          ↩
        </button>
      )}
      {item.m?.from === 'ceo' && (
        <button type="button" className="bubble-tool" aria-label="React to this message" aria-haspopup="dialog" title="React" onClick={() => onActions(item)}>
          ☺
        </button>
      )}
      <button type="button" className="bubble-tool" aria-label="Message actions" aria-haspopup="dialog" title="More" onClick={() => onActions(item)}>
        ⋯
      </button>
    </div>
  );
}
