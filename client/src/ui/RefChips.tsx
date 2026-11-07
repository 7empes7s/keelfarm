import { createContext, useContext, useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { api } from '../api';
import { qaKey, useStore, type Overlay } from '../store';
import { useMode } from '../pocket/mode';
import type { ChatRef, RefFileView } from '../../../shared/types';
import { fileUrl } from '../../../shared/chatRefs';
import { actionJump, chipInfo, codeTokens, fileWindow, jumpFor, mentionAt, mentionPicks, type Jump, type RefWorld } from './chatRefs';
import type { ActionRef } from '../../../shared/ceoActions';
import { qaShotUrl } from './channels';
import { Sheet } from './ChatArtifacts';
import { Icon } from './Icon';
import { Peek, usePeek } from './HoverCard';
import { firstFailing, whoIsOn } from './peekFacts';
import './chatRefs.css';

// The chat's refs (#26): chips in the bubbles with a preview on hover or focus (mouse, keyboard) or press and hold (touch), a tap that
// jumps there inside the office (riding the elevator first in 3D), and back to the chat at the same scroll position
// when that panel closes. Files open in a read-only viewer here. Also the message box's "@" and "#" picks.

interface RefNav {
  go: (j: Jump, at: { messageId: number; index: number }) => void;
}
const NavContext = createContext<RefNav | null>(null);

// The chat's scroll position while a jump's panel replaces the phone (3D); the chat takes it back when it reopens.
let chatScroll: number | null = null;

/** Where the chat was before a jump, once (null: open it as usual). */
export function takeChatScroll(): number | null {
  const at = chatScroll;
  chatScroll = null;
  return at;
}

/** Opens a panel, riding to `floor` first when you're elsewhere; closing it goes back to the phone it came from. */
export function openFrom(overlay: Overlay, floor?: number) {
  const s = useStore.getState();
  const back = s.overlay?.kind === 'phone' ? s.overlay : null;
  const open = () => {
    useStore.getState().openOverlay(overlay);
    if (useStore.getState().overlay === overlay) useStore.setState({ back });
  };
  if (floor === undefined || (floor === s.floor && !s.travel)) return open();
  s.goToFloor(floor);
  const stop = useStore.subscribe((st) => {
    if (st.travel || st.floor !== floor) return;
    stop();
    open();
  });
  setTimeout(stop, 30_000);
}

const useWorld = (): RefWorld => ({ repos: useStore((s) => s.repos), agents: useStore((s) => s.agents), qa: useStore((s) => s.qa) });

/** The chat's chips' jumps and its file viewer. `onFloor`: what a floor chip opens; `scroller`: the chat's log. */
export function useRefNav(scroller: RefObject<HTMLElement | null>, onFloor: (floor: number) => void) {
  const pocket = useMode((s) => s.mode) === 'pocket';
  const [file, setFile] = useState<{ messageId: number; index: number } | null>(null);
  const nav: RefNav = {
    go: (j, at) => {
      if (j.kind === 'url') window.open(j.url, '_blank', 'noopener,noreferrer');
      else if (j.kind === 'file') setFile(at);
      else if (j.kind === 'floor') onFloor(j.floor);
      else if (j.kind === 'decisions') {
        // The decision log sits under the approvals: the phone's Hires tab in 3D, the Approvals tab in pocket mode.
        if (!pocket) return useStore.getState().openOverlay({ kind: 'phone', tab: 'hires' });
        window.dispatchEvent(new CustomEvent('cubefarm:open', { detail: '/?tab=approvals' }));
      } else {
        // Pocket mode keeps the chat under the panel (not under a tab: a team, #151); the 3D phone closes for it, so it
        // remembers where it was.
        if (!pocket || (j.overlay.kind === 'manager' && j.overlay.tab === 'team')) chatScroll = scroller.current?.scrollTop ?? null;
        openFrom(j.overlay, j.floor);
      }
    },
  };
  const wrap = (children: ReactNode) => <NavContext.Provider value={nav}>{children}</NavContext.Provider>;
  const viewer = file && <RefFileViewer {...file} onClose={() => setFile(null)} />;
  return { wrap, viewer, mode: pocket ? ('pocket' as const) : ('office' as const) };
}

/** Opens what a ref names, as its chip would; null when it's gone or outside a chat. */
export function useRefOpen(): ((ref: ChatRef) => (() => void) | null) {
  const nav = useContext(NavContext);
  const world = useWorld();
  const pocket = useMode((s) => s.mode) === 'pocket';
  return (ref) => {
    const j = nav && jumpFor(ref, pocket ? 'pocket' : 'office', world);
    return j ? () => nav.go(j, { messageId: -1, index: -1 }) : null;
  };
}

/** Opens what a CEO action card is about (shared/ceoActions.ts, #215); null when it's gone or outside a chat. */
export function useActionOpen(): ((ref: ActionRef) => (() => void) | null) {
  const nav = useContext(NavContext);
  const world = useWorld();
  const pocket = useMode((s) => s.mode) === 'pocket';
  return (ref) => {
    const j = nav && actionJump(ref, pocket ? 'pocket' : 'office', world);
    return j ? () => nav.go(j, { messageId: -1, index: -1 }) : null;
  };
}

/** One ref of a message as a chip, labelled as written. Text when what it names is gone. */
export function RefChip({ messageId, index, children }: { messageId: number; index: number; children: ReactNode }) {
  const nav = useContext(NavContext);
  const m = useStore((s) => s.messages.find((x) => x.id === messageId));
  const ref = m?.refs?.[index];
  const world = useWorld();
  const pocket = useMode((s) => s.mode) === 'pocket';
  // Hover or focus previews it, a long press on touch too (as a small sheet); a tap jumps (HoverCard.tsx).
  const peek = usePeek();
  const info = ref && chipInfo(ref, world);
  if (!nav || !ref || !info) return <span>{children}</span>;
  const label = m!.text.slice(ref.start, ref.end).replace(/`/g, '');
  const jump = () => {
    peek.ctl.close();
    const j = jumpFor(ref, pocket ? 'pocket' : 'office', world);
    if (j) nav.go(j, { messageId, index });
  };
  return (
    <>
      <button
        ref={(el) => void (peek.anchor.current = el)}
        type="button"
        className={`ref-chip ${info.tone ? `ref-chip-${info.tone}` : ''}`}
        aria-describedby={peek.mode ? peek.id : undefined}
        {...peek.trigger}
        onContextMenu={(e) => {
          // A long press is the preview here, not the message's actions or the browser's menu.
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={jump}
      >
        <span aria-hidden><Icon name={info.icon} /></span>
        <span className="ref-chip-label">{label}</span>
        {info.status && <span className="ref-chip-status">{` ${info.status}`}</span>}
      </button>
      <Peek peek={peek} label={label}>
        <div className="ref-peek" onClick={jump}>
          <PeekBody chip={ref} messageId={messageId} index={index} />
        </div>
      </Peek>
    </>
  );
}

// ---------- the preview card ----------

function PeekBody({ chip, messageId, index }: { chip: ChatRef; messageId: number; index: number }) {
  if (chip.kind === 'agent') return <AgentPeek id={chip.agentId} />;
  if (chip.kind === 'file') return <FilePeek messageId={messageId} index={index} />;
  return <FloorPeek chip={chip} />;
}

function AgentPeek({ id }: { id: string }) {
  const a = useStore((s) => s.agents[id]);
  const lines = useStore((s) => s.logs[id]);
  const latest = useStore((s) => s.latest[id]);
  const floor = useStore((s) => s.repos.find((r) => r.id === s.agents[id]?.repoId)?.floor);
  // The office sends this agent's lines while the preview is open (watch.ts).
  useEffect(() => {
    useStore.setState({ peek: id });
    return () => useStore.setState({ peek: null });
  }, [id]);
  if (!a) return null;
  const tail = (lines?.length ? lines : latest ? [latest] : []).filter((l) => l.text.trim()).slice(-5);
  return (
    <>
      <div className="ref-peek-head">
        <span className="avatar" style={{ background: a.color, width: 32, height: 32, fontSize: 14 }}>
          {a.name[0]}
        </span>
        <div className="grow">
          <b>{a.name}</b> <span className="muted small">floor {floor ?? '?'}</span>
          <div className="small">
            {a.status}
            {a.issueTitle ? ` · ${a.prNumber ? `PR #${a.prNumber}` : `#${a.issueNumber}`} ${a.issueTitle}` : ''}
          </div>
        </div>
      </div>
      {tail.length > 0 ? (
        <pre className="ref-peek-term">{tail.map((l) => l.text.split('\n')[0].slice(0, 120)).join('\n')}</pre>
      ) : (
        <p className="muted small">Nothing in their terminal yet.</p>
      )}
    </>
  );
}

function FloorPeek({ chip }: { chip: Exclude<ChatRef, { kind: 'agent' | 'file' }> }) {
  const repo = useStore((s) => s.repos.find((r) => r.id === chip.repoId));
  const n = chip.kind === 'floor' ? undefined : chip.number;
  const qa = useStore((s) => (n === undefined ? undefined : s.qa[qaKey(chip.repoId, n)]));
  const prApp = useStore((s) => (n === undefined ? undefined : s.prPreviews[qaKey(chip.repoId, n)]));
  const agents = useStore((s) => s.agents);
  if (!repo) return null;
  const who = n === undefined ? [] : whoIsOn(repo.id, n, Object.values(agents), qa);
  const name = repo.fullName.split('/')[1];
  if (chip.kind === 'floor') {
    return (
      <>
        <b>
          Floor {repo.floor} · {name}
        </b>
        <p className="small">{repo.summary || repo.description || repo.fullName}</p>
        <p className="muted small">
          {repo.issues.length} open issues · {repo.pulls.filter((p) => p.state === 'OPEN').length} open PRs
        </p>
      </>
    );
  }
  const pull = repo.pulls.find((p) => p.number === n);
  const issue = repo.issues.find((i) => i.number === n);
  if (chip.kind === 'preview') {
    const p = n === undefined ? repo.preview : prApp;
    return (
      <>
        <b>
          <Icon name="play" /> {name} · {n === undefined ? repo.defaultBranch : `PR #${n}`}
        </b>
        <p className="small">{p ? `${p.status}${p.url ? ` at ${p.url}` : ''}` : pull?.state === 'OPEN' ? 'Not started: opening it starts it.' : 'This PR is no longer open.'}</p>
      </>
    );
  }
  const title = pull?.title ?? issue?.title;
  const fail = firstFailing(qa?.checks);
  return (
    <>
      <b>
        {pull ? 'PR' : 'Issue'} #{n} {title ?? ''}
      </b>
      <p className="small">
        {pull ? `${pull.state.toLowerCase()} · checks ${pull.checks}` : issue ? 'open' : 'Not on the board: opens on GitHub.'}
        {qa ? ` · QA ${qa.status}${qa.round > 1 ? ` (round ${qa.round})` : ''}` : ''}
      </p>
      {(pull || issue) && <p className="small"><Icon name="user" /> {who.length ? who.join(', ') : 'Nobody on it yet'}</p>}
      {fail && <p className="small ref-peek-clip">✗ {fail.name}: {fail.line}</p>}
      {qa?.summary && <p className="small ref-peek-clip">{qa.summary}</p>}
      {chip.kind === 'qa' && n !== undefined && qa?.shots?.length ? <img className="ref-peek-shot" src={qaShotUrl(repo.id, n, 0, qa.updatedAt)} alt={qa.shots[0].caption} /> : null}
    </>
  );
}

// File texts as loaded, by `<message>-<ref>`: loaded once, when first shown.
const files = new Map<string, Promise<RefFileView | string>>();
function loadFile(messageId: number, index: number): Promise<RefFileView | string> {
  const key = `${messageId}-${index}`;
  let p = files.get(key);
  if (!p) {
    p = api.refFile(messageId, index).catch((e: Error) => e.message);
    files.set(key, p);
  }
  return p;
}

function useRefFile(messageId: number, index: number): RefFileView | string | null {
  const [f, setF] = useState<RefFileView | string | null>(null);
  useEffect(() => {
    let live = true;
    void loadFile(messageId, index).then((x) => live && setF(x));
    return () => {
      live = false;
    };
  }, [messageId, index]);
  return f;
}

function Code({ path, from, lines, mark }: { path: string; from: number; lines: string[]; mark: number | null }) {
  return (
    <pre className="ref-code" tabIndex={0}>
      {lines.map((l, i) => (
        <div key={i} className={`ref-code-line ${from + i === mark ? 'ref-code-mark' : ''}`} data-line={from + i}>
          <span className="ref-code-n" aria-hidden>
            {from + i}
          </span>
          {codeTokens(l, path).map((t, j) => (t.kind ? <span key={j} className={`ref-tok-${t.kind}`}>{t.text}</span> : t.text))}
          {'\n'}
        </div>
      ))}
    </pre>
  );
}

function FilePeek({ messageId, index }: { messageId: number; index: number }) {
  const f = useRefFile(messageId, index);
  if (f === null) return <p className="muted small">Loading…</p>;
  if (typeof f === 'string') return <p className="small">{f}</p>;
  const w = fileWindow(f.text, f.line);
  return (
    <>
      <b className="ref-peek-path">
        <Icon name="file-text" /> {f.path}
        {f.line ? `:${f.line}` : ''}
      </b>
      <Code path={f.path} {...w} mark={f.line} />
    </>
  );
}

/** A file ref full-screen, read-only, at its line; GitHub has it too. */
function RefFileViewer({ messageId, index, onClose }: { messageId: number; index: number; onClose: () => void }) {
  const f = useRefFile(messageId, index);
  const ref = useStore((s) => s.messages.find((m) => m.id === messageId)?.refs?.[index]);
  const repo = useStore((s) => s.repos.find((r) => ref?.kind === 'file' && r.id === ref.repoId));
  const body = useRef<HTMLDivElement>(null);
  const loaded = f !== null && typeof f !== 'string';
  useEffect(() => {
    if (loaded && f.line) body.current?.querySelector(`[data-line="${f.line}"]`)?.scrollIntoView({ block: 'center' });
  }, [loaded, f]);
  if (ref?.kind !== 'file') return null;
  const url = loaded ? f.url : repo ? fileUrl(repo.fullName, repo.defaultBranch, ref.path, ref.line) : null;
  return (
    <Sheet label={<><Icon name="file-text" /> {ref.path}{ref.line ? `:${ref.line}` : ''}</>} onClose={onClose} className="ref-file-viewer">
      <div className="artifact-body" ref={body}>
        {f === null ? <p className="muted">Loading…</p> : typeof f === 'string' ? <p>{f}</p> : <Code path={f.path} from={1} lines={f.text.replace(/\r\n?/g, '\n').split('\n')} mark={f.line} />}
      </div>
      <div className="artifact-actions">
        {url && (
          <a className="btn btn-small btn-good" href={url} target="_blank" rel="noopener noreferrer">
            Open on GitHub
          </a>
        )}
        <span className="muted small">{repo ? `${repo.fullName} · ${repo.defaultBranch}` : ''}</span>
      </div>
    </Sheet>
  );
}

// ---------- the message box ----------

/** "@" offers agents and "#" the floor's issues and PRs, above the message box; picking one writes its ref. */
export function useMentions(text: string, setText: (t: string) => void, focus: () => void) {
  const [active, setActive] = useState(0);
  const [closed, setClosed] = useState<string | null>(null);
  const world = useWorld();
  const floor = useStore((s) => s.floor);
  const at = mentionAt(text);
  const list = at && closed !== text ? mentionPicks(at, world, floor) : [];
  const pick = (i: number) => {
    if (!at || !list.length) return;
    setText(text.slice(0, at.start) + list[i % list.length].insert);
    setActive(0);
    focus();
  };
  const picks: ReactNode = list.length ? (
    <ul className="slash-picks" role="listbox" aria-label={at!.kind === '@' ? 'Agents' : 'Issues and pull requests'}>
      {list.map((p, i) => (
        <li key={p.insert} role="option" aria-selected={i === active % list.length}>
          <button type="button" className={`slash-pick ${i === active % list.length ? 'slash-pick-on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)}>
            {p.label} <span className="muted small">{p.hint}</span>
          </button>
        </li>
      ))}
    </ul>
  ) : null;
  /** True when the key was the list's. */
  const onKeyDown = (e: KeyboardEvent) => {
    if (!list.length) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((n) => Math.max(0, n + (e.key === 'ArrowDown' ? 1 : -1)));
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setClosed(text);
      return true;
    }
    if (e.key !== 'Tab' && (e.key !== 'Enter' || e.shiftKey)) return false;
    e.preventDefault();
    pick(active);
    return true;
  };
  return { picks, onKeyDown };
}
