import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { CEO_ID, type ChatArtifact, type PhoneMessage } from '../../../shared/types';
import { excerpt, heldBanner, RESEARCH_PREFIX, yesNoFor } from '../../../shared/chat';
import { suggestionsFor } from '../../../shared/chatParts';
import { hasChatScroll, takeChatScroll, useMentions, useRefNav } from './RefChips';
import { linkCeoText, type FloorRef } from './chatLinks';
import { sendToCeo } from './chatSend';
import { reduceMotion } from './a11y';
import { resetViewport, VIEWPORT_EVENT } from '../viewport';
import { QuestionChips } from './QuestionChips';
import { ArtifactView } from './ChatArtifacts';
import { itemOf, MessageActions, who, type Item } from './ChatActions';
import { applyChatPage, fetchChatPage, OlderSpinner, useOlderPages, useRemovals } from './ChatPaging';
import { firstPaintFrom, firstUnread as firstUnreadId } from '../../../shared/chatPage';
import { messageActions } from './chatMessageActions';
import { messageCommands } from './codeBlock';
import { copyText } from './clipboard';
import { MessageBox } from './MessageBox';
import { LiveBubble } from './ChatLive';
import { DaySeparator, IdeaCard, Starters, WorkingStrip } from './ChatCards';
import { ItDeskCards } from './ItDeskCards';
import { DecisionTray } from './Decisions';
import { continuesGroup } from './chatCardRules';
import { keepsFollowing } from './chatFollow';
import { Conversations } from './ChatHistory';
import { openOnce } from './surfaces';
import { CeoMemory } from './CeoMemory';
import { MEMORY_NOTE_MAX } from '../../../shared/ceoMemory';
import { AttachTray, FileViewer, useDropZone, useSlash } from './ChatFiles';
import { ChatLibrary, useThreadLibrary } from './ChatLibrary';
import { ThreadBar, type ChatSegment } from './ChatThreadBar';
import { useAttachments } from './chatUpload';
import { useDraft } from '../drafts';
import type { FileRef } from '../../../shared/files';
import { MicButton } from './MicButton';
import { ChatActionsSheet, ChatTools } from './ChatActionsSheet';
import { ChartPrompts } from './ChartPrompts';
import { useCeoDraft } from './goTo';
import { hasVersionsSheet } from '../../../shared/messageEdits';
import { MessageVersions } from './MessageEdits';
import { ChatTextPill, useChatPinch } from './ChatZoom';
import { Bubble, placeTools } from './ChatBubble';
import { attempt, Avatar } from './phoneParts';
import { isKey } from './controls';
import { togglesFull, useChatFull } from './chatFull';
import { CloseButton, Icon } from './Icon';

// The chat with the CEO: the thread, its sheets and the message box (bubbles are in ChatBubble.tsx).

/**
 * The thread with the CEO; pocket mode shows it as its Chat tab, where the keyboard waits for a tap. `onFloor`: what a
 * floor chip opens (default: the elevator there). `tools`: where its header row goes (pocket mode's docked header, #270).
 * `away`: drawn, hidden, while another tab is open (the phone's Chat tab, #145), so opening it only shows it: nothing
 * is marked read, and each opening starts afresh at the unread divider or the end.
 */
export function Chat({ autoFocus = true, onFloor, tools, fullButton = true, away = false }: { autoFocus?: boolean; onFloor?: (repoId: string) => void; tools?: HTMLElement | null; fullButton?: boolean; away?: boolean }) {
  const messages = useStore((s) => s.messages);
  const chatOlder = useStore((s) => s.chatOlder);
  const outbox = useStore((s) => s.chatOutbox);
  const readAt = useStore((s) => s.phoneReadAt);
  const ceo = useStore((s) => s.agents[CEO_ID]);
  const info = useStore((s) => s.ceo);
  const repos = useStore((s) => s.repos);
  const goToFloor = useStore((s) => s.goToFloor);
  const chat = useStore((s) => s.chat);
  const [editing, setEditing] = useState<number | null>(null); // one of the manager's messages, being edited (#125)
  const draftKey = `ceo:${chat?.current ?? ''}`; // kept through a reload or crash (#216), not while it holds an edit
  const [text, setText] = useDraft(draftKey, editing === null);
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [versions, setVersions] = useState<PhoneMessage | null>(null);
  const endEdit = () => (setEditing(null), setText(''));
  const [sheet, setSheet] = useState<'chats' | 'memory' | 'charts' | null>(null);
  const [menu, setMenu] = useState<Item | null>(null);
  // an artifact or file to read; `doc`, `from`: one from another thread, with where it was sent (#132)
  const [artifact, setArtifact] = useState<{ messageId: number; artifactId: string; doc?: ChatArtifact; from?: string | null } | null>(null);
  const [viewing, setViewing] = useState<{ id: string; messageId?: number | null; from?: string | null } | null>(null);
  const [seg, setSeg] = useState<ChatSegment>('chat');
  const [logOpen, setLogOpen] = useState(false); // the working strip's live step log (#150)
  const att = useAttachments(draftKey);
  const library = useThreadLibrary(messages);
  const drop = useDropZone(att.add);
  const slash = useSlash(text, setText, () => form.current?.querySelector('textarea')?.focus());
  // A message the search, the guide or an empty list prepared for the CEO (goTo.ts): in the box, ready to finish and send.
  const draft = useCeoDraft((s) => s.text);
  useEffect(() => {
    if (draft === null) return;
    setText(draft);
    useCeoDraft.setState({ text: null });
    setTimeout(() => form.current?.querySelector('textarea')?.focus(), 0);
  }, [draft, setText]);
  // The decision log's "Replied to message N" (#208): that message, once the chat has laid out.
  const jumpTo = useCeoDraft((s) => s.jump ?? null);
  useEffect(() => {
    if (jumpTo === null || away) return;
    useCeoDraft.setState({ jump: null });
    requestAnimationFrame(() => jump(jumpTo));
  }, [jumpTo, away]); // eslint-disable-line react-hooks/exhaustive-deps
  const [flash, setFlash] = useState<number | null>(null);
  const [atEnd, setAtEnd] = useState(true);
  const [seenTo, setSeenTo] = useState(() => messages[messages.length - 1]?.id ?? -1); // the last message seen at the end: newer ones count as new
  // The first message that was unread when the chat opened: the "New messages" divider goes above it. Away, it
  // follows the unread for the next opening.
  const [firstUnread, setFirstUnread] = useState(() => firstUnreadId(messages, readAt, chatOlder));
  const unreadNow = away ? firstUnreadId(messages, readAt, chatOlder) : firstUnread;
  if (unreadNow !== firstUnread) setFirstUnread(unreadNow);
  // Opening draws the newest screenful first, the rest of the page two frames later (after a paint); all at once when
  // it must find a message or a scroll position at once.
  const [warm, setWarm] = useState(() => away || jumpTo !== null || hasChatScroll());
  useEffect(() => {
    let r = requestAnimationFrame(() => (r = requestAnimationFrame(() => setWarm(true))));
    return () => cancelAnimationFrame(r);
  }, []);
  const coldHeight = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);
  const [logWrap, setLogWrap] = useState<HTMLDivElement | null>(null);
  useChatPinch(logWrap, useCallback(() => scroller.current, []));
  const form = useRef<HTMLFormElement>(null);
  const stick = useRef(true);
  const lastTop = useRef(0);
  const opened = useRef(false);

  // By value: a floor's other changes (issues, agents) leave the memoised bubbles alone.
  const floorsKey = JSON.stringify(repos.map((r): FloorRef => ({ floor: r.floor, fullName: r.fullName, prs: r.pulls.map((p) => p.number) })));
  const linked = useMemo(() => ((floors: FloorRef[]) => (t: string) => linkCeoText(t, floors))(JSON.parse(floorsKey)), [floorsKey]);
  // The bubbles' handlers, the same functions every render; `on` has this render's.
  const on = useRef<{ floor: (n: number) => void; quote: (id: number) => void; reply: (id: number) => void }>(null);
  const stable = useMemo(() => ({ floor: (n: number) => on.current?.floor(n), quote: (id: number) => on.current?.quote(id), reply: (id: number) => on.current?.reply(id), artifact: (messageId: number, artifactId: string) => setArtifact({ messageId, artifactId }), file: (id: string) => setViewing({ id }) }), []);
  const pages = useOlderPages(scroller, { first: messages[0]?.id, older: chatOlder && warm, fetch: fetchChatPage, apply: applyChatPage });
  const removals = useRemovals(away);
  const listed = useMemo(() => messages.filter((m) => !removals.hidden.some((x) => x.id === m.id)), [messages, removals.hidden]);
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const start = firstPaintFrom(listed.map((m) => m.id), firstUnread, warm);
  const openFloor = (n: number) => {
    const repo = repos.find((r) => r.floor === n);
    if (!repo) return;
    if (onFloor) onFloor(repo.id);
    else goToFloor(n);
  };
  const refNav = useRefNav(scroller, openFloor);
  const mention = useMentions(text, setText, () => form.current?.querySelector('textarea')?.focus());
  const full = useChatFull((s) => s.on);
  const box = useRef<HTMLDivElement>(null);
  // F (Help → Controls) toggles full screen while the chat has focus and nobody is typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target instanceof HTMLElement ? e.target : null; // a key sent to the window has none
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (!togglesFull(e, isKey('chatFull', e.code), !!el && !!box.current?.contains(el), typing)) return;
      e.preventDefault();
      useChatFull.getState().toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Reading the thread marks it read, on screen only: that also clears its notifications on every device (#210).
  useEffect(() => {
    if (away) return;
    const read = () => {
      const last = [...messages].reverse().find((m) => m.from === 'ceo');
      if (last && last.at > readAt && document.visibilityState === 'visible') void attempt(() => api.phoneRead(last.at));
    };
    read();
    document.addEventListener('visibilitychange', read);
    return () => document.removeEventListener('visibilitychange', read);
  }, [messages, readAt, away]);
  // Away, it waits at the end to open afresh.
  useLayoutEffect(() => {
    if (!away) return;
    opened.current = false;
    stick.current = true;
  }, [away]);
  // Opening the chat shows the unread divider (or the end); after that it follows new messages only from the end.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (!opened.current && !away) {
      opened.current = true;
      // Back from a chip's jump: where the chat was.
      const back = takeChatScroll();
      if (back !== null) {
        el.scrollTop = back;
        stick.current = el.scrollHeight - back - el.clientHeight < 40;
        setAtEnd(stick.current);
        return;
      }
      const divider = el.querySelector<HTMLElement>('.chat-unread');
      if (divider && el.scrollHeight - divider.offsetTop > el.clientHeight) {
        el.scrollTop = divider.offsetTop - 8;
        stick.current = false;
        setAtEnd(false);
        return;
      }
    }
    if (stick.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, outbox.length, info.job?.kind, chat.live, away]);
  // The rest of the first page going in above keeps the view where it was: the end, or the unread divider.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (!warm) coldHeight.current = el.scrollHeight;
    else if (coldHeight.current) {
      el.scrollTop = stick.current ? el.scrollHeight : el.scrollTop + el.scrollHeight - coldHeight.current;
      coldHeight.current = 0;
    }
  });
  // At the end, the newest message stays in view while the log resizes (the keyboard), a picture loads, or the page is put back.
  const hasCeo = ceo !== undefined;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const follow = () => {
      if (stick.current) el.scrollTop = el.scrollHeight;
      el.querySelectorAll<HTMLElement>('.bubble-row:hover, .bubble-row:focus-within').forEach(placeTools);
    };
    const resized = new ResizeObserver(follow);
    resized.observe(el);
    el.addEventListener('load', follow, true);
    window.addEventListener(VIEWPORT_EVENT, follow);
    return () => {
      resized.disconnect();
      el.removeEventListener('load', follow, true);
      window.removeEventListener(VIEWPORT_EVENT, follow);
    };
  }, [hasCeo]);
  useEffect(() => {
    if (flash === null) return;
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [flash]);

  if (!ceo) return <p className="muted phone-empty">The corner office is empty.</p>;
  const toEnd = () => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion() ? 'auto' : 'smooth' });
    stick.current = true;
    setAtEnd(true);
    setSeenTo(messages[messages.length - 1]?.id ?? -1);
  };
  const fill = (t: string) => {
    setText(t);
    requestAnimationFrame(() => form.current?.querySelector('textarea')?.focus());
  };
  const unseen = messages.filter((m) => m.id > seenTo && m.from === 'ceo').length;
  const send = (t: string, to: number | null = replyTo, files: FileRef[] = []) => {
    if (!t.trim() && !files.length) return;
    setText('');
    setReplyTo(null);
    stick.current = true;
    sendToCeo(t, to ?? undefined, files);
    resetViewport();
  };
  // The message box's own send carries the tray's files; quick chips and suggestions send text only.
  const sendTyped = () => {
    if (editing !== null) {
      if (text.trim()) void attempt(() => api.editMessage(editing, text));
      return endEdit();
    }
    if (att.busy) return;
    if (!text.trim() && !att.ready.length) return;
    send(text, replyTo, att.ready);
    att.clear();
  };
  const reply = (id: number) => {
    setReplyTo(id);
    form.current?.querySelector('textarea')?.focus();
  };
  const replyAbout = (id: number, title: string) => {
    setReplyTo(id);
    setText((t) => t || `About “${title}”: `);
    requestAnimationFrame(() => form.current?.querySelector('textarea')?.focus());
  };
  const jump = (id: number) => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-msg="${id}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
    setFlash(id);
  };
  on.current = { floor: openFloor, quote: jump, reply };
  const replying = ceo.status === 'working' && info.job?.kind === 'chat';
  const stop = () => void attempt(api.ceoStop);
  const last = (from: PhoneMessage['from']) => [...messages].reverse().find((x) => x.from === from)?.id;
  const actionsFor = (item: Item) => {
    const m = item.m;
    if (!m) return [];
    return messageActions(m, {
      latest: m.from !== 'office' && m.id === last(m.from),
      versions: hasVersionsSheet(m) ? (m.versions?.length ?? 0) + 1 : null,
      edit: () => (setEditing(m.id), setReplyTo(null), setText(m.text)),
      showVersions: () => setVersions(m),
      retry: () => void attempt(api.ceoRetry),
      remember: () => void attempt(() => api.addMemory(excerpt(m.text, MEMORY_NOTE_MAX))).then((ok) => ok !== undefined && useStore.getState().pushToast('success', `${ceo.name} will remember it (open What they remember to see or edit)`)),
      removal: removals.action(m),
      // The voice reads the CEO's short summary (#282); this reads all of it.
      readWhole: useStore.getState().settings.voice.provider !== 'off' ? () => void import('./voiceMessages').then((v) => v.replayMessage(m, 'whole')) : undefined,
      commands: messageCommands(m.text),
      copy: (t) => void copyText(t).then((ok) => useStore.getState().pushToast(ok ? 'success' : 'error', ok ? 'Copied all commands' : "Couldn't reach the clipboard")),
    });
  };
  const chatQueued = info.queue.some((j) => j.kind === 'chat');
  const presence =
    ceo.status === 'working'
      ? replying
        ? 'typing…'
        : info.job?.kind === 'research'
          ? 'researching…'
          : `busy: ${info.job?.label ?? 'working'}`
      : chatQueued
        ? info.held
          ? 'held by the usage limit'
          : 'reading your message…'
        : info.queue.length
          ? `next up: ${info.queue[0].label}`
          : 'available';
  const offer = suggestionsFor(messages);
  const offered = offer !== null && !outbox.some((o) => o.replyTo === offer.id) ? offer : null;
  const question = offer ? null : yesNoFor(messages);
  const answered = question !== null && outbox.some((o) => o.replyTo === question);
  const shown = artifact && (artifact.doc ?? byId.get(artifact.messageId)?.artifacts?.find((a) => a.id === artifact.artifactId));
  const thread = chat.conversations.find((c) => c.id === chat.current);
  // Open in thread: this one's message, or that thread (#132).
  const inThread = (from: string | null | undefined, id: number | null | undefined) => () => {
    setSeg('chat');
    if (from && from !== chat.current) void attempt(() => api.openConversation(from));
    else if (id != null) setTimeout(() => jump(id), 0);
  };
  const quotedNow = replyTo === null ? undefined : byId.get(replyTo);
  const bubble = (item: Item, key: string | number, cont = false) => {
    const to = item.m ? item.m.replyTo : item.out.replyTo;
    return (
      <Bubble
        key={key}
        item={itemOf(item)}
        ceoName={ceo.name}
        quoted={to === undefined ? undefined : (byId.get(to) ?? (chatOlder && to < messages[0].id ? 'earlier' : null))}
        highlight={item.m !== undefined && flash === item.m.id}
        linked={linked}
        onFloor={stable.floor}
        onQuote={stable.quote}
        onReply={stable.reply}
        onActions={setMenu}
        onArtifact={stable.artifact}
        onFile={stable.file}
        cont={cont}
      />
    );
  };

  return refNav.wrap(
    <div ref={box} className={`phone-chat ${full ? 'chat-full' : ''} ${drop.dragging ? 'chat-dropping' : ''} ${seg === 'files' ? 'chat-on-files' : ''}`} {...drop.props}>
      <ChatTools
        ceoName={ceo.name}
        who={
          <>
            <span className={ceo.status === 'working' ? 'ceo-thinking' : undefined}>
              <Avatar name={ceo.name} color={ceo.color} size={28} />
            </span>
            <div className="grow chat-who">
              <b>{ceo.name}</b> <span className={`small ${ceo.status === 'working' ? 'presence-busy' : 'muted'}`}>{presence}</span>
            </div>
          </>
        }
        files={library.length}
        onChats={() => setSheet('chats')}
        onFiles={() => setSeg('files')}
        onCharts={() => (setSeg('chat'), setSheet('charts'))}
        into={tools}
        full={fullButton}
      />
      {sheet === 'charts' && <ChartPrompts ceoName={ceo.name} suggested={offer?.suggestions ?? []} onSend={(q) => send(q, null)} onClose={() => setSheet(null)} />}
      <ThreadBar thread={thread} seg={seg} onSeg={setSeg} files={library.length} onFloor={openFloor} />
      {seg === 'files' && <ChatLibrary messages={messages} thread={thread} onArtifact={(i) => setArtifact({ messageId: i.messageId!, artifactId: i.artifact!.id, from: i.conversationId, ...(i.conversationId !== chat.current && { doc: i.artifact }) })} onFile={(i) => setViewing({ id: i.file!.id, messageId: i.messageId, from: i.conversationId })} />}
      <div className="chat-log-wrap" ref={setLogWrap}>
        <ChatTextPill />
        <div
          className="chat-log"
          ref={scroller}
          aria-label={`Messages with ${ceo.name}`}
          tabIndex={0}
          onScroll={(e) => {
            const el = e.currentTarget;
            pages.onScroll(el);
            el.querySelectorAll<HTMLElement>('.bubble-row:hover, .bubble-row:focus-within').forEach(placeTools);
            const end = keepsFollowing(stick.current, el.scrollTop, lastTop.current, el.scrollHeight - el.scrollTop - el.clientHeight < 40);
            lastTop.current = el.scrollTop;
            stick.current = end;
            if (end === atEnd) return;
            setAtEnd(end);
            setSeenTo(messages[messages.length - 1]?.id ?? -1);
          }}
        >
          {messages.length === 0 && outbox.length === 0 && (
            <p className="muted small phone-empty">
              Say hi to {ceo.name}. Ask how things are going, hand over a project brief, or ask whether a team should grow. Replies land here, and the phone buzzes when {ceo.name} needs you.
            </p>
          )}
          {listed.map((m, i, all) => i < start ? null : (
            <Fragment key={m.id}>
              <DaySeparator prev={all[i - 1]?.at} at={m.at} />
              {m.id === firstUnread && (
                <div className="chat-unread" role="separator">
                  New messages
                </div>
              )}
              {bubble({ m }, m.id, continuesGroup(all[i - 1], m))}{m.question && <QuestionChips m={m} sent={outbox.some((o) => o.replyTo === m.id)} onPick={(s) => send(s, m.id)} onWrite={() => reply(m.id)} />}
              {m.id === offered?.id && (
                <div className="suggestions" role="group" aria-label={`Suggested replies to ${ceo.name}`}>
                  {offered.suggestions!.map((s) => (
                    <button key={s} type="button" className="suggestion-chip" onClick={() => send(s, offered.id)} aria-label={`Reply “${s}” to ${ceo.name}`}>
                      <Icon name="reply" /> {s}
                    </button>
                  ))}
                </div>
              )}
              {m.idea && !outbox.some((o) => o.replyTo === m.id) && !messages.some((x) => x.replyTo === m.id) && (
                <IdeaCard idea={m.idea} ceoName={ceo.name} onAccept={() => send(m.idea!.message, m.id)} onEdit={() => (setReplyTo(m.id), fill(m.idea!.message))} />
              )}
            </Fragment>
          ))}
          {outbox.map((o) => bubble({ out: o }, `out-${o.key}`))}
          {(replying || chat.live) && <LiveBubble live={chat.live} ceoName={ceo.name} linked={linked} onFloor={stable.floor} onOpenLog={() => setLogOpen(true)} />}
        </div>
        <OlderSpinner loading={pages.loading} />
        {!atEnd && (
          <button type="button" className="chat-jump" onClick={toEnd} aria-label={unseen ? `${unseen} new messages: jump to the latest` : 'Jump to the latest message'}>
            {unseen ? (
              <>
                {unseen} new <Icon name="arrow-down" />
              </>
            ) : (
              <>
                <Icon name="arrow-down" /> Latest
              </>
            )}
          </button>
        )}
        {versions && <MessageVersions m={byId.get(versions.id) ?? versions} author={versions.from === 'manager' ? 'you' : ceo.name} onClose={() => setVersions(null)} />}
        {menu && <MessageActions item={menu} ceoName={ceo.name} more={actionsFor(menu)} onReply={reply} onClose={() => setMenu(null)} />}
        {sheet === 'chats' && <Conversations ceoName={ceo.name} onClose={() => setSheet(null)} onMemory={() => (setSheet(null), openOnce('memory', () => setSheet('memory')))} />}
        {sheet === 'memory' && <CeoMemory ceoName={ceo.name} onClose={() => setSheet(null)} />}
        {shown && artifact && (
          <ArtifactView messageId={artifact.messageId} artifact={shown} linked={linked} onFloor={openFloor} onReplyAbout={artifact.doc ? undefined : replyAbout} onOpenInThread={seg === 'files' ? inThread(artifact.from, artifact.messageId) : undefined} onClose={() => setArtifact(null)} />
        )}
        {viewing && <FileViewer id={viewing.id} onOpenInThread={seg === 'files' && (viewing.from || viewing.messageId != null) ? inThread(viewing.from, viewing.messageId) : undefined} onClose={() => setViewing(null)} />}
        {refNav.viewer}
      </div>
      <DecisionTray hide={offered?.id} typing={!!text.trim()} onPick={(d, option) => send(option, d.messageId)} onJump={jump} />
      {/* answers to a pending question stay inline; everything else is behind the + */}
      <div className="quick">
        {question !== null && !answered && (
          <>
            <button className="quick-chip quick-answer" onClick={() => send('Yes', question)} aria-label={`Reply Yes to ${ceo.name}'s question`}>
              <Icon name="reply" /> Yes
            </button>
            <button className="quick-chip quick-answer" onClick={() => send('No', question)} aria-label={`Reply No to ${ceo.name}'s question`}>
              <Icon name="reply" /> No
            </button>
          </>
        )}
        {!text && question === null && !offered && editing === null && ceo.status !== 'working' && <Starters onPick={fill} />}
        {(ceo.status === 'error' || ceo.status === 'stopped') && last('manager') !== undefined && (
          <button className="quick-chip quick-answer" onClick={() => void attempt(api.ceoRetry)}>
            <Icon name="refresh-cw" /> Retry
          </button>
        )}
      </div>
      {removals.bar}
      {editing !== null && (
        <div className="chat-reply">
          <b className="grow small">
            <Icon name="pencil" /> Editing your message: {editing === last('manager') ? `Send replaces it, and ${ceo.name} answers the new version` : `Save replaces it, and ${ceo.name} gets a note of the change`}
          </b>
          <CloseButton className="chat-reply-x" label="Cancel the edit" onClick={endEdit} />
        </div>
      )}
      {replyTo !== null && (
        <div className="chat-reply">
          <div className="grow chat-reply-body">
            <b className="small"><Icon name="reply" /> Replying to {quotedNow ? (quotedNow.from === 'manager' ? 'yourself' : who(quotedNow, ceo.name)) : 'a message'}</b>
            <div className="chat-reply-text small">{quotedNow ? excerpt(quotedNow.text, 140) : 'The original message is no longer saved'}</div>
          </div>
          <CloseButton className="chat-reply-x" label="Cancel the reply" title="Cancel the reply (Esc)" onClick={() => setReplyTo(null)} />
        </div>
      )}
      {chatQueued && info.held && (
        <div className="chat-held small" role="status">
          <Icon name="pause" /> {heldBanner(info.held)}
        </div>
      )}
      <ItDeskCards inChat typing={!!text.trim()} />
      <WorkingStrip onStop={stop} open={logOpen} onToggle={() => setLogOpen(!logOpen)} linked={linked} onFloor={openFloor} />
      <AttachTray pending={att.pending} onRemove={att.remove} onRetry={att.retry} />
      {mention.picks}
      {slash.picks}
      <form
        ref={form}
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          sendTyped();
        }}
        onPaste={(e) => {
          if (!e.clipboardData.files.length) return;
          e.preventDefault();
          att.add([...e.clipboardData.files]);
        }}
      >
        <ChatActionsSheet
          text={text}
          ceoName={ceo.name}
          onFiles={(files) => {
            att.add(files);
            resetViewport(); // back from the photo picker or the camera
          }}
          // Research: the CEO brainstorms with the web and the manager's apps, and brings options with sources (server/research.ts).
          onResearch={() => send(`${RESEARCH_PREFIX}${text.trim()}`, null)}
          onQuick={(q) => send(q, null)}
        />
        <MessageBox
          value={text}
          onChange={setText}
          placeholder={replyTo !== null ? 'Write your reply…' : `Message ${ceo.name}…`}
          aria-label={replyTo !== null ? `Reply to ${quotedNow ? who(quotedNow, ceo.name) : 'a message'}` : `Message ${ceo.name}`}
          title="Enter sends · Shift+Enter adds a new line · Esc cancels a reply"
          autoFocus={autoFocus}
          onKeyDown={(e) => {
            if (mention.onKeyDown(e) || slash.onKeyDown(e)) return;
            if (e.key !== 'Escape' || replyTo === null) return;
            e.preventDefault();
            e.stopPropagation();
            setReplyTo(null);
          }}
        />
        <MicButton kind="phone" value={text} onChange={setText} onSend={send} />
        {ceo.status === 'working' && editing === null && !text.trim() && !att.ready.length ? (
          <button type="button" className="btn btn-small btn-bad" onClick={stop} aria-label={`Stop ${ceo.name}`} title="Stop: what's done stays done, and the reply says what that was">
            <Icon name="square" />
          </button>
        ) : (
          <button className="btn btn-small btn-good" disabled={att.busy || (!text.trim() && !att.ready.length)} title={att.busy ? 'Waiting for the files to upload' : undefined}>
            {editing === null ? 'Send' : editing === last('manager') ? 'Resend' : 'Save'}
          </button>
        )}
      </form>
    </div>,
  );
}
