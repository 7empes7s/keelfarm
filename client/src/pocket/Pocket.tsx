// Pocket mode (docs/pocket.md): the office as a 2D app for a phone or any touch screen, on the same store, snapshot
// and REST as the 3D office. Five tabs: Company (each floor's pipeline), Chat (the CEO), Kanban, Team and Approvals,
// and ⚙️ for the manager's console (PocketConsole.tsx). Nothing 3D loads here until "Open the 3D office".
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { agentsOnRepo, kanbanFor, unreadMessages, useStore } from '../store';
import { CEO_ID } from '../../../shared/types';
import { officeUpdateChip } from '../officeUpdate';
import { KanbanView } from '../ui/KanbanView';
import { Panel } from '../ui/Panel';
import { Chat } from '../ui/Phone';
import { setMode, useMode } from './mode';
import { approvalsBadge, pipelineOf, waitingOnYou, type Pipeline } from './pocketData';
import { Approvals } from './PocketApprovals';
import { Team } from './PocketTeam';
import { UsageBars } from '../ui/UsageBars';
import type { ConsoleSection } from './PocketConsole';
import { parseHash } from '../ui/consoleNav';
import type { HistoryFocus } from '../ui/HistoryTab';
import { NoticeBell, NoticeCentre, NoticeToasts } from '../ui/Notices';
import './pocket.css';

// Opened from the Team and Kanban tabs; loaded when first opened (the terminal brings xterm.js).
const TerminalView = lazy(() => import('../ui/TerminalView').then((m) => ({ default: m.TerminalView })));
const AppViewer = lazy(() => import('../ui/AppViewer').then((m) => ({ default: m.AppViewer })));
const CardView = lazy(() => import('../ui/CardView').then((m) => ({ default: m.CardView })));
// The console's tabs, loaded when ⚙️ is first opened.
const PocketConsole = lazy(() => import('./PocketConsole').then((m) => ({ default: m.PocketConsole })));

export type PocketTab = 'company' | 'chat' | 'kanban' | 'team' | 'approvals';
const TABS: PocketTab[] = ['company', 'chat', 'kanban', 'team', 'approvals'];

/** The tab a link (a notification's ?tab=) asks for. */
function tabFrom(url: string | null | undefined): PocketTab | null {
  const t = url ? new URL(url, location.origin).searchParams.get('tab') : null;
  return TABS.includes(t as PocketTab) ? (t as PocketTab) : null;
}

const name = (fullName: string) => fullName.split('/')[1] ?? fullName;

function openOffice() {
  useStore.getState().openOverlay(null);
  setMode('office');
}

// ---------- company ----------

const STAGES: [keyof Pipeline, string, string][] = [
  ['building', '🔨', 'Building'],
  ['qa', '🔍', 'QA'],
  ['fixing', '🔧', 'Fixing'],
  ['ready', '✅', 'Ready'],
  ['needsYou', '⚠️', 'Needs you'],
];

function Banners() {
  const connected = useStore((s) => s.connected);
  const loaded = useStore((s) => s.loaded);
  const usage = useStore((s) => s.usage);
  const update = useStore((s) => (s.restarting ? '⟳ The office is restarting…' : officeUpdateChip(s.officeUpdate)));
  const closedLast = useMode((s) => s.closedLast);
  const until = usage.until ? new Date(usage.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  return (
    <>
      {closedLast && (
        <div className="pk-banner pk-banner-bad" role="alert">
          The 3D office closed last time: {closedLast}.{' '}
          <button className="btn btn-ghost btn-small" onClick={() => useMode.setState({ closedLast: null })}>
            OK
          </button>
        </div>
      )}
      {!connected && <div className="pk-banner pk-banner-bad">{loaded ? '📡 Reconnecting to the office…' : '📡 Connecting to the office…'}</div>}
      {usage.state === 'paused' && <div className="pk-banner pk-banner-bad">⏸ Claude's usage limit was reached: no new work starts{until ? ` until ${until}` : ''}.</div>}
      {usage.state === 'pacing' && <div className="pk-banner">🐢 Pacing new work after a usage warning{until ? ` until ${until}` : ''}.</div>}
      {update && <div className="pk-banner">{update}</div>}
    </>
  );
}

function Company({ go, settings }: { go: (tab: PocketTab, repoId?: string) => void; settings: (section: ConsoleSection) => void }) {
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const qa = useStore((s) => s.qa);
  const requests = useStore((s) => s.requests);
  const ceoInfo = useStore((s) => s.ceo);
  const demo = useStore((s) => s.demo);
  const publicDemo = useStore((s) => s.publicDemo);
  const version = useStore((s) => s.version);
  const ceo = agents[CEO_ID];
  const floors = useMemo(
    () =>
      repos.map((repo) => {
        const team = agentsOnRepo(agents, repo.id);
        return { repo, team: team.length, busy: team.filter((a) => a.status === 'working' || a.status === 'preparing').length, p: pipelineOf(kanbanFor(repo, team, qa)) };
      }),
    [repos, agents, qa],
  );
  const waiting = approvalsBadge(waitingOnYou(repos, qa, requests));
  return (
    <div className="pk-page">
      <Banners />
      {waiting > 0 && (
        <button className="pk-callout" onClick={() => go('approvals')}>
          <span>
            ⚠️ <b>{waiting}</b> decision{waiting === 1 ? '' : 's'} waiting on you
          </span>
          <span>Approvals →</span>
        </button>
      )}
      <button className="pk-card pk-usage" onClick={() => settings('ops')} title="Open Mission control">
        <b className="small">🤖 Claude usage</b>
        <UsageBars />
      </button>
      {ceo && (
        <div className="pk-card pk-ceo">
          <span className="avatar" style={{ background: ceo.color }}>
            {ceo.name[0]}
          </span>
          <div className="grow">
            <b>{ceo.name}</b> <span className="muted small">CEO</span>
            <div className="small">{ceo.status === 'working' ? (ceoInfo.job?.label ?? 'Working') : ceoInfo.queue.length ? `Next: ${ceoInfo.queue[0].label}` : 'Free'}</div>
          </div>
          <button className="btn btn-small" onClick={() => go('chat')}>
            💬 Chat
          </button>
        </div>
      )}
      {floors.length === 0 && <p className="muted">No projects yet.</p>}
      <button className="btn pk-wide" onClick={() => settings('floors')}>
        ➕ Move in a project
      </button>
      {floors.map(({ repo, team, busy, p }) => (
        <div key={repo.id} className="pk-card pk-floor" style={{ ['--accent' as string]: repo.color }}>
          <div className="pk-floor-head">
            <span className="floor-badge">{repo.floor}</span>
            <div className="grow">
              <b className="pk-floor-name">{name(repo.fullName)}</b>
              <div className="muted small pk-ellipsis">{repo.summary || repo.description || repo.fullName}</div>
            </div>
            <button className="pk-icon-btn pk-floor-settings" onClick={() => settings('floors')} aria-label={`Floor ${repo.floor} settings`} title="Floor settings">
              ⚙️
            </button>
          </div>
          <div className="pk-pipeline" role="list" aria-label={`Floor ${repo.floor} pipeline`}>
            {STAGES.map(([k, icon, label]) => (
              <div key={k} role="listitem" className={`pk-stage ${p[k] ? '' : 'pk-stage-zero'} ${k === 'needsYou' && p[k] ? 'pk-stage-hot' : ''}`}>
                <span className="pk-stage-n">
                  <span className="pk-stage-icon" aria-hidden>
                    {icon}
                  </span>
                  {p[k]}
                </span>
                <span className="pk-stage-label">{label}</span>
              </div>
            ))}
          </div>
          <div className="pk-floor-foot small">
            <span className="muted">
              👥 {team} · {busy} busy · 📋 {p.backlog} in backlog
            </span>
            <span className="spacer" />
            <button className="btn btn-small" onClick={() => go('kanban', repo.id)}>
              Board
            </button>
            <button className="btn btn-small" onClick={() => go('team', repo.id)}>
              Team
            </button>
          </div>
        </div>
      ))}
      <button className="btn pk-wide" onClick={openOffice}>
        🏢 Open the 3D office
      </button>
      {demo && <div className="pk-center small muted">{publicDemo ? `Demo office · resets every ${publicDemo.resetHours} h` : 'DEMO MODE: fake repos, fake agents'}</div>}
      {version && <div className="pk-center small muted">cubefarm {version}</div>}
    </div>
  );
}

// ---------- kanban ----------

function Board({ repoId, pick }: { repoId: string | null; pick: (id: string) => void }) {
  const repos = useStore((s) => s.repos);
  const id = repos.some((r) => r.id === repoId) ? repoId! : repos[0]?.id;
  if (!id) return <p className="muted pk-page">No projects yet.</p>;
  return (
    <div className="pk-page">
      {repos.length > 1 && (
        <div className="pk-chips" role="tablist" aria-label="Floor">
          {repos.map((r) => (
            <button key={r.id} role="tab" aria-selected={r.id === id} className={`pk-chip ${r.id === id ? 'pk-chip-on' : ''}`} style={{ ['--accent' as string]: r.color }} onClick={() => pick(r.id)}>
              {r.floor} · {name(r.fullName)}
            </button>
          ))}
        </div>
      )}
      <KanbanView key={id} repoId={id} embedded />
    </div>
  );
}

// ---------- the shell ----------

/** Panels the tabs (and the chat's chips) open over the page: an agent's terminal, a floor's app and a card. */
function PocketOverlay() {
  const overlay = useStore((s) => s.overlay);
  if (overlay?.kind === 'terminal' && overlay.agentId !== CEO_ID) return <TerminalView agentId={overlay.agentId} />;
  if (overlay?.kind === 'app') return <AppViewer repoId={overlay.repoId} pr={overlay.pr} qa={overlay.qa} />;
  if (overlay?.kind === 'card') return <CardView repoId={overlay.repoId} cardKey={overlay.key} number={overlay.number} pr={overlay.pr} />;
  if (overlay?.kind === 'notices') return <NoticeCentre />;
  return null;
}

function Settings({ section, pick, onClose, history }: { section: ConsoleSection; pick: (s: ConsoleSection) => void; onClose: () => void; history?: HistoryFocus }) {
  return (
    <Panel title="⚙️ Settings" onClose={onClose} className="pk-settings ds-console">
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <PocketConsole section={section} pick={pick} history={history} />
      </Suspense>
    </Panel>
  );
}

export default function Pocket() {
  const [tab, setTab] = useState<PocketTab>(() => tabFrom(location.href) ?? 'company');
  const [repoId, setRepoId] = useState<string | null>(null);
  const [settings, setSettings] = useState<ConsoleSection | null>(() => parseHash(location.hash, 'pocket')?.id ?? null); // #settings/cloud-agents opens that section
  const company = useStore((s) => s.settings.companyName);
  const loaded = useStore((s) => s.loaded);
  const setupDone = useStore((s) => s.settings.setupDone);
  const unread = useStore((s) => unreadMessages(s.messages, s.phoneReadAt));
  const waiting = useStore((s) => approvalsBadge(waitingOnYou(s.repos, s.qa, s.requests)));
  const ceoName = useStore((s) => s.agents[CEO_ID]?.name ?? 'CEO');
  const usage = useStore((s) => s.usage.state);
  const publicDemo = useStore((s) => s.publicDemo);
  const connected = useStore((s) => s.connected);
  const [chatTools, setChatTools] = useState<HTMLElement | null>(null); // the chat's buttons, in the header (#81)

  const go = (t: PocketTab, repo?: string) => {
    if (repo) setRepoId(repo);
    setTab(t);
  };
  // A tapped notification (here, or through the service worker) opens what it's about.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const t = tabFrom((e as CustomEvent<string>).detail);
      if (t) setTab(t);
    };
    window.addEventListener('cubefarm:open', onOpen);
    return () => window.removeEventListener('cubefarm:open', onOpen);
  }, []);
  // The console's "Open the phone" (CEO tab) opens the Chat tab here. Only when the phone opens: leaving the Chat
  // tab closes it a moment later, which must not bring the Chat back.
  const phone = useStore((s) => s.overlay?.kind === 'phone');
  useEffect(() => {
    if (!phone) return;
    setSettings(null);
    setTab('chat');
  }, [phone]);
  // A floor's Kanban asked for from the console (e.g. mission control's cost lists) is the Kanban tab here.
  const kanban = useStore((s) => (s.overlay?.kind === 'kanban' ? s.overlay.repoId : null));
  useEffect(() => {
    if (!kanban) return;
    useStore.getState().openOverlay(null);
    setSettings(null);
    go('kanban', kanban);
  }, [kanban]);
  // The History asked for from an agent's desk or a PR card opens in the console here.
  const [history, setHistory] = useState<HistoryFocus | undefined>();
  const wantsHistory = useStore((s) => (s.overlay?.kind === 'manager' && s.overlay.tab === 'history' ? s.overlay : null));
  useEffect(() => {
    if (!wantsHistory) return;
    useStore.getState().openOverlay(null);
    setHistory(wantsHistory.history);
    setSettings('history');
  }, [wantsHistory]);
  // While the chat is on screen, new CEO messages don't toast (the store reads this as the phone's chat being open).
  useEffect(() => {
    const s = useStore.getState();
    if (tab === 'chat') s.openOverlay({ kind: 'phone', tab: 'chat' });
    else if (s.overlay?.kind === 'phone') s.openOverlay(null);
  }, [tab]);
  // pocket.css's icons and look apply to the whole page while pocket mode is on (dialogs and toasts included).
  useEffect(() => {
    document.documentElement.classList.add('pocket-mode');
    return () => document.documentElement.classList.remove('pocket-mode');
  }, []);
  useEffect(() => {
    document.title = `${company || 'cubefarm'} · pocket`;
    return () => void (document.title = 'cubefarm');
  }, [company]);

  const tabs: [PocketTab, string, string, number][] = [
    ['company', '📊', 'Company', 0],
    ['chat', '💬', ceoName, tab === 'chat' ? 0 : unread],
    ['kanban', '📋', 'Kanban', 0],
    ['team', '👥', 'Team', 0],
    ['approvals', '✋', 'Approvals', waiting],
  ];
  return (
    <div className="pocket ds-screen">
      <header className="pk-head">
        <span className="pk-logo" aria-hidden>
          ✻
        </span>
        <b className="pk-title">{company || 'cubefarm'}</b>
        <span className={`pk-dot ${connected ? 'pk-dot-on' : ''}`} title={connected ? 'Connected' : 'Not connected'} />
        <span className="spacer" />
        {publicDemo && tab !== 'chat' && (
          <span className="chip" title={`Demo office: it resets every ${publicDemo.resetHours} h`}>
            Demo · resets {publicDemo.resetHours} h
          </span>
        )}
        {usage !== 'normal' && (
          // On the Chat tab only its icon: the chat's buttons need the room.
          <span className="chip chip-warn" title={usage === 'paused' ? 'Paused by the usage limit' : 'Pacing new work'}>
            {usage === 'paused' ? '⏸' : '🐢'}
            <span className={tab === 'chat' ? 'sr-only' : undefined}>{usage === 'paused' ? ' paused' : ' pacing'}</span>
          </span>
        )}
        {tab === 'chat' && <div className="pk-head-tools" ref={setChatTools} />}
        {tab !== 'chat' && <NoticeBell className="pk-icon-btn" />}
        <button className="pk-icon-btn" onClick={() => setSettings('menu')} aria-label="Settings and notifications" title="Settings and notifications">
          ⚙️
        </button>
      </header>
      <main className={`pk-main ${tab === 'chat' ? 'pk-main-chat' : ''}`}>
        {loaded && !setupDone ? (
          <div className="pk-page">
            <p>The office isn't set up yet. Finish the setup in the 3D office (on a computer is easiest), then come back.</p>
            <button className="btn" onClick={openOffice}>
              🏢 Open the 3D office
            </button>
          </div>
        ) : (
          <>
            {tab === 'company' && <Company go={go} settings={setSettings} />}
            {tab === 'chat' && <Chat autoFocus={false} onFloor={(id) => go('kanban', id)} tools={chatTools} />}
            {tab === 'kanban' && <Board repoId={repoId} pick={setRepoId} />}
            {tab === 'team' && <Team focusRepo={repoId} />}
            {tab === 'approvals' && <Approvals />}
          </>
        )}
      </main>
      <nav className="pk-tabs" aria-label="Pocket office">
        {tabs.map(([k, icon, label, badge]) => (
          <button key={k} className={`pk-tab ${tab === k ? 'pk-tab-on' : ''}`} aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)}>
            <span className="pk-tab-icon">
              {icon}
              {badge > 0 && <span className="badge badge-dot">{badge}</span>}
            </span>
            <span className="pk-tab-label">{label}</span>
          </button>
        ))}
      </nav>
      <NoticeToasts max={2} />
      {settings && <Settings section={settings} pick={setSettings} onClose={() => setSettings(null)} history={history} />}
      {/* after the console, so a terminal or app opened from it shows over it */}
      <Suspense fallback={null}>
        <PocketOverlay />
      </Suspense>
    </div>
  );
}
