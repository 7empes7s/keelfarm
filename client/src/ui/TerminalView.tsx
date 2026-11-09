// An agent's window (#86, #117): one header row (their ring, name, task, time, ■ and ⋯), the terminal or their chat
// (#120, AgentChat.tsx; the Chat | Terminal switch) in all the room there is with the message box under it, and the
// details (Now, Profile, Setup) in a bottom sheet on phones or a side panel on computers.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { api } from '../api';
import { isBusy, kanbanFor, agentsOnRepo, useStore } from '../store';
import { AgentChat } from './AgentChat';
import { BrowserCard } from './BrowserCard';
import { AgentDetails, type DetailsTab } from './AgentDetails';
import { chatUnavailable, paneFor, useChatMode, type AgentPane } from './chatMode';
import { AgentRing } from './AgentRing';
import { TaskRing } from './TaskProgress';
import { canPickWork, sheetAfterDrag, SWIPE_PX, taskLine } from './agentWindow';
import { clearDesk, letGo, stopAgent } from './dangerActions';
import { LiveTerminal } from './LiveTerminal';
import { effectiveModel } from '../../../shared/models';
import { assignChoices } from '../pocket/pocketData';
import { agentLabel, signInFor, workerCli } from './floorRows';
import { Menu } from './Menu';
import { MessageBox } from './MessageBox';
import { MicButton } from './MicButton';
import { closeOverlay, Panel } from './Panel';
import { loadScreenshot } from '../screenshot';
import { toolVerb } from '../world/draw';
import { followAgent } from '../world/camera/rig';
import { agentPhrase } from './statusPhrase';
import { HistoryButton } from './HistoryTab';
import { useTermKeysPref } from './TermKeyBar';
import { PHONE_WINDOW_QUERY, stepFont, termFontSize, unzoomedFont } from './termLayout';
import { useA11y } from './a11y';
import { Icon } from './Icon';
import { copySignInLink, SignInSteps } from './SignInCard';
import { troubleLine } from '../../../shared/keyTrouble';
import { useMode } from '../pocket/mode';
import './termPhone.css';
import { useDraft } from '../drafts';

function elapsed(from: number | null, to: number | null) {
  if (!from) return '';
  const s = Math.max(0, Math.floor(((to ?? Date.now()) - from) / 1000));
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Whether this screen gets the terminal-first window (#86), following the media query as the window turns or resizes. */
function usePhoneWindow() {
  const query = () => typeof matchMedia === 'function' && matchMedia(PHONE_WINDOW_QUERY).matches;
  const [phone, setPhone] = useState(query);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(PHONE_WINDOW_QUERY);
    const change = () => setPhone(mq.matches);
    mq.addEventListener('change', change);
    return () => mq.removeEventListener('change', change);
  }, []);
  return phone;
}

/** Tap or swipe: a tap on the header (or the sheet's handle) toggles the details, a swipe up opens and down closes them. */
function useSwipe(open: boolean, set: (open: boolean) => void) {
  const from = useRef<number | null>(null);
  const swiped = useRef(false);
  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      e.currentTarget.setPointerCapture?.(e.pointerId); // the swipe's end lands here even off the header
      from.current = e.clientY;
      swiped.current = false;
    },
    onPointerUp: (e: PointerEvent) => {
      if (from.current === null) return;
      const dy = e.clientY - from.current;
      from.current = null;
      if (Math.abs(dy) < SWIPE_PX) return;
      swiped.current = true;
      set(sheetAfterDrag(open, dy));
    },
    onClick: () => {
      if (swiped.current) swiped.current = false;
      else set(sheetAfterDrag(open, 0));
    },
  };
}

const FONT_PREF = 'cubefarm:termFont';

/** The terminal's font size, A−/A+ remembered per device. */
function useTermFont(phone: boolean): [number, (by: 1 | -1) => void] {
  const [saved, setSaved] = useState<number | null>(() => {
    try {
      const v = localStorage.getItem(FONT_PREF);
      return v ? Number(v) : null;
    } catch {
      return null;
    }
  });
  const size = termFontSize(phone, window.innerWidth, saved);
  const step = (by: 1 | -1) => {
    const next = stepFont(size, by);
    setSaved(next);
    try {
      localStorage.setItem(FONT_PREF, String(next));
    } catch {
      // private mode: just this visit
    }
  };
  return [size, step];
}

/** `jump`: the chat item to show (a CEO action card's message, #215); `details`: open their details on that tab. */
export function TerminalView({ agentId, view, jump, details: requestedDetails, profile = false }: { agentId: string; view?: AgentPane; jump?: number; details?: DetailsTab; profile?: boolean }) {
  const openOn = requestedDetails ?? (profile ? 'profile' : undefined);
  const agent = useStore((s) => s.agents[agentId]);
  const log = useStore((s) => s.logs[agentId]) ?? [];
  const shotAt = useStore((s) => s.screens[agentId]);
  const repo = useStore((s) => s.repos.find((r) => r.id === s.agents[agentId]?.repoId));
  const allAgents = useStore((s) => s.agents);
  const settings = useStore((s) => s.settings);
  const clis = useStore((s) => s.clis);
  const office = useMode((s) => s.mode) === 'office';
  const [text, setText] = useDraft(`agent:${agentId}`); // kept through a reload (#216)
  const [busy, setBusy] = useState(false);
  const phone = usePhoneWindow();
  // The details: a sheet a phone opens when asked, a side panel a computer shows from the start.
  const [sheet, setSheet] = useState(!!openOn);
  const [side, setSide] = useState(true);
  const details = phone ? sheet : side;
  const setDetails = phone ? setSheet : setSide;
  const [tab, setTab] = useState<DetailsTab>(openOn ?? 'now');
  const swipe = useSwipe(details, setDetails);
  const [fontPx, stepFontSize] = useTermFont(phone);
  const uiScale = useA11y((s) => s.prefs.uiScale);
  const fontSize = phone ? unzoomedFont(fontPx, uiScale) : fontPx;
  const [keysOn, setKeysOn] = useTermKeysPref(false);
  const chatMode = useChatMode();
  const [opened, setOpened] = useState(view);
  useEffect(() => {
    setOpened(view);
    if (openOn) {
      setTab(openOn);
      setSheet(true);
      setSide(true);
    }
  }, [agentId, view, jump, openOn]);
  const [liveLine, setLiveLine] = useState('');
  const onStatus = useCallback((line: string) => setLiveLine(line), []);
  const [, tick] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // The browser card shows the last screenshot that loaded, never a broken image. The loaded <img> itself goes in
  // the card, so showing it never asks the server again.
  const [shot, setShot] = useState<{ agentId: string; img: HTMLImageElement } | null>(null);
  const shotTime = agent?.hasScreenshot ? (shotAt ?? agent.screenshotAt) : null;

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(
    () =>
      loadScreenshot(agentId, shotTime, (img) => {
        img.alt = 'Latest browser screenshot from the agent';
        setShot({ agentId, img });
      }),
    [agentId, shotTime],
  );
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [log.length]);

  const qaRecords = useStore((s) => s.qa);
  const cols = useMemo(() => (repo ? kanbanFor(repo, agentsOnRepo(allAgents, repo.id), qaRecords) : null), [repo, allAgents, qaRecords]);
  // Any free agent takes either: an issue from the backlog, or a pull request waiting for QA.
  const choices = assignChoices(cols);

  if (!agent || !repo) {
    return (
      <Panel title="Terminal">
        <p className="muted">That agent has left the building.</p>
      </Panel>
    );
  }

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      // api() already toasted
    } finally {
      setBusy(false);
    }
  };
  const working = isBusy(agent);
  const cli = workerCli(agent, settings);
  const canMessage = working || (agent.task !== 'qa' && !!agent.branch && agent.status !== 'idle');
  const qaRec = agent.prNumber ? qaRecords[`${repo.id}#${agent.prNumber}`] : undefined;
  const signIn = signInFor(agent, settings);
  const noChat = chatUnavailable(agent, settings);
  const pane = signIn ? 'terminal' : paneFor(opened, chatMode.on, noChat);
  // The switch is the device's choice for every window from now on (chat mode).
  const choose = (p: AgentPane) => {
    setOpened(p);
    chatMode.set(p === 'chat');
  };
  const time = agent.startedAt ? elapsed(agent.startedAt, working ? null : agent.endedAt) : '';
  const send = (t: string) => {
    const body = t.trim();
    if (!body) return;
    setText('');
    void run(() => api.message(agent.id, body));
  };

  // One stray tap mustn't end a session: Stop always asks.
  const stop = () => run(() => stopAgent(agent));
  const openTab = (t: DetailsTab) => {
    setTab(t);
    setDetails(true);
  };

  const notes = (
    <>
      {agent.lastError && agent.status !== 'working' && !signIn && (
        <div className="term-error">
          <Icon name="triangle-alert" /> {agent.lastError}
        </div>
      )}
      {agent.blocked && agent.status === 'working' && (
        <div className="term-error">
          <Icon name="ban" /> Blocked: {agent.blocked}. Answer it in the terminal.
        </div>
      )}
      {signIn && agent.signInWhy && (
        <div className="sign-in-note sign-in-sheet" role="status">
          <b>
            <Icon name="key-round" /> {troubleLine(agent.name, agent.signInWhy)} Sign them in with your own account:
          </b>
          <SignInSteps name={agent.name} cli={signIn === 'Codex' ? 'codex' : 'claude'} here />
          <div className="sign-in-actions">
            <button className="btn btn-small" onClick={() => void copySignInLink(agent.id)}>
              <Icon name="copy" /> Copy link
            </button>
            <button className="btn btn-small btn-ghost" disabled={busy} title="Close this sign-in and show a new link" onClick={() => void run(() => api.signIn(agent.id))}>
              <Icon name="rotate-ccw" /> Start over
            </button>
          </div>
        </div>
      )}
      {signIn && !agent.signInWhy && (
        <div className="sign-in-note" role="status">
          <span className="grow">
            <b>
              <Icon name="key-round" /> Sign {agent.name}'s {signIn} in
            </b>
            <br />
            {signIn === 'Codex'
              ? 'Open the link in their terminal, sign in to ChatGPT there and enter the one-time code the terminal shows.'
              : 'Open the link in their terminal, approve it with your Claude account, then paste the code the page gives you into the terminal and press Enter.'}{' '}
            Their cloud machine keeps the sign-in{agent.task && isBusy(agent) ? ', and their task starts once it’s done' : ''}.
          </span>
          <button className="btn btn-small" disabled={busy} title="Close this sign-in and show a new link" onClick={() => run(() => api.signIn(agent.id))}>
            <Icon name="rotate-ccw" /> Start over
          </button>
        </div>
      )}
    </>
  );

  const browser = agent.hasScreenshot && <BrowserCard agent={agent} img={shot?.agentId === agentId ? shot.img : null} />;
  const split = pane === 'chat' ? (
    <AgentChat agent={agent} repo={repo} jump={jump} onTerminal={() => choose('terminal')} onSend={send} onStop={() => void stop()} />
  ) : (
    <div className="term-split">
      {agent.terminal ? (
        <LiveTerminal agentId={agent.id} cli={cli} fontSize={fontSize} compact={phone} keys={phone ? keysOn : undefined} onStatus={phone ? onStatus : undefined} signIn={!!signIn} />
      ) : (
        <div
          className="term"
          ref={scroller}
          style={phone ? { fontSize } : undefined}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
        >
          {log.length === 0 && <div className="term-line term-system">(no output yet)</div>}
          {log.map((l) => (
            <div key={l.id} className={`term-line term-${l.kind}`}>
              {l.text || ' '}
            </div>
          ))}
          {working && (
            <div className="term-line term-spin">
              <Icon name="asterisk" /> {agent.status === 'preparing' ? (agent.currentTool ?? 'Setting up worktree') : toolVerb(agent.currentTool) || 'Thinking'}… ({elapsed(agent.startedAt, null)})
            </div>
          )}
        </div>
      )}
    </div>
  );

  // The picker's own rule, so "Pick work in Details" only shows when the Now tab has the picker.
  const pickWork = canPickWork(agent);
  const placeholder = phone
    ? !pickWork
      ? `Tell ${agent.name}…`
      : canMessage
        ? `Follow-up for ${agent.name}…`
        : 'Pick work in Details'
    : !pickWork
      ? `Tell ${agent.name} something while they work${agent.terminal ? ' (typed into their terminal)' : ''}…`
      : canMessage
        ? `Ask ${agent.name} for a follow-up (resumes their session)…`
        : `Give ${agent.name} an issue or a PR to test in Details to get them started`;
  const form = (
    <form
      className="term-input"
      onSubmit={(e) => {
        e.preventDefault();
        send(text);
      }}
    >
      {phone && agent.terminal && (
        <button type="button" className="btn term-keys-toggle" aria-pressed={keysOn} aria-label="Terminal keys" title={keysOn ? 'Hide the terminal key bar' : 'Show a bar of terminal keys: Esc, Tab, arrows, Ctrl…'} onPointerDown={(e) => e.preventDefault()} onClick={() => setKeysOn(!keysOn)}>
          <Icon name="keyboard" />
        </button>
      )}
      <MessageBox value={text} onChange={setText} aria-label={`Message ${agent.name}`} title="Enter sends · Shift+Enter adds a new line" placeholder={placeholder} disabled={!canMessage} autoFocus={!agent.terminal && !phone} />
      <MicButton kind="agent" value={text} onChange={setText} onSend={send} disabled={!canMessage} />
      <button className="btn" disabled={busy || !canMessage || !text.trim()}>
        Send
      </button>
    </form>
  );

  const actions = (
    <>
      <HistoryButton className="ds-btn" focus={{ agent: agent.id }} label={`${agent.name}'s past sessions and transcripts`} />
      {office && (
        <button className="ds-btn" title={`Trail ${agent.name} with the camera wherever they go (a movement key or Esc gives you the controls back)`} onClick={() => followAgent(agent.id)}>
          <Icon name="video" /> Follow
        </button>
      )}
    </>
  );

  const menu = (
    <Menu
      label={`More for ${agent.name}`}
      title={agent.name}
      className="aw-more"
      items={[
        { label: details ? 'Hide the details' : 'Show the details', hint: 'Task, profile and setup', onSelect: () => setDetails(!details) },
        { label: 'Profile', hint: 'Their stats beside the floor’s', onSelect: () => openTab('profile') },
        { label: 'Setup', hint: 'Coding agent, model, effort, tools', onSelect: () => openTab('setup') },
        { label: 'History', hint: 'Past sessions and transcripts', onSelect: () => useStore.getState().openOverlay({ kind: 'manager', tab: 'history', history: { agent: agent.id } }) },
        office && { label: 'Follow with the camera', hint: 'A movement key or Esc gives you the controls back', onSelect: () => followAgent(agent.id) },
        { label: 'A+ Bigger terminal text', onSelect: () => stepFontSize(1) },
        { label: 'A− Smaller terminal text', onSelect: () => stepFontSize(-1) },
        working && { label: `Stop ${agent.name}…`, hint: 'Ends their session; a message picks it back up', danger: true, disabled: busy, onSelect: () => void stop() },
        !working && agent.status !== 'idle' && { label: 'Clear desk…', hint: 'Drop their task so they take new work', danger: true, disabled: busy, onSelect: () => void clearDesk(agent) },
        { label: `Let ${agent.name} go…`, hint: 'Their worktree is removed', danger: true, disabled: busy, onSelect: () => void letGo(agent).then((gone) => gone && closeOverlay()) },
      ]}
    />
  );

  const title = (
    <div className="aw-head">
      <AgentRing agent={agent} phrase={agentPhrase(agent, { autoAssign: repo?.autoAssign })} />
      <TaskRing agent={agent} link />
      <button type="button" className="aw-who" aria-expanded={details} aria-controls="aw-details" title={details ? 'Hide the details' : 'Task, profile and setup (or swipe up)'} {...swipe}>
        <span className="aw-name">
          {agent.name}
          {signIn && (
            <span title={`Waiting for you to sign ${signIn} in, in their terminal`}>
              {' '}
              <Icon name="key-round" />
            </span>
          )}
          {time && <span className="aw-time"> · {time}</span>}
        </span>
        <span className="aw-task">{taskLine(agent)}</span>
      </button>
      {working && (
        <button type="button" className="aw-icon aw-stop" aria-label={`Stop ${agent.name}…`} title={`Stop ${agent.name} (asks first)`} disabled={busy} onClick={() => void stop()}>
          <Icon name="square" />
        </button>
      )}
      {!noChat && phone && (
        // one button for the other pane: the two-button pill doesn't fit beside ■, ⋯ and × at 390px
        <button type="button" className="aw-icon aw-pane-toggle" aria-label={pane === 'chat' ? 'Terminal' : 'Chat'} title={pane === 'chat' ? 'Their terminal' : 'Their work as a conversation'} onClick={() => choose(pane === 'chat' ? 'terminal' : 'chat')}>
          <Icon name={pane === 'chat' ? 'keyboard' : 'message-circle'} />
        </button>
      )}
      {!noChat && !phone && (
        <div className="aw-seg aw-panes" role="group" aria-label="Show">
          {(['chat', 'terminal'] as const).map((p) => (
            <button key={p} type="button" aria-pressed={pane === p} aria-label={p === 'chat' ? 'Chat' : 'Terminal'} title={p === 'chat' ? 'Their work as a conversation' : 'Their terminal'} onClick={() => choose(p)}>
              <Icon name={p === 'chat' ? 'message-circle' : 'keyboard'} />
              <span className="aw-pane-label">{p === 'chat' ? ' Chat' : ' Terminal'}</span>
            </button>
          ))}
        </div>
      )}
      {menu}
    </div>
  );

  const panel = details && (
    <div id="aw-details" className={phone ? 'aw-sheet' : 'aw-side'} role="region" aria-label={`${agent.name}'s details`}>
      {phone && (
        <button type="button" className="aw-grab" aria-label="Close the details (or swipe down)" {...swipe}>
          <span />
        </button>
      )}
      <AgentDetails
        agent={agent}
        repo={repo}
        qa={qaRec}
        tab={tab}
        onTab={setTab}
        cli={agentLabel(agent, settings, clis)}
        model={(agent.role === 'ceo' ? agent.model : effectiveModel(agent.model, cli, settings, 'claude-opus-5-5')) || 'default model'}
        effort={agent.effort || settings.defaultEffort}
        elapsed={time}
        choices={choices}
        busy={busy}
        run={run}
        live={phone && agent.terminal ? liveLine : undefined}
        browser={browser}
        actions={actions}
        onClose={() => setDetails(false)}
      />
    </div>
  );

  return (
    <Panel wide accent={agent.color} className={`aw ${phone ? 'term-phone' : 'aw-desk'}`} title={title}>
      <div className={`aw-body ${!phone && details ? 'aw-body-side' : ''}`}>
        <div className="aw-main">
          {notes}
          {noChat && chatMode.on && agent.role !== 'ceo' && <p className="ac-note">{noChat}</p>}
          {split}
          {form}
        </div>
        {panel}
      </div>
    </Panel>
  );
}
