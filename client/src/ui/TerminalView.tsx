import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CareerCard } from './CareerCard';
import { api } from '../api';
import { isBusy, kanbanFor, agentsOnRepo, useStore } from '../store';
import { AgentSetup } from './AgentSettings';
import { clearDesk, letGo } from './dangerActions';
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
import { badgeStatus, StatusPill } from './StatusPill';
import { HistoryButton } from './HistoryTab';
import { confirmDialog } from './Confirm';
import { useTermKeysPref } from './TermKeyBar';
import { PHONE_WINDOW_QUERY, stepFont, termFontSize, unzoomedFont } from './termLayout';
import { useA11y } from './a11y';
import './termPhone.css';

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

export function TerminalView({ agentId }: { agentId: string }) {
  const agent = useStore((s) => s.agents[agentId]);
  const log = useStore((s) => s.logs[agentId]) ?? [];
  const shotAt = useStore((s) => s.screens[agentId]);
  const repo = useStore((s) => s.repos.find((r) => r.id === s.agents[agentId]?.repoId));
  const allAgents = useStore((s) => s.agents);
  const settings = useStore((s) => s.settings);
  const clis = useStore((s) => s.clis);
  const [text, setText] = useState('');
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showCareer, setShowCareer] = useState(false);
  const phone = usePhoneWindow();
  const [details, setDetails] = useState(false);
  const [fontPx, stepFontSize] = useTermFont(phone);
  const uiScale = useA11y((s) => s.prefs.uiScale);
  const fontSize = phone ? unzoomedFont(fontPx, uiScale) : fontPx;
  const [keysOn, setKeysOn] = useTermKeysPref(false);
  const [liveLine, setLiveLine] = useState('');
  const onStatus = useCallback((line: string) => setLiveLine(line), []);
  const [, tick] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // The browser pane shows the last screenshot that loaded, never a broken image. The loaded <img> itself goes in
  // the pane, so showing it never asks the server again.
  const shotView = useRef<HTMLDivElement>(null);
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
  useEffect(() => {
    shotView.current?.replaceChildren(...(shot?.agentId === agentId ? [shot.img] : []));
  }, [shot, agentId, agent?.hasScreenshot, details]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [log.length]);

  const qaRecords = useStore((s) => s.qa);
  const cols = useMemo(() => (repo ? kanbanFor(repo, agentsOnRepo(allAgents, repo.id), qaRecords) : null), [repo, allAgents, qaRecords]);
  // Any free agent takes either: an issue from the backlog, or a pull request waiting for QA.
  const choices = assignChoices(cols);
  const chosen = choices.find((c) => c.key === pick);

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
  const issueUrl = agent.issueNumber ? `https://github.com/${repo.fullName}/issues/${agent.issueNumber}` : null;
  const canMessage = working || (agent.task !== 'qa' && !!agent.branch && agent.status !== 'idle');
  const qaRec = agent.prNumber ? qaRecords[`${repo.id}#${agent.prNumber}`] : undefined;
  const signIn = signInFor(agent, settings);
  const send = (t: string) => {
    const body = t.trim();
    if (!body) return;
    setText('');
    void run(() => api.message(agent.id, body));
  };

  const stop = async () => {
    // On a phone it sits in the details sheet next to other buttons: one stray tap mustn't end the session.
    if (phone && !(await confirmDialog({ tone: 'danger', icon: '■', title: `Stop ${agent.name}?`, body: 'Their session ends now. A message picks it back up.', confirm: 'Stop' }))) return;
    await run(() => api.stop(agent.id));
  };

  const tools = (
    <>
      <button className="btn btn-small" title={`Trail ${agent.name} with the camera wherever they go (a movement key or Esc gives you the controls back)`} onClick={() => followAgent(agent.id)}>
        🎥 Follow
      </button>
      {agent.career && (
        <button className={`btn btn-small setup-toggle ${showCareer ? 'setup-toggle-on' : ''}`} aria-expanded={showCareer} title={`${agent.name}'s career on the team`} onClick={() => setShowCareer((v) => !v)}>
          🏅 Career
        </button>
      )}
      <button
        className={`btn btn-small setup-toggle ${showSetup ? 'setup-toggle-on' : ''}`}
        aria-expanded={showSetup}
        aria-controls="agent-setup"
        title={`${agent.name}'s name, look, coding agent, model and effort`}
        onClick={() => setShowSetup((v) => !v)}
      >
        ⚙️ Setup
      </button>
    </>
  );

  const meta = (
    <div className="term-meta">
      {agent.task === 'qa' && agent.status !== 'idle' ? (
        <a href={agent.prUrl ?? '#'} target="_blank" rel="noreferrer">
          Testing PR #{agent.prNumber}: {agent.issueTitle}
        </a>
      ) : agent.task === 'fix' && agent.status !== 'idle' ? (
        <a href={agent.prUrl ?? '#'} target="_blank" rel="noreferrer">
          Fixing PR #{agent.prNumber} after QA: {agent.issueTitle}
        </a>
      ) : agent.issueNumber && agent.status !== 'idle' ? (
        <a href={issueUrl!} target="_blank" rel="noreferrer">
          Issue #{agent.issueNumber}: {agent.issueTitle}
        </a>
      ) : (
        <span className="muted">Nothing assigned</span>
      )}
      {agent.prUrl && agent.task === 'issue' && (
        <a href={agent.prUrl} target="_blank" rel="noreferrer" className="chip chip-good">
          PR #{agent.prNumber}
        </a>
      )}
      {qaRec && agent.status !== 'idle' && (
        <span className={`chip ${qaRec.status === 'passed' ? 'chip-good' : ''}`}>
          QA: {qaRec.status}
          {qaRec.round > 1 ? ` · round ${qaRec.round}` : ''}
        </span>
      )}
      {qaRec?.commentUrl && (
        <a href={qaRec.commentUrl} target="_blank" rel="noreferrer">
          QA report ↗
        </a>
      )}
      {agent.branch && <code>{agent.branch}</code>}
      <span className="muted">
        {(agent.role === 'ceo' ? agent.model : effectiveModel(agent.model, cli, settings, 'claude-opus-5-5')) || 'default model'} ·{' '}
        {agent.effort || settings.defaultEffort} effort
      </span>
      {agent.startedAt && <span className="muted">⏱ {elapsed(agent.startedAt, working ? null : agent.endedAt)}</span>}
      {agent.turns > 0 && <span className="muted">{agent.turns} turns</span>}
      {agent.costUsd > 0 && <span className="muted" title="API-equivalent cost reported by the coding agent; subscription usage is billed by plan">≈${agent.costUsd.toFixed(2)}</span>}
      <HistoryButton focus={{ agent: agent.id }} label={`${agent.name}'s past sessions and transcripts`} />
    </div>
  );

  const notes = (
    <>
      {agent.lastError && agent.status !== 'working' && !signIn && <div className="term-error">⚠️ {agent.lastError}</div>}
      {agent.blocked && agent.status === 'working' && <div className="term-error">⛔ Blocked: {agent.blocked}. Answer it in the terminal.</div>}
      {signIn && (
        <div className="sign-in-note" role="status">
          <span className="grow">
            <b>
              🔑 Sign {agent.name}'s {signIn} in
            </b>
            <br />
            {signIn === 'Codex'
              ? 'Open the link in their terminal, sign in to ChatGPT there and enter the one-time code the terminal shows.'
              : 'Open the link in their terminal, approve it with your Claude account, then paste the code the page gives you into the terminal and press Enter.'}{' '}
            Their cloud machine keeps the sign-in{agent.task && isBusy(agent) ? ', and their task starts once it’s done' : ''}.
          </span>
          <button className="btn btn-small" disabled={busy} title="Close this sign-in and show a new link" onClick={() => run(() => api.signIn(agent.id))}>
            ↻ Start over
          </button>
        </div>
      )}
    </>
  );

  const panes = (
    <>
      {showCareer && <CareerCard agent={agent} />}
      {showSetup && (
        <div id="agent-setup" className="setup-wrap">
          <AgentSetup agent={agent} />
        </div>
      )}
    </>
  );

  const browser = agent.hasScreenshot && (
    <div className="browser">
      <div className="browser-bar">🔒 {agent.browserUrl ?? 'about:blank'}</div>
      <div className="browser-view" ref={shotView} tabIndex={0} role="region" aria-label="Their browser" />
      <div className="muted small">Latest Playwright screenshot{agent.screenshotAt ? ` · ${new Date(agent.screenshotAt).toLocaleTimeString()}` : ''}</div>
    </div>
  );
  const split = (
    <div className={`term-split ${agent.hasScreenshot && !phone ? 'term-split-2' : ''}`}>
      {agent.terminal ? (
        <LiveTerminal agentId={agent.id} cli={cli} fontSize={fontSize} compact={phone} keys={phone ? keysOn : undefined} onStatus={phone ? onStatus : undefined} />
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
          {working && <div className="term-line term-spin">✻ {agent.status === 'preparing' ? (agent.currentTool ?? 'Setting up worktree') : toolVerb(agent.currentTool) || 'Thinking'}… ({elapsed(agent.startedAt, null)})</div>}
        </div>
      )}
      {!phone && browser}
    </div>
  );

  const placeholder = phone
    ? working
      ? `Tell ${agent.name}…`
      : canMessage
        ? `Follow-up for ${agent.name}…`
        : 'Pick work in ⓘ'
    : working
      ? `Tell ${agent.name} something while they work${agent.terminal ? ' (typed into their terminal)' : ''}…`
      : canMessage
        ? `Ask ${agent.name} for a follow-up (resumes their session)…`
        : `Give ${agent.name} an issue or a PR to test to get them started`;
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
          ⌨
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
    <div className="term-actions">
      {working ? (
        <button className="btn btn-bad" disabled={busy} onClick={() => void stop()}>
          ■ Stop
        </button>
      ) : (
        <>
          <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Work to give them">
            <option value="">{choices.length ? 'Pick an issue to build or a PR to test…' : 'Nothing to pick up'}</option>
            {(['issue', 'qa'] as const).map((kind) => {
              const group = choices.filter((c) => c.kind === kind);
              return (
                group.length > 0 && (
                  <optgroup key={kind} label={kind === 'qa' ? 'Pull requests to test' : 'Issues to build'}>
                    {group.map((c) => (
                      <option key={c.key} value={c.key}>
                        {kind === 'qa' ? 'PR ' : ''}#{c.number} {c.title}
                      </option>
                    ))}
                  </optgroup>
                )
              );
            })}
          </select>
          <button
            className="btn btn-good"
            disabled={busy || !chosen}
            onClick={() =>
              chosen &&
              run(async () => {
                if (chosen.kind === 'qa') await api.sendToQa(repo.id, chosen.number, agent.id);
                else await api.assign(agent.id, chosen.number);
                setPick('');
              })
            }
          >
            {chosen?.kind === 'qa' ? `🔍 Test PR #${chosen.number}` : '▶ Start issue'}
          </button>
        </>
      )}
      <span className="spacer" />
      <Menu
        label={`More for ${agent.name}`}
        title={agent.name}
        items={[
          !working && agent.status !== 'idle' && { label: '↺ Clear desk…', hint: 'Drop their task so they take new work', danger: true, disabled: busy, onSelect: () => void clearDesk(agent) },
          { label: `Let ${agent.name} go…`, hint: 'Their worktree is removed', danger: true, disabled: busy, onSelect: () => void letGo(agent).then((gone) => gone && closeOverlay()) },
        ]}
      />
    </div>
  );

  const avatar = (
    <span className="avatar" style={{ background: agent.color }}>
      {agent.name[0]}
    </span>
  );

  if (phone) {
    // Terminal first (#86): one header row, the terminal in all the room there is, one bottom bar; the rest folds
    // into the details sheet under the header.
    const status = badgeStatus(agent);
    const toggle = (body: ReactNode, className: string, label?: string) => (
      <button type="button" className={className} aria-expanded={details} aria-controls="term-details" aria-label={label} title={details ? 'Hide the details' : 'Task, model, History, Stop and more'} onClick={() => setDetails((v) => !v)}>
        {body}
      </button>
    );
    return (
      <Panel
        wide
        accent={agent.color}
        className="term-phone"
        title={
          <div className="term-title">
            {avatar}
            {toggle(agent.name, 'term-name')}
            <span className={`status status-${status} status-dot`} role="img" aria-label={status} title={status} />
            {signIn && <span title={`Waiting for you to sign ${signIn} in, in their terminal`}>🔑</span>}
            {toggle(details ? '▴' : 'ⓘ', 'btn btn-small term-details-toggle', details ? 'Hide the details' : 'Details')}
          </div>
        }
      >
        {details && (
          <div id="term-details" className="term-details">
            {meta}
            {actions}
            {agent.terminal && <div className="muted small">{liveLine}</div>}
            <div className="term-details-row">
              <span className="chip" title="Their coding agent">
                ⌨️ {agentLabel(agent, settings, clis)}
              </span>
              <span className="spacer" />
              <button type="button" className="btn btn-small" aria-label="Smaller terminal text" onClick={() => stepFontSize(-1)}>
                A−
              </button>
              <button type="button" className="btn btn-small" aria-label="Bigger terminal text" onClick={() => stepFontSize(1)}>
                A+
              </button>
            </div>
            <div className="term-details-row">{tools}</div>
            {panes}
            {browser}
          </div>
        )}
        {notes}
        {split}
        {form}
      </Panel>
    );
  }

  return (
    <Panel
      wide
      accent={agent.color}
      title={
        <div className="term-title">
          {avatar}
          <span>{agent.name}</span>
          <span className="chip" title="Their coding agent">
            ⌨️ {agentLabel(agent, settings, clis)}
          </span>
          <StatusPill status={badgeStatus(agent)} />
          {signIn && (
            <span className="chip sign-in-chip" title={`Waiting for you to sign ${signIn} in, in their terminal`}>
              🔑 needs sign-in
            </span>
          )}
          {working && agent.currentTool && <span className="chip">{toolVerb(agent.currentTool)}…</span>}
          <span className="spacer" />
          {tools}
        </div>
      }
    >
      {meta}
      {notes}
      {panes}
      {split}
      {form}
      {actions}
    </Panel>
  );
}
