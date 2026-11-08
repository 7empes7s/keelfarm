import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { ACCEPT } from '../../../shared/files';
import { useDialogFocus } from './dialogFocus';
import { Icon } from './Icon';
import { handsFreeProblem, setHandsFree } from './mic';
import { composerActions, type SheetAction } from './chatComposer';
import { openTextPill } from './ChatZoom';
import { canGoFullscreen, goFullscreen, useChatFull } from './chatFull';
import { Menu, type MenuItem } from './Menu';
import { keyLabel } from './keymap';
import { useControls } from './controls';
import { XLabel } from './HoverCard';
import { startCall } from './voiceCallEngine';
import { ChartsButton } from './ChatCharts';
import { foldTools, foldedBadge, type ChatToolId } from './chatToolFold';

// The CEO chat's composer extras (#81): the + by the message box and its action sheet (camera, files, research, quick
// prompts), and the chat's top-bar buttons (threads, search and memory; 📊 charts; files & artifacts; text size; call;
// hands-free; full screen; and ⋯ for what doesn't fit, #270).

interface PlusProps {
  text: string;
  ceoName: string;
  onFiles: (files: File[]) => void;
  onResearch: () => void;
  onQuick: (prompt: string) => void;
}

/** The + and its sheet. The file inputs stay mounted, so a pick lands after the sheet has closed. */
export function ChatActionsSheet({ text, ceoName, onFiles, onResearch, onQuick }: PlusProps) {
  const [open, setOpen] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [touch] = useState(() => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
  const take = (el: HTMLInputElement) => {
    if (el.files?.length) onFiles([...el.files]);
    el.value = '';
  };
  const run = (id: string) => {
    setOpen(false);
    if (id === 'camera') camera.current?.click();
    else if (id === 'file') picker.current?.click();
    else if (id === 'research') onResearch();
    else onQuick(id.slice('quick:'.length));
  };
  return (
    <>
      <input ref={picker} type="file" multiple accept={ACCEPT} hidden onChange={(e) => take(e.currentTarget)} />
      <input ref={camera} type="file" accept="image/*,video/*" capture="environment" hidden onChange={(e) => take(e.currentTarget)} />
      <button type="button" className="chat-plus" aria-label="More: attach, research, quick prompts" aria-haspopup="dialog" aria-expanded={open} title="Attach, research, quick prompts" onClick={() => setOpen(true)}>
        <Icon name="plus" />
      </button>
      {open && <Sheet actions={composerActions(text, touch)} ceoName={ceoName} onPick={run} onClose={() => setOpen(false)} />}
    </>
  );
}

function Sheet({ actions, ceoName, onPick, onClose }: { actions: SheetAction[]; ceoName: string; onPick: (id: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogFocus(ref); // focus goes back to the + when it closes
  useEffect(() => ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(), []);
  const quick = actions.filter((a) => a.id.startsWith('quick:'));
  const tools = actions.filter((a) => !a.id.startsWith('quick:'));
  const button = (a: SheetAction) => (
    <button key={a.id} type="button" className={a.id.startsWith('quick:') ? 'chat-sheet-quick' : 'chat-sheet-item'} disabled={a.disabled} onClick={() => onPick(a.id)}>
      {a.icon && <Icon name={a.icon} />} {a.label}
    </button>
  );
  return (
    <div className="chat-sheet-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className="chat-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(e) => {
          // Esc closes the sheet only, not the phone under it.
          if (e.key !== 'Escape') return;
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
      >
        <div id={titleId} className="chat-menu-title">
          Add to your message to {ceoName}
        </div>
        <div className="chat-sheet-items">{tools.map(button)}</div>
        <div className="chat-menu-title">Quick prompts</div>
        <div className="chat-sheet-items">{quick.map(button)}</div>
      </div>
    </div>
  );
}

// ---------- the top bar ----------

interface ToolsProps {
  ceoName: string;
  files: number; // the thread's artifacts and files (#132)
  onChats: () => void;
  onFiles: () => void;
  /** A 📊 prompt picked (#270): sent to the CEO. */
  onPrompt: (text: string) => void;
  /** ⛶ here: off where the screen draws ⛶ itself (pocket mode on a phone, in its top bar). */
  full?: boolean;
}

/**
 * The header's icon buttons (#270): search, 📊 and ⛶ always, files, call, text size and hands-free as the header's
 * width allows (chatToolFold.ts), and the rest in ⋯, which carries a folded tool's badge.
 */
export function ChatTools({ ceoName, files, onChats, onFiles, onPrompt, full = true }: ToolsProps) {
  const [el, setEl] = useState<HTMLSpanElement | null>(null);
  const width = useHeadWidth(el);
  const hands = useHandsFree(ceoName);
  const screen = useChatFull();
  const present: ChatToolId[] = ['search', 'charts', 'call', 'text'];
  if (full) present.push('full');
  if (files > 0) present.push('files');
  if (hands) present.push('handsFree');
  const { shown, folded } = foldTools(width, present);
  const badge = foldedBadge(folded, { files });
  const buttons: Record<ChatToolId, () => ReactNode> = {
    search: () => (
      <button type="button" className="chat-tool xbtn" onClick={onChats} aria-haspopup="dialog" aria-label="Threads and search" title="Threads: a new one, an earlier one, search them all, and what the CEO remembers">
        <Icon name="search" />
        <XLabel text="Threads" />
      </button>
    ),
    charts: () => <ChartsButton ceoName={ceoName} onPrompt={onPrompt} />,
    files: () => (
      <button type="button" className="chat-tool xbtn" onClick={onFiles} aria-label={`Files (${files})`} title="Every artifact and file in this thread">
        <Icon name="paperclip" />
        <XLabel text="Files" />
        <span className="badge badge-dot chat-tool-n" aria-hidden>{files}</span>
      </button>
    ),
    text: () => (
      <button type="button" className="chat-tool xbtn" onClick={openTextPill} aria-label="Text size" title="Text size: A− and A+ (or pinch the chat, or Ctrl + wheel over it)">
        Aa
        <XLabel text="Text size" />
      </button>
    ),
    call: () => (
      <button type="button" className="chat-tool xbtn" aria-label={`Call ${ceoName}`} title={`A voice call with ${ceoName}: just talk, talk over to interrupt. It goes on whatever you open.`} onClick={startCall}>
        <Icon name="phone" />
        <XLabel text="Call" />
      </button>
    ),
    handsFree: () => hands && <HandsFreeToggle ceoName={ceoName} {...hands} />,
    full: () => <FullButton />,
  };
  const items: (MenuItem | false | null)[] = [
    folded.includes('files') && { label: `Files & artifacts (${files})`, hint: 'Every artifact and file in this thread', onSelect: onFiles },
    folded.includes('text') && { label: 'Text size', hint: 'A− and A+, or pinch the chat', onSelect: openTextPill },
    folded.includes('call') && { label: `Call ${ceoName}`, hint: 'A voice call: just talk', onSelect: startCall },
    folded.includes('handsFree') && hands && { label: hands.on ? 'Hands-free off' : 'Hands-free', hint: hands.why || `Talk with ${ceoName} without touching anything`, onSelect: () => void setHandsFree(!hands.on, ceoName) },
    { label: 'Conversations', hint: `Threads, search and what ${ceoName} remembers`, onSelect: onChats },
    full && { label: screen.on ? 'Leave full screen' : 'Full screen', onSelect: () => screen.set(!screen.on) },
    full && canGoFullscreen() && !document.fullscreenElement && { label: 'Go full screen', hint: 'The whole screen, no browser bars', onSelect: goFullscreen },
  ];
  return (
    <span ref={setEl} className="chat-tools">
      {shown.map((t) => (
        <Fragment key={t}>{buttons[t]()}</Fragment>
      ))}
      <span className="chat-more">
        <Menu label={badge ? `More for the chat (${badge} files)` : 'More for the chat'} title="More for the chat" items={items} />
        {badge > 0 && (
          <span className="badge badge-dot chat-tool-n" aria-hidden>
            {badge}
          </span>
        )}
      </span>
    </span>
  );
}

/** The width of the header the tools sit in: the docked chat's, else the chat's own. */
function useHeadWidth(el: HTMLElement | null): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const head = el?.closest<HTMLElement>('.pk-dock-head, .chat-head') ?? el?.parentElement;
    if (!head) return;
    const measure = () => setWidth(head.clientWidth);
    measure();
    const seen = new ResizeObserver(measure);
    seen.observe(head);
    return () => seen.disconnect();
  }, [el]);
  return width;
}

// Lucide's maximize-2 and minimize-2 (ISC, lucide.dev).
const MAXIMIZE = 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7';
const MINIMIZE = 'M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7';

/** ⛶ (#201): the chat fills the window, or on a phone hides the tab bar. */
export function FullButton() {
  const { on, set } = useChatFull();
  const key = keyLabel(useControls((s) => s.bindings.chatFull)[0] ?? '');
  const label = on ? 'Leave full screen' : 'Full screen';
  return (
    <button type="button" data-tour="chat-full" className="chat-tool chat-full-btn xbtn" aria-pressed={on} aria-label={label} title={`${label}${key ? ` (${key})` : ''}`} onClick={() => set(!on)}>
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d={on ? MINIMIZE : MAXIMIZE} />
      </svg>
      <XLabel text={label} keys={key || undefined} />
    </button>
  );
}

/** Hands-free while listening is set up: whether it's on, and what stops it, if anything. */
function useHandsFree(ceoName: string): { on: boolean; why: string } | null {
  const listen = useStore((s) => s.settings.listen);
  useStore((s) => `${s.voiceKeySet}:${s.settings.voice.provider}`); // handsFreeProblem() follows the key and the voice
  if (!listen || listen.provider === 'off') return null;
  return { on: listen.handsFree, why: handsFreeProblem(ceoName) || '' };
}

function HandsFreeToggle({ ceoName, on, why }: { ceoName: string; on: boolean; why: string }) {
  return (
    <button
      type="button"
      className={`chat-tool xbtn ${on ? 'hands-free-on' : ''}`}
      aria-pressed={on}
      aria-label={on ? 'Hands-free on' : 'Hands-free'}
      title={on ? `Hands-free is on: after ${ceoName}'s spoken reply the phone listens for up to 8 s and sends what you say. Esc or M closes the mic.` : why || `Hands-free: talk with ${ceoName} without touching anything`}
      onClick={() => void setHandsFree(!on, ceoName)}
    >
      <Icon name="headphones" />
      <XLabel text={on ? 'Hands-free on' : 'Hands-free'} />
    </button>
  );
}
