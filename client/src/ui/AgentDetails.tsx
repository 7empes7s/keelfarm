// The agent window's details (#117): Now (the task, its chips and steps, picking work), Profile (their career beside
// the floor's) and Setup (coding agent, model, effort, tools). A bottom sheet on phones, a side panel on computers;
// TerminalView.tsx places it.
import { useState, type ReactNode } from 'react';
import { api } from '../api';
import { useStore, type Agent } from '../store';
import type { QaView, RepoView } from '../../../shared/types';
import type { AssignChoice } from '../pocket/pocketData';
import { AgentSetup } from './AgentSettings';
import { AgentProfile } from './CareerCard';
import { copyText } from './clipboard';
import { canPickWork, taskLine, taskSteps } from './agentWindow';
import { Actions, Chip, DetailsHeader, LinkButton, Section, Stat, StatStrip } from './DetailsPage';
import { CloseButton, Icon } from './Icon';
import { TabBoundary } from './TabBoundary';

export type DetailsTab = 'now' | 'profile' | 'setup';

const TABS: [DetailsTab, string][] = [
  ['now', 'Now'],
  ['profile', 'Profile'],
  ['setup', 'Setup'],
];

interface Props {
  agent: Agent;
  repo: RepoView;
  qa: QaView | undefined;
  tab: DetailsTab;
  onTab: (t: DetailsTab) => void;
  /** Their coding agent, model and effort, as the header used to say them. */
  cli: string;
  model: string;
  effort: string;
  elapsed: string;
  choices: AssignChoice[];
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  /** The live terminal's status line, the browser pane: shown under Now. */
  live?: string;
  browser?: ReactNode;
  /** History, Follow: the actions that were top-level buttons. */
  actions: ReactNode;
  onClose: () => void;
}

export function AgentDetails(p: Props) {
  const { agent } = p;
  return (
    <div className="aw-details">
      <div className="aw-tabs">
        <div className="aw-seg" role="tablist" aria-label={`${agent.name}'s details`}>
          {TABS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={p.tab === id} onClick={() => p.onTab(id)}>
              {label}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <CloseButton className="aw-details-x" label="Close the details" onClick={p.onClose} />
      </div>
      <div className="aw-tab-body" role="tabpanel" aria-label={TABS.find(([id]) => id === p.tab)![1]}>
        <TabBoundary key={p.tab}>
          {p.tab === 'now' && <NowTab {...p} />}
          {p.tab === 'profile' && <AgentProfile agent={agent} />}
          {p.tab === 'setup' && (
            <>
              <p className="muted small aw-explain">
                <b>Coding agent</b> is the program they work in, <b>model</b> the AI behind it (bigger is smarter and costs more), <b>effort</b> how long it thinks on each step. Tools switch skills and plugins on or off for them alone.
              </p>
              <AgentSetup agent={agent} />
            </>
          )}
        </TabBoundary>
      </div>
    </div>
  );
}

function NowTab({ agent, repo, qa, cli, model, effort, elapsed, choices, busy, run, live, browser, actions }: Props) {
  const [pick, setPick] = useState('');
  const chosen = choices.find((c) => c.key === pick);
  const idle = agent.status === 'idle';
  const steps = taskSteps(agent, qa);
  const issueUrl = agent.issueNumber ? `https://github.com/${repo.fullName}/issues/${agent.issueNumber}` : null;
  const copyBranch = (b: string) => void copyText(b).then((ok) => useStore.getState().pushToast(ok ? 'success' : 'error', ok ? `Copied the branch ${b}` : "Couldn't reach the clipboard"));
  return (
    <div className="aw-now">
      <DetailsHeader eyebrow={idle ? repo.fullName : `${agent.prNumber ? `PR #${agent.prNumber}` : `Issue #${agent.issueNumber ?? '?'}`} · ${repo.fullName}`} title={taskLine(agent)} chips={qa && !idle && <Chip tone={qa.status === 'passed' ? 'good' : qa.status === 'failed' ? 'bad' : 'plain'}>QA {qa.status}{qa.round > 1 ? ` · round ${qa.round}` : ''}</Chip>}>
        {steps.length > 0 && (
          <ol className="aw-steps" aria-label="This task's steps">
            {steps.map((s, i) => (
              <li key={i} className={`aw-step aw-step-${s.state}`} aria-current={s.state === 'now' ? 'step' : undefined}>
                {s.state === 'done' ? (
                  <>
                    <Icon name="check" />{' '}
                  </>
                ) : s.state === 'now' ? (
                  <>
                    <Icon name="circle-dot" />{' '}
                  </>
                ) : (
                  ''
                )}
                {s.label}
              </li>
            ))}
          </ol>
        )}
      </DetailsHeader>
      {canPickWork(agent) && (
        <Section title="Give them work" className="aw-pick">
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
            className="ds-btn"
            disabled={busy || !chosen}
            onClick={() =>
              chosen &&
              void run(async () => {
                if (chosen.kind === 'qa') await api.sendToQa(repo.id, chosen.number, agent.id);
                else await api.assign(agent.id, chosen.number);
                setPick('');
              })
            }
          >
            {chosen?.kind === 'qa' ? (
              <>
                <Icon name="search" /> Test PR #{chosen.number}
              </>
            ) : (
              <>
                <Icon name="play" /> Start issue
              </>
            )}
          </button>
        </Section>
      )}
      <StatStrip>
        {agent.startedAt && <Stat title="Started" value={new Date(agent.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} />}
        {elapsed && <Stat title="Time" value={elapsed} />}
        <Stat title="Cost so far" value={agent.costUsd > 0 ? `≈$${agent.costUsd.toFixed(2)}` : '—'} note="API-equivalent" />
        <Stat title="Turns" value={agent.turns} />
      </StatStrip>
      <Section title="How they work">
        <div className="dp-chips">
          <Chip>
            <Icon name="keyboard" /> {cli}
          </Chip>
          <Chip>
            <Icon name="brain" /> {model}
          </Chip>
          <Chip>
            <Icon name="zap" /> {effort} effort
          </Chip>
        </div>
      </Section>
      <Actions>
        {issueUrl && !idle && <LinkButton href={issueUrl}>Issue #{agent.issueNumber} <Icon name="external-link" /></LinkButton>}
        {agent.prUrl && !idle && <LinkButton href={agent.prUrl}>PR #{agent.prNumber} <Icon name="external-link" /></LinkButton>}
        {qa?.commentUrl && !idle && <LinkButton href={qa.commentUrl}>QA report <Icon name="external-link" /></LinkButton>}
        {agent.branch && (
          <button type="button" className="ds-btn" title={`Copy ${agent.branch}`} onClick={() => copyBranch(agent.branch!)}>
            <Icon name="git-branch" /> Copy branch
          </button>
        )}
        {actions}
      </Actions>
      {live && <p className="muted small">{live}</p>}
      {browser}
    </div>
  );
}
