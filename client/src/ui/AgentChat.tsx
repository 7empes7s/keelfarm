// An agent's chat (#120): their session as a simple conversation, the agent window's other view beside the terminal.
// The task as a short card, their words as bubbles, tool calls as plain-word steps grouped like Claude.ai ("Explored 9
// files"), each opening to its command, output or diff; milestones (pushed, PR opened with QA's live status, the verdict,
// the merge), a live working line, quick chips and reactions they understand. Items come from the office
// (shared/agentChat.ts) only while the window is open; the newest are drawn first, more on "Show earlier".
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { chatRows, statusReaction, type ChatItem, type ChatRow } from '../../../shared/agentChat';
import { STATUS_EMOJI, type AgentStatusReaction, type Reaction } from '../../../shared/reactions';
import type { AgentView, RepoView } from '../../../shared/types';
import { api } from '../api';
import { isBusy, qaKey, useStore } from '../store';
import { toolVerb } from '../world/draw';
import { prChip } from './chatMode';
import { Markdown } from './Markdown';
import { Reactable, ReactionChips } from './Reactions';
import './agentChat.css';
import { Icon } from './Icon';

/** Rows drawn at first, and how many more each "Show earlier" adds. */
const PAGE = 60;

const NONE: ChatItem[] = [];
const statusWord = (s: AgentStatusReaction) => (s === STATUS_EMOJI.seen ? 'Seen' : s === STATUS_EMOJI.working ? 'Working on it' : 'Answered');

function since(t: number | null) {
  if (!t) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function StepBody({ step }: { step: ChatItem }) {
  return (
    <div className="ac-step-body">
      <div className={`ac-step-line ${step.error ? 'ac-bad' : ''}`}>
        {step.error ? <Icon name="x" /> : step.done ? <Icon name="check" /> : '…'} {step.text}
        {step.outcome && <span className="ac-outcome"> · {step.outcome}</span>}
      </div>
      {step.error && <div className="ac-error">{step.error}</div>}
      {step.detail && <pre className="ac-pre">{step.detail}</pre>}
      {step.output && !step.error && <pre className="ac-pre ac-out">{step.output}</pre>}
    </div>
  );
}

/** `jump`: an item to scroll to and highlight once it's here (a CEO action card's message, #215). */
export function AgentChat({ agent, repo, jump, onTerminal, onSend, onStop }: { agent: Omit<AgentView, 'log'>; repo: RepoView; jump?: number; onTerminal: () => void; onSend: (text: string) => void; onStop: () => void }) {
  const items = useStore((s) => s.agentChat[agent.id]) ?? NONE;
  const qaAll = useStore((s) => s.qa);
  const [shown, setShown] = useState(PAGE);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const working = isBusy(agent);
  const statuses = useStore((s) => s.settings.statusReactions); // #193: off by default
  const rows = useMemo(() => chatRows(items), [items]);
  const visible = rows.slice(-shown);
  const last = items[items.length - 1];

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items, working]);

  const [flash, setFlash] = useState<number | null>(null);
  const jumped = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (jump === undefined || jumped.current === jump) return;
    const at = rows.findIndex((r) => r.kind !== 'steps' && r.item.id === jump);
    if (at < 0) return; // not loaded yet, or no longer kept
    if (rows.length - at > shown) return setShown(rows.length - at);
    const el = scroller.current?.querySelector(`[data-chat-id="${jump}"]`);
    if (!el) return;
    jumped.current = jump;
    stick.current = false;
    el.scrollIntoView({ block: 'center' });
    setFlash(jump);
  }, [jump, rows, shown]);

  const react = (it: ChatItem, r: Reaction) =>
    void api
      .react(agent.id, it.id, r)
      .then((res) => res.note && !res.sent && useStore.getState().pushToast('info', `${agent.name}'s session has ended, so the ${r} wasn't sent. A message picks it back up.`))
      .catch(() => undefined);

  const pull = (n: number | undefined) => (n ? repo.pulls.find((p) => p.number === n) : undefined);
  const chipFor = (n: number) => prChip(qaAll[qaKey(repo.id, n)], pull(n)?.state === 'MERGED');
  // The PR's verdict as a card at the end, once QA has one (or it merged).
  const prNumber = agent.prNumber ?? [...items].reverse().find((x) => x.milestone === 'pr')?.pr;
  const verdict = prNumber ? chipFor(prNumber) : null;

  const row = (r: ChatRow) => {
    if (r.kind === 'steps') {
      const head = r.steps[0];
      return (
        <Reactable key={`s${r.id}`} picked={head.reactions ?? []} onPick={(x) => react(head, x)} label={r.label}>
          <details className={`ac-steps ${r.failed ? 'ac-steps-bad' : ''}`}>
            <summary>
              <span className="ac-step-icon" aria-hidden>
                {r.failed ? <Icon name="x" /> : r.running ? '◌' : <Icon name="check" />}
              </span>
              <span className="ac-step-label">{r.label}</span>
            </summary>
            {r.steps.map((s) => (
              <StepBody key={s.id} step={s} />
            ))}
          </details>
          <ReactionChips reactions={head.reactions} />
        </Reactable>
      );
    }
    const it = r.item;
    if (it.kind === 'prompt') {
      return (
        <details key={it.id} className="ac-card ac-prompt">
          <summary>
            <b>
              <Icon name={agent.task === 'fix' ? 'wrench' : agent.task === 'qa' ? 'search' : 'clipboard-list'} /> {agent.task === 'fix' ? 'Fix' : agent.task === 'qa' ? 'Test' : 'Task'}
            </b> <span className="ac-prompt-line">{it.text.split('\n').find((l) => l.trim())}</span>
          </summary>
          <pre className="ac-pre">{it.text}</pre>
        </details>
      );
    }
    if (it.kind === 'manager') {
      const st = statusReaction(items, items.indexOf(it), working);
      return (
        <div key={it.id} className={`ac-me ${flash === it.id ? 'ac-flash' : ''}`} data-chat-id={it.id}>
          <div className="ac-bubble ac-bubble-me">
            {it.who && it.who !== 'Manager' && <div className="ac-who">{it.who}</div>}
            {it.text}
          </div>
          {statuses && <ReactionChips status={st} statusLabel={`${agent.name}: ${statusWord(st)}`} />}
        </div>
      );
    }
    if (it.kind === 'milestone') {
      const chip = it.pr ? chipFor(it.pr) : null;
      return (
        <div key={it.id} className="ac-card ac-milestone">
          <Icon name={it.milestone === 'pr' ? 'git-merge' : 'arrow-up'} />
          {it.url ? (
            <a href={it.url} target="_blank" rel="noopener noreferrer">
              {it.text}
            </a>
          ) : (
            <span>{it.text}</span>
          )}
          {chip && <span className={`ac-chip ac-chip-${chip.tone}`}><Icon name={chip.icon} /> {chip.label}</span>}
        </div>
      );
    }
    return (
      <Reactable key={it.id} picked={it.reactions ?? []} onPick={(x) => react(it, x)} label="their message">
        <div className="ac-bubble">
          <Markdown text={it.text} />
        </div>
        <ReactionChips reactions={it.reactions} />
      </Reactable>
    );
  };

  const prUrl = prNumber ? pull(prNumber)?.url : undefined;
  return (
    <div className="ac">
      <div
        className="ac-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {rows.length > shown && (
          <button type="button" className="btn btn-small btn-ghost ac-earlier" onClick={() => setShown(shown + PAGE)}>
            Show earlier ({rows.length - shown})
          </button>
        )}
        {!items.length && <p className="muted ac-empty">{working ? `${agent.name} is starting; their steps show here as they go.` : `Nothing yet. Give ${agent.name} an issue and their work shows here as a conversation.`}</p>}
        {visible.map(row)}
        {verdict?.verdict && (
          <div className={`ac-card ac-milestone ac-verdict ac-verdict-${verdict.tone}`} role="status">
            <Icon name={verdict.icon} />
            <span>
              PR #{prNumber}: {verdict.label}
            </span>
          </div>
        )}
        {working && (
          <div className="ac-live" role="status" aria-live="polite">
            <span className="ac-dot" aria-hidden />
            {last?.kind === 'step' && !last.done ? last.text : agent.currentTool ? toolVerb(agent.currentTool) : 'Thinking…'} · {since(agent.startedAt)}
          </div>
        )}
      </div>
      <div className="ac-chips" role="group" aria-label="Quick actions">
        {working && (
          <>
            <button type="button" className="btn btn-small" title={`Stop ${agent.name} (asks first)`} onClick={onStop}>
              <Icon name="square" /> Stop
            </button>
            <button type="button" className="btn btn-small" onClick={() => onSend("What's your status? One or two lines.")}>
              Ask for status
            </button>
          </>
        )}
        {prUrl && (
          <a className="btn btn-small" href={prUrl} target="_blank" rel="noopener noreferrer">
            Open PR #{prNumber}
          </a>
        )}
        <button type="button" className="btn btn-small btn-ghost" onClick={onTerminal}>
          Open terminal
        </button>
      </div>
    </div>
  );
}
