import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store';
import { ACCEPT } from '../../../shared/files';
import { useDialogFocus } from './dialogFocus';
import { Icon } from './Icon';
import { handsFreeProblem, setHandsFree } from './mic';
import { composerActions, type SheetAction } from './chatComposer';
import { openTextPill } from './ChatZoom';
import { useChatFull } from './chatFull';
import { Menu, type MenuItem } from './Menu';
import { foldedBadge, foldTools, type ChatToolId } from './chatToolFold';
import { keyLabel } from './keymap';
import { useControls } from './controls';
import { XLabel } from './HoverCard';
import { startCall } from './voiceCallEngine';

// The CEO chat's composer extras (#81): the + by the message box and its action sheet (camera, files, research, quick
// prompts), and the chat's header row (threads, search and memory; charts; files & artifacts; text size; call;
// hands-free; full screen; and a ⋯ with what doesn't fit, #270).

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
  /** The CEO's avatar, name and presence, first in the row. */
  who: ReactNode;
  files: number; // the thread's artifacts and files (#132)
  onChats: () => void;
  onFiles: () => void;
  onCharts: () => void;
  /** Where to draw the row: pocket mode's docked header (null until it's there); undefined draws it as the chat's own. */
  into?: HTMLElement | null;
  /** ⛶ and the real full screen here: off where the screen draws ⛶ itself (pocket mode on a phone, in its top bar). */
  full?: boolean;
}

/** A box's content width, kept up to date (0 until it's there). */
function useWidth(el: HTMLElement | null): number {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    const cs = getComputedStyle(el);
    setW(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return w;
}

/**
 * The chat's one header row (#270): who, then icon buttons with their counts as badges (threads and search, 📊 charts,
 * files & artifacts, text size, call, hands-free, full screen), the ones that don't fit folded into ⋯ (chatToolFold.ts).
 */
export function ChatTools({ ceoName, who, files, onChats, onFiles, onCharts, into, full = true }: ToolsProps) {
  const [own, setOwn] = useState<HTMLDivElement | null>(null);
  const width = useWidth(into ?? own);
  const handsFree = useHandsFree(ceoName);
  const fullScreen = useChatFull();
  const fullKey = keyLabel(useControls((s) => s.bindings.chatFull)[0] ?? '');
  const present: ChatToolId[] = ['search', 'charts', 'text', 'call'];
  if (files > 0) present.push('files');
  if (handsFree) present.push('handsFree');
  if (full) present.push('full');
  const { shown, folded } = foldTools(width, present);
  const has = (t: ChatToolId) => shown.includes(t);
  const fold = (t: ChatToolId, item: MenuItem) => folded.includes(t) && item;
  const row = (
    <>
      {who}
      <button type="button" className="chat-tool xbtn" onClick={onChats} aria-haspopup="dialog" aria-label="Threads and search" title="Threads: a new one, an earlier one, search them all, and what the CEO remembers">
        <Icon name="search" />
        <XLabel text="Threads" />
      </button>
      {has('charts') && (
        <button type="button" data-tour="chat-charts" className="chat-tool xbtn" onClick={onCharts} aria-haspopup="dialog" aria-label="Charts" title={`Charts: ready prompts ${ceoName} answers with a live chart`}>
          <Icon name="chart-column" />
          <XLabel text="Charts" />
        </button>
      )}
      {has('files') && (
        <button type="button" className="chat-tool xbtn" onClick={onFiles} aria-label={`Files (${files})`} title="Every artifact and file in this thread">
          <Icon name="paperclip" />
          <XLabel text="Files" />
          <span className="badge badge-dot chat-tool-n" aria-hidden>{files}</span>
        </button>
      )}
      {has('text') && (
        <button type="button" className="chat-tool xbtn" onClick={openTextPill} aria-label="Text size" title="Text size: A− and A+ (or pinch the chat, or Ctrl + wheel over it)">
          Aa
          <XLabel text="Text size" />
        </button>
      )}
      {has('call') && (
        <button type="button" className="chat-tool xbtn" aria-label={`Call ${ceoName}`} title={`A voice call with ${ceoName}: just talk, talk over to interrupt. It goes on whatever you open.`} onClick={startCall}>
          <Icon name="phone" />
          <XLabel text="Call" />
        </button>
      )}
      {handsFree && has('handsFree') && <HandsFreeToggle ceoName={ceoName} {...handsFree} />}
      {has('full') && <FullButton />}
      <Menu
        label="More for the chat"
        className="chat-more"
        tour="chat-more"
        badge={foldedBadge(folded, { files })}
        items={[
          fold('charts', { label: 'Charts', hint: 'Ready prompts for a live chart', onSelect: onCharts }),
          fold('files', { label: `Files & artifacts (${files})`, onSelect: onFiles }),
          fold('text', { label: 'Text size', onSelect: openTextPill }),
          fold('call', { label: `Call ${ceoName}`, onSelect: startCall }),
          handsFree && fold('handsFree', { label: handsFree.on ? 'Turn hands-free off' : 'Hands-free', hint: handsFree.why || undefined, onSelect: () => void setHandsFree(!handsFree.on, ceoName) }),
          { label: 'Threads', hint: 'A new one, an earlier one, or search them all', onSelect: onChats },
          full && { label: fullScreen.on ? 'Leave full screen' : 'Full screen chat', hint: `${ceoName} fills the page${fullKey ? ` · ${fullKey}` : ''}`, onSelect: () => fullScreen.set(!fullScreen.on) },
        ]}
      />
    </>
  );
  if (into === undefined)
    return (
      <div ref={setOwn} className="chat-head">
        {row}
      </div>
    );
  return into ? createPortal(row, into) : null;
}

// Lucide's maximize-2 and minimize-2 (ISC, lucide.dev).
const MAXIMIZE = 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7';
const MINIMIZE = 'M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7';

/** ⛶ (#201): the chat fills the window, or on a phone hides the tab bar. */
export function FullButton() {
  const { on, set } = useChatFull();
  const key = keyLabel(useControls((s) => s.bindings.chatFull)[0] ?? '');
  const label = on ? 'Leave full screen' : 'Full screen chat';
  return (
    <button type="button" data-tour="chat-full" className="chat-tool chat-full-btn xbtn" aria-pressed={on} aria-label={label} title={`${label}${key ? ` (${key})` : ''}`} onClick={() => set(!on)}>
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d={on ? MINIMIZE : MAXIMIZE} />
      </svg>
      <XLabel text={label} keys={key || undefined} />
    </button>
  );
}

/** Hands-free's state, or null where it's off in Settings (no button then). */
function useHandsFree(ceoName: string): { on: boolean; why: string } | null {
  const listen = useStore((s) => s.settings.listen);
  useStore((s) => `${s.voiceKeySet}:${s.settings.voice.provider}`); // handsFreeProblem() follows the key and the voice
  if (!listen || listen.provider === 'off') return null;
  return { on: listen.handsFree, why: handsFreeProblem(ceoName) };
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
