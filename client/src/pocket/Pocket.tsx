// Pocket mode (docs/pocket.md): the office as a 2D app for a phone or any touch screen, on the same store, snapshot
// and REST as the 3D office. Five tabs: Company (each floor's pipeline), Chat (the CEO), Kanban, Team and Approvals,
// and ⚙️ for the manager's console (PocketConsole.tsx). Nothing 3D loads here until "Open the 3D office". On a desktop
// (#104, mode.ts pickLayout) the tabs are a rail on the left, the chat a pane on the right, and the pages use the width.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { agentsOnRepo, kanbanFor, unreadMessages, useStore, type Overlay } from '../store';
import { CEO_ID } from '../../../shared/types';
import { officeUpdateChip, restartExpected } from '../officeUpdate';
import { UpdatePill } from '../ui/UpdatePill';
import { loadUpdate } from '../updateLoad';
import { BacklogBar } from '../ui/FloorProgress';
import { KanbanView } from '../ui/KanbanView';
import { FloorPicker } from '../ui/FloorPicker';
import { FloorBuilds } from '../ui/FloorBuilds';
import { CiOutageBanner } from '../ui/CiOutageBanner';
import { Panel } from '../ui/Panel';
import { Chat } from '../ui/Chat';
import { ThreadsColumn } from '../ui/ChatHistory';
import { useShowing } from '../ui/surfaces';
import { useCall } from '../ui/voiceCallStore';
import { setMode, useLayout, useMode } from './mode';
import { switchOffice, typingIn } from './switchOffice';
import { isConfirmOpen } from '../ui/Confirm';
import { useKeyName } from '../ui/controls';
import { approvalsBadge, ceoChatHint, pipelineOf, POCKET_TABS, railTabs, waitingOnYou, type Pipeline, type PocketTab } from './pocketData';
import { Approvals } from './PocketApprovals';
import { chatDecisions } from '../../../shared/decisions';
import { Team } from './PocketTeam';
import { CompanySummary } from './CompanySummary';
import type { ConsoleSection } from './PocketConsole';
import { resolve } from '../ui/consoleNavRules';
import type { HistoryFocus } from '../ui/HistoryTab';
import { EmptyState } from '../ui/EmptyState';
import { GuideCard } from '../ui/GuideCard';
import { InfoButton } from '../ui/InfoButton';
import { SearchButton, SearchPalette } from '../ui/SearchPalette';
import { useFinder } from '../ui/goTo';
import type { ScreenId } from '../ui/screenHelp';
import { NoticeBell, NoticeCentre, NoticeToasts } from '../ui/Notices';
import { QuickToggles } from '../ui/QuickToggles';
import { useChatMode } from '../ui/chatMode';
import { leaveFullFor, useChatFull, useChatFullBack } from '../ui/chatFull';
import { FullButton } from '../ui/ChatActionsSheet';
import { XLabel } from '../ui/HoverCard';
import { TourInvite, Tutorial } from '../ui/Tutorial';
import { trackFor, type Track } from '../ui/tourSteps';
import { useTour } from '../ui/tour';
import { showTab, useRouteLink } from '../routeLink';
import { linkedSection } from '../routes';
import { heldNote } from '../../../shared/health';
import { PreviewsHost, PreviewsRailButton, usePreviewsLink } from './PocketPreviews';
import { pushLayer } from '../ui/backStack';
import { markTeamLanding, pocketJump } from './pocketJump';
import { Icon, IconText } from '../ui/Icon';
import type { IconName } from '../ui/icons';
import { floorColumns, statusLine } from './companyLayout';
import { layerOf, panels, topPanel, usePanels, type PanelEntry, type Panels } from '../ui/panels';
import { DockGrip, useDockWidth } from './DockGrip';
import './pocket.css';
import './desktop.css'; // pocket.css's feature blocks (#257), in their old order
import './dockedChat.css';
import './pages.css';

// Opened from the Team and Kanban tabs; loaded when first opened (the terminal brings xterm.js).
const TerminalView = lazy(() => import('../ui/TerminalView').then((m) => ({ default: m.TerminalView })));
const CardView = lazy(() => import('../ui/CardView').then((m) => ({ default: m.CardView })));
// The console's tabs, loaded when Settings is first opened.
const PocketConsole = lazy(() => import('./PocketConsole').then((m) => ({ default: m.PocketConsole })));

const HELP: Record<Exclude<PocketTab, 'chat'>, ScreenId> = { company: 'company', kanban: 'kanban', team: 'pocket-team', approvals: 'approvals' };
const TABS: readonly PocketTab[] = POCKET_TABS;

/** The tab a link (a notification's ?tab=) asks for. */
function tabFrom(url: string | null | undefined): PocketTab | null {
  const t = url ? new URL(url, location.origin).searchParams.get('tab') : null;
  return TABS.includes(t as PocketTab) ? (t as PocketTab) : null;
}

/** Keys 1-5 (or Alt+1-5) open the tabs, in the order the bar shows them (wide, 2 opens the chat from the header). */
const TAB_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];

// The docked chat's open or hidden, remembered on this device (on wide screens; at medium widths it's a drawer).
const DOCK_KEY = 'cubefarm:pocket-chat';
function savedDock() {
  try {
    return localStorage.getItem(DOCK_KEY) !== '0';
  } catch {
    return true;
  }
}
function saveDock(open: boolean) {
  try {
    localStorage.setItem(DOCK_KEY, open ? '1' : '0');
  } catch {
    // remembered for this visit only
  }
}

/** Puts the cursor in the chat's message box (once it's on screen). */
const focusChatBox = () => setTimeout(() => document.querySelector<HTMLTextAreaElement>('.pocket .phone-chat form textarea')?.focus(), 0);

const name = (fullName: string) => fullName.split('/')[1] ?? fullName;

function openOffice() {
  useStore.getState().openOverlay(null);
  setMode('office');
}

// ---------- company ----------

const STAGES: [keyof Pipeline, IconName, string][] = [
  ['building', 'hammer', 'Building'],
  ['qa', 'search', 'QA'],
  ['fixing', 'wrench', 'Fixing'],
  ['ready', 'circle-check', 'Ready'],
  ['needsYou', 'triangle-alert', 'Needs you'],
];

/** While work waits for memory (#115): a quiet note, no sound; a tap opens Mission control (the server's health). */
function MemoryBanner({ open }: { open: () => void }) {
  const text = useStore((s) => heldNote(s.health?.heldWork));
  if (!text) return null;
  return (
    <button className="pk-banner pk-banner-tap" onClick={open} title="It starts by itself. Open Mission control">
      <span>
        <IconText text={text} />
      </span>
      <Icon name="chevron-right" />
    </button>
  );
}

function Banners({ settings }: { settings: (section: ConsoleSection) => void }) {
  const connected = useStore((s) => s.connected);
  const loaded = useStore((s) => s.loaded);
  const usage = useStore((s) => s.usage);
  const restarting = useStore((s) => s.restarting || restartExpected(s.officeUpdate));
  const update = useStore((s) => officeUpdateChip(s.officeUpdate));
  const status = statusLine({ connected, loaded, restarting, update });
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
      {status && (
        <div className="pk-status" role="status">
          <div className={`pk-banner ${status.bad ? 'pk-banner-bad' : ''}`}>
            {status.icon && <Icon name={status.icon} />} {status.text}
          </div>
        </div>
      )}
      {usage.state === 'paused' && (
        <div className="pk-banner pk-banner-bad">
          <Icon name="pause" /> Claude's usage limit was reached: no new work starts{until ? ` until ${until}` : ''}.
        </div>
      )}
      {usage.state === 'pacing' && (
        <div className="pk-banner">
          <Icon name="turtle" /> Pacing new work after a usage warning{until ? ` until ${until}` : ''}.
        </div>
      )}
      <MemoryBanner open={() => settings('ops')} />
    </>
  );
}

function Company({ go, settings, track }: { go: (tab: PocketTab, repoId?: string) => void; settings: (section: ConsoleSection) => void; track: Track }) {
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const qa = useStore((s) => s.qa);
  const requests = useStore((s) => s.requests);
  const demo = useStore((s) => s.demo);
  const publicDemo = useStore((s) => s.publicDemo);
  const version = useStore((s) => s.version);
  const floors = useMemo(
    () =>
      repos.map((repo) => {
        const team = agentsOnRepo(agents, repo.id);
        return { repo, team: team.length, busy: team.filter((a) => a.status === 'working' || a.status === 'preparing').length, p: pipelineOf(kanbanFor(repo, team, qa)) };
      }),
    [repos, agents, qa],
  );
  const [floorsWidth, setFloorsWidth] = useState(0);
  const measureFloors = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setFloorsWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const decisions = useStore((s) => s.decisions);
  const waiting = approvalsBadge(waitingOnYou(repos, qa, requests)) + chatDecisions(decisions, Date.now()).length;
  return (
    <div className="pk-page">
      <Banners settings={settings} />
      <div className="pk-company">
      <CompanySummary go={go} settings={settings}>
      {waiting > 0 && (
        <button className="pk-callout" onClick={() => go('approvals')}>
          <span className="pk-callout-icon" aria-hidden>
            <Icon name="triangle-alert" />
          </span>
          <span className="pk-callout-text">
            <b>{waiting}</b> decision{waiting === 1 ? '' : 's'} waiting on you
          </span>
          <span className="pk-callout-go">
            Approvals <Icon name="chevron-right" />
          </span>
        </button>
      )}
      <TourInvite track={track} />
      <GuideCard />
      </CompanySummary>
      <div className="pk-company-floors" ref={measureFloors} style={{ '--pk-cols': floorColumns(floorsWidth, floors.length) } as CSSProperties}>
      {floors.length === 0 && <EmptyState kind="projects" onAction={() => settings('floors')} />}
      <button className="btn pk-wide" onClick={() => settings('floors')}>
        <Icon name="plus" /> Move in a project
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
              <Icon name="settings" />
            </button>
          </div>
          <div className="pk-pipeline" role="list" aria-label={`Floor ${repo.floor} pipeline`}>
            {STAGES.map(([k, icon, label]) => (
              <div key={k} role="listitem" className={`pk-stage ${p[k] ? '' : 'pk-stage-zero'} ${k === 'needsYou' && p[k] ? 'pk-stage-hot' : ''}`}>
                <span className="pk-stage-n">
                  <span className="pk-stage-icon" aria-hidden>
                    <Icon name={icon} />
                  </span>
                  {p[k]}
                </span>
                <span className="pk-stage-label" title={label}>
                  {label}
                </span>
              </div>
            ))}
          </div>
          <BacklogBar repo={repo} onOpen={() => go('kanban', repo.id)} compact />
          <CiOutageBanner repo={repo} />
          <FloorBuilds repoId={repo.id} />
          <div className="pk-floor-foot small">
            <span className="muted pk-ellipsis" title={`${team} on this floor, ${busy} busy, ${p.backlog} in backlog`}>
              <Icon name="users" /> {team} · {busy} busy · <Icon name="clipboard-list" /> {p.backlog}
            </span>
            <span className="pk-floor-actions">
              <button className="btn btn-small" onClick={() => go('kanban', repo.id)}>
                Board
              </button>
              <button className="btn btn-small" onClick={() => go('team', repo.id)}>
                Team
              </button>
            </span>
          </div>
        </div>
      ))}
      </div>
      </div>
      <button className="btn pk-wide" onClick={openOffice}>
        <Icon name="building-2" /> Open the 3D office
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
  if (!id)
    return (
      <div className="pk-page">
        <EmptyState kind="projects" />
      </div>
    );
  return (
    <div className="pk-page">
      {repos.length > 1 && <FloorPicker repos={repos} value={id} onPick={pick} />}
      <KanbanView key={id} repoId={id} embedded />
    </div>
  );
}

// ---------- the shell ----------

/** The overlays that open in the pane: an agent's terminal, a card and the notification centre (a floor's app opens the Previews page). */
const inPane = (o: Overlay | null) => (o?.kind === 'terminal' && o.agentId !== CEO_ID) || o?.kind === 'card' || o?.kind === 'notices';

/** The pane's overlay for the panel manager (#212): its key, and what the back chip says. */
function paneEntry(o: Overlay): PanelEntry<Overlay> {
  const s = useStore.getState();
  if (o.kind === 'terminal') return { key: `terminal:${o.agentId}`, slot: 'pane', label: `${s.agents[o.agentId]?.name ?? 'Agent'}'s ${o.view === 'chat' ? 'chat' : 'window'}`, value: o };
  if (o.kind === 'card') return { key: `card:${o.repoId}:${o.key}`, slot: 'pane', label: `${o.pr ? 'PR' : 'Issue'} #${o.number}`, value: o };
  return { key: o.kind, slot: 'pane', label: 'Notifications', value: o };
}

/** A slot's place in the panel manager's order: the host's z-index wide, its panel's (pocket.css) on a phone. */
const layer = (order: Panels, slot: string) => {
  const n = layerOf(order, slot);
  return n ? { zIndex: n, ['--pk-layer' as string]: n } : undefined;
};

/** Wide, the CEO chat is a window, opened from the header like 🔔 (#214): the CEO's avatar, unread badge and a working dot. */
function ChatButton({ open, toggle }: { open: boolean; toggle: () => void }) {
  const ceo = useStore((s) => s.agents[CEO_ID]);
  const job = useStore((s) => s.ceo.job?.label);
  const unread = useStore((s) => unreadMessages(s.messages, s.phoneReadAt));
  const last = useStore((s) => s.messages.findLast((m) => m.from === 'ceo')?.text);
  const name = ceo?.name ?? 'CEO';
  const working = ceo?.status === 'working';
  return (
    <button
      data-tour="chat"
      className={`btn btn-small pk-switch pk-chat-btn ${open ? 'pk-chat-btn-on' : ''}`}
      aria-pressed={open}
      aria-label={`Chat with ${name}${unread && !open ? `, ${unread} unread` : ''}`}
      title={ceoChatHint(name, working ? (job ?? 'Working') : 'Free', last, '/')}
      onClick={toggle}
    >
      <span className="avatar pk-chat-avatar" style={{ background: ceo?.color }} aria-hidden>
        {name[0]}
        {working && <span className="pk-chat-working" />}
      </span>
      {name}
      {unread > 0 && !open && <span className="badge badge-dot">{unread}</span>}
    </button>
  );
}

/** Panels the tabs (and the chat's chips) open over the page: an agent's terminal, a floor's app and a card. */
function PocketOverlay() {
  const overlay = useStore((s) => s.overlay);
  if (overlay?.kind === 'terminal' && overlay.agentId !== CEO_ID) return <TerminalView agentId={overlay.agentId} view={overlay.view} jump={overlay.jump} details={overlay.details} profile={overlay.profile} />;
  if (overlay?.kind === 'card') return <CardView repoId={overlay.repoId} cardKey={overlay.key} number={overlay.number} pr={overlay.pr} />;
  if (overlay?.kind === 'notices') return <NoticeCentre />;
  return null;
}

function Settings({ section, pick, onClose, history, repoId, card, wide }: { section: ConsoleSection; pick: (s: ConsoleSection) => void; onClose: () => void; history?: HistoryFocus; repoId?: string; card?: string; wide: boolean }) {
  return (
    <Panel
      title={
        <>
          <Icon name="settings" /> Settings
        </>
      }
      onClose={onClose}
      className="pk-settings ds-console"
    >
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <PocketConsole section={section} pick={pick} history={history} repoId={repoId} card={card} wide={wide} />
      </Suspense>
    </Panel>
  );
}

export default function Pocket() {
  const [tab, setTab] = useState<PocketTab>(() => tabFrom(location.href) ?? 'company');
  // a tab change is a safe moment for the office's new client (#216): it opens on the tab picked
  useEffect(() => void loadUpdate({ kind: 'nav' }, () => window.history.replaceState(window.history.state, '', `?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(location.search)), tab })}`)), [tab]);
  const [repoId, setRepoId] = useState<string | null>(null);
  const [settings, setSettings] = useState<ConsoleSection | null>(() => linkedSection(location.hash, 'pocket')); // #settings/cloud-agents (or #console/…) opens that section
  const company = useStore((s) => s.settings.companyName);
  const loaded = useStore((s) => s.loaded);
  const setupDone = useStore((s) => s.settings.setupDone);
  const unread = useStore((s) => unreadMessages(s.messages, s.phoneReadAt));
  const waiting = useStore((s) => approvalsBadge(waitingOnYou(s.repos, s.qa, s.requests)) + chatDecisions(s.decisions, Date.now()).length); // + the CEO's open questions (#114)
  const ceoName = useStore((s) => s.agents[CEO_ID]?.name ?? 'CEO');
  const usage = useStore((s) => s.usage.state);
  const publicDemo = useStore((s) => s.publicDemo);
  const connected = useStore((s) => s.connected);
  const previewsOpen = useStore((s) => s.overlay?.kind === 'previews' || s.overlay?.kind === 'app');
  const [chatTools, setChatTools] = useState<HTMLElement | null>(null); // the chat's header row, in the docked chat's header (#81, #270)
  const switchKey = useKeyName('switchOffice');
  const layout = useLayout();
  const wide = layout !== 'compact';
  const track = trackFor('pocket', layout);
  // The chat beside the pages: on wide screens open unless hidden (remembered), at medium widths a drawer, closed at first.
  const [dockPref, setDockPref] = useState(savedDock);
  const [dockW, setDockW] = useDockWidth();
  // the chat's width for what opens beside the docked chat and its threads column (pocket.css, #132)
  useEffect(() => document.documentElement.style.setProperty('--pk-dock-w', `${dockW}px`), [dockW]);
  const threadsSheet = useShowing('threads'); // the column steps aside while the Threads sheet shows them (#396)
  const [drawer, setDrawer] = useState(false);
  const tucked = useCall((s) => s.chatTucked); // behind a voice call (#287)
  const dock = (layout === 'expanded' ? dockPref : layout === 'medium' && drawer) && !tucked;
  const setDock = useCallback(
    (open: boolean) => {
      if (open) useCall.setState({ chatTucked: false });
      if (layout !== 'expanded') return setDrawer(open);
      setDockPref(open);
      saveDock(open);
    },
    [layout],
  );
  // The chat full screen (#201): the docked chat over the rail and the pages, or the phone's chat without the tab bar.
  const full = useChatFull((s) => s.on) && (wide ? dock : tab === 'chat') && !(loaded && !setupDone);
  useChatFullBack(full);
  const openChat = () => {
    if (wide) setDock(true);
    else setTab('chat');
    focusChatBox();
  };
  // The tour's way back from a page it opened (#408): the tab, the console's section, the chat beside, the pane.
  const onScreen = useRef({ tab, settings, dock });
  onScreen.current = { tab, settings, dock };
  useEffect(() => {
    useTour.setState({
      keepPage: () => {
        const was = { ...onScreen.current, overlay: useStore.getState().overlay, full: useChatFull.getState().on };
        return () => {
          useChatFull.getState().set(was.full);
          setTab(was.tab);
          setSettings(was.settings);
          if (onScreen.current.dock !== was.dock) setDock(was.dock);
          useStore.getState().openOverlay(was.overlay);
        };
      },
    });
    return () => useTour.setState({ keepPage: null });
  }, [setDock]);

  // The panel manager (#212): the console and the pane in the order they were opened or touched, the top one in front.
  const order = usePanels();
  const top = topPanel(order);
  const consoleHost = useRef<HTMLDivElement>(null);
  const paneHost = useRef<HTMLDivElement>(null);
  const pane = useStore((s) => (inPane(s.overlay) ? s.overlay : null));
  useEffect(() => (pane ? panels.open(paneEntry(pane)) : panels.closeSlot('pane')), [pane]);
  useEffect(() => (settings ? panels.open({ key: 'console', slot: 'main', label: 'Console', value: settings }) : panels.closeSlot('main')), [settings]);
  useEffect(() => () => usePanels.setState({ open: [], back: null }), []);
  // What comes to the top takes the focus (Esc and Back then close it first), and the chat drawer makes way for it.
  const topKey = top?.key;
  const topSlot = top?.slot;
  useEffect(() => {
    if (!topSlot) return;
    const panel = (topSlot === 'main' ? consoleHost : paneHost).current?.querySelector<HTMLElement>('.panel');
    if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
    setDrawer(false);
  }, [topKey, topSlot]);
  const reopen = (p: PanelEntry) => (p.slot === 'main' ? setSettings(p.value as ConsoleSection) : useStore.getState().openOverlay(p.value as Overlay));
  // The rail and links to a page bring the page to the front: the console closes, and a pane covering the page too.
  const show = (t: PocketTab) => {
    if (full) leaveFullFor(wide);
    setTab(t);
    setSettings(null);
    const p = paneHost.current;
    const o = useStore.getState().overlay;
    if (o?.kind === 'previews' || o?.kind === 'app') useStore.getState().openOverlay(null); // the Previews page covers the pages
    else if (o && inPane(o) && (!wide || (p && getComputedStyle(p).position === 'absolute'))) useStore.getState().openOverlay(null);
  };
  // The rail's Console toggles it; from the full chat it shows it (#242).
  const railConsole = () => {
    if (full) leaveFullFor(wide);
    if (previewsOpen) {
      useStore.getState().openOverlay(null); // the console under the Previews page comes back
      if (settings) panels.focus('console');
      else setSettings('menu');
    } else if (!settings) setSettings('menu');
    else if (top?.slot === 'main' && !full) setSettings(null);
    else panels.focus('console');
  };
  const go = (t: PocketTab, repo?: string) => {
    if (repo) setRepoId(repo);
    show(t);
  };
  // A tapped notification (here, or through the service worker) opens what it's about.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const t = tabFrom((e as CustomEvent<string>).detail);
      if (!t) return;
      setTab(t);
      setSettings(null); // the page it's about comes to the front
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
    if (!wide) return setTab('chat');
    useStore.getState().openOverlay(null);
    setDock(true);
  }, [phone, wide, setDock]);
  // Wide, the chat isn't a tab: it's the pane beside them.
  useEffect(() => {
    if (!wide || tab !== 'chat') return;
    setTab('company');
    setDock(true);
  }, [wide, tab, setDock]);
  // A floor's Kanban asked for from the console (e.g. mission control's cost lists) is the Kanban tab here.
  const kanban = useStore((s) => (s.overlay?.kind === 'kanban' ? s.overlay.repoId : null));
  useEffect(() => {
    if (!kanban) return;
    useStore.getState().openOverlay(null);
    setSettings(null);
    setRepoId(kanban);
    setTab('kanban');
  }, [kanban]);
  // A console section asked for (the History from an agent's desk or a PR card, the search, the guide) opens in ⚙️ here.
  const [history, setHistory] = useState<HistoryFocus | undefined>();
  const [focusRepo, setFocusRepo] = useState<string | undefined>();
  const [focusCard, setFocusCard] = useState<string | undefined>(); // the card to scroll to (#404: a usage row's account)
  const wantsSection = useStore((s) => (s.overlay?.kind === 'manager' ? s.overlay : null));
  // A floor's team asked for (a chat link, #151) is the Team tab here, at that floor; from the Chat tab, with a Back to it.
  const [teamJump, setTeamJump] = useState(0);
  const [backToChat, setBackToChat] = useState(false);
  const onChat = useRef(false);
  onChat.current = tab === 'chat';
  useEffect(() => {
    if (!wantsSection) return;
    const jump = pocketJump(wantsSection, onChat.current, useStore.getState().back);
    if (jump.clearBack) useStore.setState({ back: null }); // the chat stays here, under the tab or the console
    useStore.getState().openOverlay(null);
    if (jump.to === 'team') {
      setSettings(null);
      setBackToChat(jump.backToChat);
      markTeamLanding();
      setTeamJump((n) => n + 1);
      setRepoId(jump.repoId);
      return setTab('team'); // go()'s console and overlay closing is done above
    }
    setHistory(wantsSection.history);
    setFocusRepo(wantsSection.repoId);
    setFocusCard(wantsSection.card);
    setSettings(resolve(wantsSection.tab, 'pocket')?.id ?? 'menu');
    panels.focus('console'); // already open on that section: it still comes to the front
  }, [wantsSection]);
  usePreviewsLink(loaded);
  useEffect(() => {
    if (!backToChat) return;
    if (tab !== 'team') return setBackToChat(false);
    return pushLayer(() => setTab('chat'));
  }, [backToChat, tab]);
  // The guide asked for (the search's "Get the most out of the office") is the Company tab's card.
  const guide = useFinder((s) => s.guide);
  useEffect(() => {
    if (!guide) return;
    setSettings(null);
    setTab('company');
  }, [guide]);
  // While the chat is on screen, new CEO messages don't toast (the store reads this as the phone's chat being open).
  useEffect(() => {
    const s = useStore.getState();
    if (tab === 'chat' && !wide) s.openOverlay({ kind: 'phone', tab: 'chat' });
    else if (s.overlay?.kind === 'phone') s.openOverlay(null);
  }, [tab, wide]);
  // The docked chat counts as the chat on screen too.
  useEffect(() => {
    useStore.setState({ chatDocked: wide && dock });
    return () => useStore.setState({ chatDocked: false });
  }, [wide, dock]);
  // The keyboard (#104): 1-5 the tabs, / the chat's box, Esc the chat drawer; never while typing in a field. One
  // listener for the page's life (#145: not one per render, while typing), reading this render's state.
  const keys = useRef<(e: KeyboardEvent) => void>(null);
  keys.current = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && full && !e.defaultPrevented && !isConfirmOpen()) {
      e.preventDefault();
      return useChatFull.getState().set(false);
    }
    if (e.ctrlKey || e.metaKey || e.repeat || e.defaultPrevented || typingIn(e.target) || isConfirmOpen()) return;
    const n = TAB_KEYS.indexOf(e.code);
    if (n >= 0) {
      e.preventDefault();
      if (TABS[n] === 'chat') openChat();
      else show(TABS[n]);
    } else if (e.key === '/' && !e.altKey) {
      e.preventDefault();
      openChat();
    } else if (e.key === 'Escape' && layout === 'medium' && dock && !settings && !useStore.getState().overlay) {
      setDock(false);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current?.(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => showTab(tab), [tab]);
  useRouteLink('pocket'); // deep links (#413), after the listeners above
  // pocket.css's icons and look apply to the whole page while pocket mode is on (dialogs and toasts included).
  useEffect(() => {
    document.documentElement.classList.add('pocket-mode');
    return () => document.documentElement.classList.remove('pocket-mode');
  }, []);
  useEffect(() => {
    document.title = `${company || 'cubefarm'} · pocket`;
    return () => void (document.title = 'cubefarm');
  }, [company]);

  const entries: Record<PocketTab, [IconName, string, number]> = {
    company: ['chart-column', 'Company', 0],
    chat: ['message-circle', ceoName, tab === 'chat' ? 0 : unread],
    kanban: ['clipboard-list', 'Kanban', 0],
    team: ['users', 'Team', 0],
    approvals: ['hand', 'Approvals', waiting],
  };
  // on a phone the chat's buttons sit in its own bar by the CEO's name: the header's row has no room for them and the name
  const chatMode = useChatMode();
  const chat = <Chat autoFocus={false} onFloor={(id) => go('kanban', id)} tools={wide ? chatTools : undefined} fullButton={wide} away={!wide && tab !== 'chat'} />;
  return (
    <div className={`pocket ds-screen pk-layout-${layout} ${wide ? 'pk-railed' : ''} ${full ? 'pk-chat-full' : ''}`}>
      <header className="pk-head">
        <span className="pk-logo" aria-hidden>
          <Icon name="asterisk" />
        </span>
        <b className="pk-title">{company || 'cubefarm'}</b>
        <span className={`pk-dot ${connected ? 'pk-dot-on' : ''}`} title={connected ? 'Connected' : 'Not connected'} />
        {wide && order.back && (
          <button className="btn btn-small pk-back-chip" onClick={() => reopen(order.back!)} title={`Back to ${order.back.label}`}>
            <Icon name="chevron-left" /> <span className="pk-ellipsis">{order.back.label}</span>
          </button>
        )}
        <span className="spacer" />
        {publicDemo && tab !== 'chat' && (
          <span className="chip" title={`Demo office: it resets every ${publicDemo.resetHours} h`}>
            Demo · resets {publicDemo.resetHours} h
          </span>
        )}
        {usage !== 'normal' && (
          // Only its icon: the header's buttons need the room (the Company tab's banner says it in words).
          <span className="chip chip-warn" title={usage === 'paused' ? 'Paused by the usage limit' : 'Pacing new work'}>
            <Icon name={usage === 'paused' ? 'pause' : 'turtle'} />
            <span className="sr-only">{usage === 'paused' ? ' paused' : ' pacing'}</span>
          </span>
        )}
        <UpdatePill className="btn btn-small btn-good pk-update" short={!wide} />
        {/* the chat has its own 🔍 (its conversations); Ctrl+K and the other tabs reach this one */}
        {(tab !== 'chat' || wide) && <SearchButton className="pk-icon-btn" />}
        {(wide || tab !== 'chat') && <NoticeBell className="pk-icon-btn" />}
        <QuickToggles className="pk-icon-btn" compact={!wide} />
        {tab !== 'chat' && <InfoButton screen={HELP[tab]} className="pk-icon-btn" />}
        {/* a phone's chat header has no room: its ⛶ sits here (#201) */}
        {!wide && tab === 'chat' && <FullButton />}
        {wide && (
          <button className="btn btn-small pk-switch" aria-pressed={chatMode.on} onClick={() => chatMode.set(!chatMode.on)} title={`Chat mode (#120): agents' windows open on their ${chatMode.on ? 'chat' : 'terminal'}. Click to switch`}>
            <Icon name="message-circle" /> Chat {chatMode.on ? 'on' : 'off'}
          </button>
        )}
        {wide && <ChatButton open={dock} toggle={() => setDock(!dock)} />}
        {wide ? (
          <button data-tour="switch" className="btn btn-small pk-switch" onClick={switchOffice} title={`Walk around the 3D office (${switchKey})`}>
            <Icon name="building-2" /> 3D office <kbd>{switchKey}</kbd>
          </button>
        ) : (
          <button data-tour="console" className="pk-icon-btn xbtn" onClick={() => setSettings('menu')} aria-label="Settings and notifications" title="Settings and notifications">
            <Icon name="settings" />
            <XLabel text="Settings" />
          </button>
        )}
      </header>
      <NoticeToasts max={2} />
      <div className="pk-body">
        <nav className="pk-tabs" aria-label="Pocket office" data-tour="pocket-tabs">
          {railTabs(layout).map((k) => {
            const [icon, label, badge] = entries[k];
            const on = tab === k && !previewsOpen; // the Previews page covers the tab
            return (
              <button
                key={k}
                data-tour={k === 'chat' ? 'chat' : undefined}
                className={`pk-tab ${on ? 'pk-tab-on' : ''}`}
                aria-current={on ? 'page' : undefined}
                title={wide ? `${label} (${TABS.indexOf(k) + 1})` : undefined}
                onClick={() => show(k)}
              >
                <span className="pk-tab-icon">
                  <Icon name={icon} />
                  {badge > 0 && <span className="badge badge-dot">{badge}</span>}
                </span>
                <span className="pk-tab-label">{label}</span>
              </button>
            );
          })}
          {wide && <PreviewsRailButton open={previewsOpen} />}
          {wide && (
            <button data-tour="console" className={`pk-tab pk-tab-console ${settings && !previewsOpen ? 'pk-tab-on' : ''}`} aria-pressed={!!settings && !previewsOpen} onClick={railConsole} title="Settings and notifications">
              <span className="pk-tab-icon">
                <Icon name="settings" />
              </span>
              <span className="pk-tab-label">Console</span>
            </button>
          )}
        </nav>
        <div className={`pk-work ${settings ? 'pk-work-console' : ''}`}>
          <main className={`pk-main ${tab === 'chat' ? 'pk-main-chat' : ''}`} data-tab={tab}>
            {loaded && !setupDone ? (
              <div className="pk-page">
                <p>The office isn't set up yet. Finish the setup in the 3D office (on a computer is easiest), then come back.</p>
                <button className="btn" onClick={openOffice}>
                  <Icon name="building-2" /> Open the 3D office
                </button>
              </div>
            ) : (
              <>
                {tab === 'company' && <Company go={go} settings={setSettings} track={track} />}
                {/* drawn and laid out while away (#145), as iOS keeps a tab: opening it only shows it */}
                {!wide && (
                  <div className={tab === 'chat' ? 'pk-chat-tab' : 'pk-chat-tab pk-chat-away'} inert={tab !== 'chat'}>
                    {chat}
                  </div>
                )}
                {tab === 'kanban' && <Board repoId={repoId} pick={setRepoId} />}
                {tab === 'team' && (
                  <Team
                    focusRepo={repoId}
                    flash={teamJump}
                    top={
                      <>
                        {backToChat && (
                          <div className="pk-back-bar">
                            <button className="btn btn-ghost cn-back" onClick={() => setTab('chat')} aria-label="Back to the chat">
                              <Icon name="chevron-left" /> Chat
                            </button>
                          </div>
                        )}
                        <MemoryBanner open={() => setSettings('ops')} />
                      </>
                    }
                  />
                )}
                {tab === 'approvals' && <Approvals wide={layout === 'expanded'} />}
              </>
            )}
          </main>
          {/* wide, the console takes the pages' place and a terminal, app or card opens beside them; on a phone both are full-screen panels */}
          <div ref={consoleHost} className="pk-console-host" style={layer(order, 'main')} onFocus={() => panels.focus('console')}>
            {settings && <Settings section={settings} pick={setSettings} onClose={() => setSettings(null)} history={history} repoId={focusRepo} card={focusCard} wide={wide} />}
          </div>
          {/* the Previews page takes everything beside the chat, over the console it may have been opened from */}
          <div className="pk-page-host">
            <Suspense fallback={null}>
              <PreviewsHost />
            </Suspense>
          </div>
          {/* beside the console when there's room, else over it: whichever was opened or touched last is in front */}
          <div ref={paneHost} className="pk-pane" style={layer(order, 'pane')} onFocus={() => pane && panels.focus(paneEntry(pane).key)}>
            <Suspense fallback={null}>
              <PocketOverlay />
            </Suspense>
          </div>
        </div>
        {wide && dock && (
          <aside className={`pk-dock ${layout === 'expanded' ? 'pk-dock-threads' : ''}`} aria-label={`Chat with ${ceoName}`} style={{ ['--pk-dock-w' as string]: `${dockW}px` }}>
            {layout === 'expanded' && !full && <DockGrip width={dockW} onWidth={setDockW} />}
            {/* one row (#270): the chat draws who and its tools here, its own header row hidden */}
            <div className="pk-dock-head">
              <div className="pk-head-tools pk-dock-chat" ref={setChatTools} />
              <button className="pk-icon-btn pk-dock-x xbtn" onClick={() => setDock(false)} aria-label="Hide the chat" title={layout === 'medium' ? 'Hide the chat (Esc)' : 'Hide the chat'}>
                <Icon name="x" />
                <XLabel text="Hide the chat" keys={layout === 'medium' ? 'Esc' : undefined} />
              </button>
            </div>
            {/* wide, the threads in a column beside the chat, and what it opens beside them (#132) */}
            <div className="pk-dock-body">
              {layout === 'expanded' && <ThreadsColumn ceoName={ceoName} hidden={threadsSheet} />}
              {chat}
            </div>
          </aside>
        )}
      </div>
      <SearchPalette where="pocket" />
      <Tutorial track={track} />
    </div>
  );
}
