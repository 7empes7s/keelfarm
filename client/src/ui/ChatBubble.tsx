import { lazy, memo, Suspense, useCallback, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useStore } from '../store';
import type { Delivery, PhoneMessage } from '../../../shared/types';
import { DELIVERY_LABEL, excerpt, messageLook } from '../../../shared/chat';
import { officeText } from '../../../shared/chatParts';
import { refParts, refsMarkdown } from '../../../shared/chatRefs';
import { RefChip } from './RefChips';
import { speechText } from '../../../shared/speech';
import { urlParts } from './chatLinks';
import { retrySend } from './chatSend';
import { Markdown } from './Markdown';
import { ArtifactCard } from './ChatArtifacts';
import { who, type Item } from './ChatActions';
import { Reactions } from './ChatReactions';
import { LongText, StepsRow } from './ChatLive';
import { replyLog, rowLog } from './chatCardRules';
import { AccountOutCard, ActionCards, CeoStuckCard, NoticeCard, NoticePill, PacingCard, UseKeyCard } from './ChatCards';
import { ProblemsDigestCard } from './ProblemsDigestCard';
import { ChecklistCard } from './ChecklistSheet';
import { CeoRunsPill } from './CeoRunsOn';
import { FileCard, UsedLine } from './ChatFiles';
import type { FileRef } from '../../../shared/files';
import { replayKind } from './voiceQueue';
import { tapReplay, tapStop, useReplay } from './voiceTap';
import { struckText } from '../../../shared/messageEdits';
import { Resume } from './TeamChanges';
import { clock } from './phoneParts';
import { isPinching, lastPinchAt } from './ChatZoom';
import { pinchCancels } from './chatPinch';
import { Icon } from './Icon';
import { SignInCard } from './SignInCard';
import { toolsInRow, toolsOffset } from './bubbleTools';
import { XLabel } from './HoverCard';
import { CeoJobLine } from './CeoJobRedo';

// One message in the chat with the CEO: its bubble, swipe to reply, long press for actions, replay and the delivery tick.

// The CEO's charts, tables and dashboards (#146): their own chunk, loaded with the first message that has one.
const ChatVisuals = lazy(() => import('./ChatVisuals'));

const canSpeak = () => typeof speechSynthesis !== 'undefined';

/**
 * Plays a CEO message (#532): its saved clip, else one made on the tap (a spinner meanwhile; tap it to cancel), or the
 * browser's voice; stops it while it plays.
 */
function ReplayButton({ m }: { m: PhoneMessage }) {
  const saved = useStore((s) => s.voiceCache.saved.includes(m.id));
  const playing = useStore((s) => s.voiceSpeaking === m.id);
  const provider = useStore((s) => s.settings.voice.provider);
  const keySet = useStore((s) => s.voiceKeySet);
  const loading = useReplay((s) => s.loading === m.id);
  const kind = replayKind(m, saved, { provider, keySet }, canSpeak());
  if (!kind) return null;
  const label = loading ? 'Getting the audio ready… Tap to cancel' : playing ? 'Stop this message' : 'Play this message';
  return (
    <>
      <button
        type="button"
        className={`bubble-play ${playing || loading ? 'bubble-play-on' : ''}`}
        aria-label={label}
        title={label}
        onClick={() => (playing || loading ? tapStop() : tapReplay(m, kind, kind === 'browser'))}
      >
        <Icon name={loading ? 'loader-circle' : playing ? 'square' : 'play'} className={loading ? 'bubble-play-spin' : undefined} />
      </button>
      {loading && <span className="bubble-play-note">Getting the audio ready…</span>}
    </>
  );
}

/** Why the ▶ couldn't play, in plain words, with Retry and the phone's own voice. */
function ReplayError({ m }: { m: PhoneMessage }) {
  const text = useReplay((s) => (s.error?.id === m.id ? s.error.text : null));
  const saved = useStore((s) => s.voiceCache.saved.includes(m.id));
  const provider = useStore((s) => s.settings.voice.provider);
  const keySet = useStore((s) => s.voiceKeySet);
  if (!text) return null;
  const kind = replayKind(m, saved, { provider, keySet }, canSpeak());
  return (
    <div className="bubble-play-error" role="alert">
      <span>{text}</span>
      <span className="bubble-play-error-actions">
        {kind && (
          <button type="button" className="btn ds-btn" onClick={() => tapReplay(m, kind, kind === 'browser')}>
            Retry
          </button>
        )}
        {kind !== 'browser' && canSpeak() && (
          <button type="button" className="btn ds-btn" onClick={() => tapReplay(m, 'browser', true)}>
            Use the phone's voice
          </button>
        )}
        <button type="button" className="btn ds-btn" aria-label="Dismiss" onClick={() => useReplay.setState({ error: null })}>
          <Icon name="x" />
        </button>
      </span>
    </div>
  );
}

const SWIPE_PX = 60;
const LONG_PRESS_MS = 500;


interface BubbleProps {
  item: Item;
  ceoName: string;
  quoted: PhoneMessage | null | 'earlier' | undefined; // undefined: not a reply; null: its original is no longer saved; earlier: not loaded yet
  highlight: boolean;
  linked: (text: string) => string;
  onFloor: (floor: number) => void;
  onQuote: (id: number) => void;
  onReply: (id: number) => void;
  onActions: (item: Item) => void;
  onArtifact: (messageId: number, artifactId: string) => void;
  onFile: (id: string) => void;
  cont?: boolean; // follows a message from the same sender (#108): drawn as one group
}


function DeliveryTick({ d }: { d: Delivery }) {
  const icon: Record<Delivery, ReactNode> = { sending: <Icon name="clock" />, sent: <Icon name="check" />, read: <Icon name="check-check" />, replied: <Icon name="reply" />, failed: <Icon name="triangle-alert" /> };
  return (
    <span className={`bubble-tick bubble-tick-${d}`} title={DELIVERY_LABEL[d]}>
      <span aria-hidden>{icon[d]}</span>
      <span className="sr-only">{DELIVERY_LABEL[d]}</span>
    </span>
  );
}

/** The hover (and keyboard) buttons by a bubble, stacked on its outer side (#289): Reply, React, and the actions menu. */
function BubbleTools({ id, item, onReply, onActions }: { id: number | undefined; item: Item; onReply: (id: number) => void; onActions: (item: Item) => void }) {
  return (
    <div className="bubble-tools">
      {id !== undefined && (
        <button type="button" className="ds-btn ds-btn-icon xbtn bubble-tool" aria-label="Reply to this message" onClick={() => onReply(id)}>
          <Icon name="reply" />
          <XLabel text="Reply" />
        </button>
      )}
      {item.m?.from === 'ceo' && (
        <button type="button" className="ds-btn ds-btn-icon xbtn bubble-tool" aria-label="React to this message" aria-haspopup="dialog" onClick={() => onActions(item)}>
          <Icon name="smile-plus" />
          <XLabel text="React" />
        </button>
      )}
      <button type="button" className="ds-btn ds-btn-icon xbtn bubble-tool" aria-label="Message actions" aria-haspopup="dialog" onClick={() => onActions(item)}>
        <Icon name="ellipsis" />
        <XLabel text="More" />
      </button>
    </div>
  );
}

/** Keep the active stack inside the log, including when a tall bubble is partly scrolled away or the log is short. */
export function placeTools(row: HTMLElement) {
  const buttons = row.querySelectorAll<HTMLElement>('.bubble-tool');
  const log = row.closest('.chat-log');
  const tools = row.querySelector<HTMLElement>('.bubble-tools');
  if (!buttons.length || !log || !tools) return;
  const first = buttons[0], last = buttons[buttons.length - 1];
  const box = log.getBoundingClientRect();
  tools.classList.remove('bubble-tools-row');
  tools.style.left = '';
  const flat = toolsInRow(last.getBoundingClientRect().bottom - first.getBoundingClientRect().top, box.height);
  tools.classList.toggle('bubble-tools-row', flat);
  const a = first.getBoundingClientRect(), b = last.getBoundingClientRect();
  const r = row.getBoundingClientRect();
  tools.style.top = `${toolsOffset(r.top, b.bottom - a.top, box, r.bottom)}px`;
  // a row runs inward over the bubble; it never leaves the log's sides (its scrollbar excluded)
  if (flat) tools.style.left = `${toolsOffset(a.left, b.right - a.left, { top: box.left, bottom: box.left + log.clientWidth })}px`;
}

// Memoised (#145): a keystroke or another message's event leaves the bubble as it is.
export const Bubble = memo(function Bubble({ item, ceoName, quoted, highlight, linked, onFloor, onQuote, onReply, onActions, onArtifact, onFile, cont }: BubbleProps) {
  const m = item.m;
  const req = useStore((s) => (m?.requestId ? s.requests.find((r) => r.id === m.requestId) : undefined));
  const [dx, setDx] = useState(0);
  const press = useRef<{ x: number; y: number; at: number; timer: number; long: boolean; swipe: boolean } | null>(null);
  const renderRef = useCallback((i: number, label: ReactNode) => m && <RefChip messageId={m.id} index={i}>{label}</RefChip>, [m]);
  const look = m ? messageLook(m) : 'bubble';
  if (look === 'hidden') return null; // the CLI's own output (#193) stays backend
  const mine = !m || m.from === 'manager';
  const text = m ? m.text : item.out!.text;
  const delivery: Delivery | undefined = m ? m.delivery : item.out!.delivery;
  const at = m ? m.at : item.out!.at;
  const id = m?.id;
  const files: FileRef[] = (m ? m.attachments : item.out!.files) ?? [];
  const log = m ? replyLog(m) : null;

  // Touch: swipe right to reply, hold for the actions. A mouse uses the hover buttons (or right-click). A second
  // finger anywhere in the chat makes it a pinch of the text size (ChatZoom.tsx), never a reply or the menu. A press on
  // code is the browser's: it selects the text to copy (#438).
  const end = () => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    clearTimeout(p.timer);
    setDx(0);
    if (p.swipe && id !== undefined && !pinchCancels(p.at, lastPinchAt())) onReply(id);
  };
  const gestures = {
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.pointerType === 'mouse' || isPinching() || (e.target as HTMLElement).closest('a, button, code, pre')) return;
      const p = { x: e.clientX, y: e.clientY, at: performance.now(), long: false, swipe: false, timer: 0 };
      p.timer = window.setTimeout(() => {
        if (pinchCancels(p.at, lastPinchAt())) return;
        p.long = true;
        onActions(item);
      }, LONG_PRESS_MS);
      press.current = p;
    },
    onPointerMove: (e: ReactPointerEvent) => {
      const p = press.current;
      if (!p || p.long) return;
      if (pinchCancels(p.at, lastPinchAt())) return (p.swipe = false), end();
      const mx = e.clientX - p.x;
      const my = e.clientY - p.y;
      if (Math.abs(mx) > 10 || Math.abs(my) > 10) clearTimeout(p.timer);
      if (Math.abs(my) > 30 || id === undefined) return end();
      if (mx > 0) setDx(Math.min(mx, SWIPE_PX + 20));
      p.swipe = mx > SWIPE_PX;
    },
    onPointerUp: end,
    onPointerCancel: end,
    onContextMenu: (e: ReactMouseEvent) => {
      if ((e.target as HTMLElement).closest('a, code, pre')) return;
      e.preventDefault();
      if (!press.current?.long) onActions(item);
    },
  };

  // An office note: hold or right-click it for its actions (Delete).
  if (m && (look === 'pill' || m.switch?.useKey || m.pacing || m.ceoStuck || m.accountOut || m.problems || m.checklist || ((m.notice || m.signIn) && look === 'card')))
    return (
      <div className="bubble-row-office" data-msg={id} {...gestures}>
        {m.signIn && look === 'card' ? <SignInCard card={m.signIn} />
          : m.notice && look === 'card' ? <NoticeCard text={officeText(m.text)} notice={m.notice} />
          : m.switch?.useKey ? <UseKeyCard text={officeText(m.text)} account={m.switch.useKey} />
          : m.pacing ? <PacingCard text={officeText(m.text)} />
          : m.problems ? <ProblemsDigestCard text={officeText(m.text)} digest={m.problems} />
          : m.checklist ? <ChecklistCard id={m.checklist.id} />
          : m.ceoStuck ? <CeoStuckCard text={officeText(m.text)} stuck={m.ceoStuck} />
          : m.accountOut ? <AccountOutCard text={officeText(m.text)} account={m.accountOut.account} />
          : m.ceoRuns ? <CeoRunsPill text={officeText(m.text)} back={m.ceoRuns.back} />
          : <NoticePill text={officeText(m.text)} />}
      </div>
    );
  const quote =
    quoted === undefined ? null : quoted === null || quoted === 'earlier' ? (
      <div className="bubble-quote bubble-quote-gone">
        <Icon name="reply" /> {quoted ? 'An earlier message' : 'The original message is no longer saved'}
      </div>
    ) : (
      <button
        type="button"
        className="bubble-quote"
        onClick={() => onQuote(quoted.id)}
        aria-label={`In reply to ${who(quoted, ceoName)}: ${excerpt(speechText(quoted.text, 300), 140)}. Show the original message.`}
      >
        <span className="bubble-quote-from"><Icon name="reply" /> {quoted.from === 'manager' ? 'You' : who(quoted, ceoName)}</span>
        <span className="bubble-quote-text">{excerpt(quoted.text, 140)}</span>
      </button>
    );

  return (
    <div className={`bubble-row ${mine ? 'bubble-row-me' : ''} ${highlight ? 'bubble-row-flash' : ''} ${cont ? 'bubble-row-cont' : ''}`} data-msg={id} tabIndex={-1} onPointerEnter={(e) => placeTools(e.currentTarget)} onFocus={(e) => {
      placeTools(e.currentTarget);
      // focus didn't scroll to a tool on a row out of view: it was the 1px touch stand-in until now
      if (e.target.classList.contains('bubble-tool')) e.target.scrollIntoView({ block: 'nearest' });
    }}>
      {mine && <BubbleTools id={id} item={item} onReply={onReply} onActions={onActions} />}
      <div className={`bubble ${mine ? 'bubble-me' : 'bubble-them'} ${delivery === 'failed' ? 'bubble-failed' : ''}`} style={dx ? { transform: `translateX(${dx}px)` } : undefined} {...gestures}>
        {dx > 0 && (
          <span className={`bubble-swipe ${dx > SWIPE_PX ? 'bubble-swipe-on' : ''}`} aria-hidden>
            <Icon name="reply" />
          </span>
        )}
        {!mine && <div className="bubble-from">{ceoName}</div>}
        {quote}
        {mine ? (
          text && <div className="bubble-text">
            {refParts(text, m?.refs).map((r, j) =>
              r.ref !== undefined ? (
                <RefChip key={j} messageId={m!.id} index={r.ref}>
                  {r.text}
                </RefChip>
              ) : (
                urlParts(r.text).map((p, i) =>
                  p.url ? (
                    <a key={`${j}-${i}`} href={p.url} target="_blank" rel="noopener noreferrer">
                      {p.text}
                    </a>
                  ) : (
                    p.text
                  ),
                )
              ),
            )}
          </div>
        ) : (
          text && <LongText text={linked((m && struckText(m, m.from)) ?? refsMarkdown(text, m?.refs))}>{(md) => <Markdown className="bubble-md" text={md} onFloor={onFloor} renderRef={renderRef} />}</LongText>
        )}
        {files.map((f) => (
          <FileCard key={f.id} file={f} onOpen={onFile} />
        ))}
        {!!m?.visuals?.length && (
          <Suspense fallback={null}>
            <ChatVisuals visuals={m.visuals} />
          </Suspense>
        )}
        {m?.artifacts?.map((a) => <ArtifactCard key={a.id} artifact={a} onOpen={() => onArtifact(m.id, a.id)} />)}
        {!!m?.actions?.length && <ActionCards actions={m.actions} messageId={m.id} />}
        {m && (log || m.summary) && <StepsRow log={rowLog(m)} actions={m.actions?.length ?? 0} used={m.used} summary={m.summary} linked={linked} onFloor={onFloor} />}
        {m?.ceoJob && <CeoJobLine tag={m.ceoJob} onJump={onQuote} />}
        {req && req.status === 'pending' && m?.from === 'ceo' && <Resume req={req} />}
        {/* one compact meta row (#215): Used (when there's no steps row to carry it) folds open across it, the time on its right */}
        <div className="bubble-meta">
          {!log && !m?.summary && m?.used && <UsedLine used={m.used} />}
          <div className="bubble-time">
            {m && !mine && <ReplayButton m={m} />}
            {m?.telegram === 'in' && <span className="bubble-via">via Telegram · </span>}
            {m?.telegram === 'out' && (
              <span className="bubble-via">
                <Icon name="plane" /> sent to Telegram ·{' '}
              </span>
            )}
            {m?.quiet && m.telegram !== 'out' && (
              <span className="bubble-via">
                <Icon name="smartphone" /> not sent: you were in the app ·{' '}
              </span>
            )}
            {m?.edited && <span className="bubble-via">edited {clock(m.edited)} · </span>}
            {clock(at)}
            {mine && delivery && delivery !== 'failed' && <DeliveryTick d={delivery} />}
          </div>
        </div>
        {m && !mine && <ReplayError m={m} />}
        {m && <Reactions m={m} ceoName={ceoName} />}
        {delivery === 'failed' && (
          <button type="button" className="bubble-retry" onClick={() => retrySend(item.out!.key)}>
            <Icon name="triangle-alert" /> Failed, tap to retry
          </button>
        )}
      </div>
      {!mine && <BubbleTools id={id} item={item} onReply={onReply} onActions={onActions} />}
    </div>
  );
});
