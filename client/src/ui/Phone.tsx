import { useEffect, useMemo, useRef, useState } from 'react';
import { floorPrCounts, isBusy, pendingRequests, unreadMessages, useStore, type PhoneTab } from '../store';
import { CEO_ID } from '../../../shared/types';
import { backdropClose, closeOverlay, useBackLayer } from './Panel';
import { useDialogFocus } from './dialogFocus';
import { isKey } from './controls';
import { Key } from './Key';
import { Games, type GameId } from './games/Games';
import { HolidayStrip } from './HolidayStrip';
import { Chat } from './Chat';
import { LobbyNudge, TeamChanges } from './TeamChanges';
import { clock } from './phoneParts';
import { useMode } from '../pocket/mode';
import { useChatFull, useChatFullBack } from './chatFull';
import { CloseButton, Icon } from './Icon';
import type { IconName } from './icons';

// The manager's phone: text the CEO, decide on team changes, see the whole company at a glance
// without walking anywhere, and play a game while the team works. Press P anywhere in the office.

// ---------- company at a glance ----------

function useCompany() {
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const qa = useStore((s) => s.qa);
  const requests = useStore((s) => s.requests);
  const settings = useStore((s) => s.settings);
  const info = useStore((s) => s.ceo);
  return useMemo(() => {
    const staff = Object.values(agents).filter((a) => a.role !== 'ceo');
    const ceo = agents[CEO_ID];
    const running = Object.values(agents).filter(isBusy).length;
    const floors = repos.map((r) => {
      const team = staff.filter((a) => a.repoId === r.id);
      const counts = floorPrCounts(r, qa);
      return {
        repo: r,
        team: team.length,
        working: team.filter(isBusy).length,
        idle: team.filter((a) => !isBusy(a)).length,
        issues: r.issues.length,
        prs: r.pulls.filter((p) => p.state === 'OPEN').length,
        inQa: counts.inQa,
        ready: counts.ready,
        stuck: counts.needsYou,
        merged: r.pulls.filter((p) => p.state === 'MERGED').length,
      };
    });
    const sum = (k: 'issues' | 'prs' | 'ready' | 'stuck' | 'inQa') => floors.reduce((n, f) => n + f[k], 0);
    const pending = pendingRequests(requests).length;

    // The report: a few plain sentences, most urgent first.
    const report: { icon: IconName; text: string; tone?: 'good' | 'warn' }[] = [];
    const readyList = floors.filter((f) => f.ready > 0);
    if (readyList.length)
      report.push({
        icon: 'circle-check',
        text: `${sum('ready')} pull request${sum('ready') === 1 ? ' passed' : 's passed'} QA and ${sum('ready') === 1 ? 'is' : 'are'} ready for you to merge (${readyList.map((f) => `${f.repo.fullName.split('/')[1]}: ${f.ready}`).join(', ')}).`,
        tone: 'good',
      });
    if (sum('stuck')) report.push({ icon: 'triangle-alert', text: `${sum('stuck')} pull request${sum('stuck') === 1 ? '' : 's'} need${sum('stuck') === 1 ? 's' : ''} your call: the team can't move ${sum('stuck') === 1 ? 'it' : 'them'} on alone.`, tone: 'warn' });
    if (pending) report.push({ icon: 'users', text: `${pending} team change${pending === 1 ? ' is' : 's are'} waiting in Team.`, tone: 'warn' });
    report.push({
      icon: 'settings',
      text: settings.sessionLimit
        ? running
          ? `${running} of ${settings.sessionLimit} session slots are busy right now.`
          : `Nobody is working at the moment (${settings.sessionLimit} session slots free).`
        : running
          ? `${running} session${running === 1 ? ' is' : 's are'} running right now.`
          : 'Nobody is working at the moment.',
    });
    for (const f of floors) {
      if (f.issues > 0 && !f.repo.autoAssign && f.working === 0 && f.idle > 0) {
        report.push({ icon: 'moon', text: `${f.repo.fullName.split('/')[1]} has ${f.issues} open issue${f.issues === 1 ? '' : 's'} and free agents, but auto-assign is off.` });
      }
    }
    const busiest = [...floors].sort((a, b) => b.issues + b.prs - (a.issues + a.prs))[0];
    if (busiest && busiest.issues + busiest.prs > 0 && floors.length > 1) {
      report.push({ icon: 'flame', text: `Most work in flight: ${busiest.repo.fullName.split('/')[1]} (${busiest.issues} issues, ${busiest.prs} PRs).` });
    }
    if (ceo) {
      report.push({
        icon: 'brain',
        text:
          ceo.status === 'working'
            ? `${ceo.name} is ${(info.job?.label ?? 'working').replace(/^\w/, (c) => c.toLowerCase())}.`
            : info.nextReviewAt
              ? `${ceo.name} reviews the company next at ${clock(info.nextReviewAt)}.`
              : `${ceo.name}'s periodic reviews are off.`,
      });
    }
    if (floors.length === 0) report.splice(0, report.length, { icon: 'hand', text: "No projects yet. Connect a repo in the manager's office (lobby, back left) and the CEO will staff it." });
    return { floors, staff: staff.length, running, max: settings.sessionLimit, issues: sum('issues'), prs: sum('prs'), report };
  }, [repos, agents, qa, requests, settings, info]);
}

/** Every panel, a key press away: the phone is where keyboard and screen reader users reach the rest of the office. */
function Shortcuts() {
  const openOverlay = useStore((s) => s.openOverlay);
  const repoId = useStore((s) => s.repos.find((r) => r.floor === s.floor)?.id);
  const office = useMode((s) => s.mode === 'office'); // the map room is 3D: pocket mode has the 2D map
  return (
    <nav className="phone-links" aria-label="Open a panel">
      <button className="btn btn-small" onClick={() => openOverlay({ kind: 'manager' })}>
        <Icon name="briefcase-business" /> Console
      </button>
      {repoId && (
        <button className="btn btn-small" onClick={() => openOverlay({ kind: 'kanban', repoId })}>
          <Icon name="clipboard-list" /> Kanban
        </button>
      )}
      <button className="btn btn-small" onClick={() => openOverlay({ kind: 'floorList' })}>
        <Icon name="users" /> Floor list
      </button>
      {office && (
        <button className="btn btn-small" onClick={() => openOverlay({ kind: 'mapRoom' })}>
          <Icon name="orbit" /> Map room
        </button>
      )}
      <button className="btn btn-small" onClick={() => openOverlay({ kind: 'help' })}>
        <Icon name="circle-help" /> Help
      </button>
      <button className="btn btn-small" onClick={() => openOverlay({ kind: 'manager', tab: 'access' })}>
        <Icon name="accessibility" /> Accessibility
      </button>
    </nav>
  );
}

function Company() {
  const c = useCompany();
  const goToFloor = useStore((s) => s.goToFloor);
  const tiles: [IconName, string | number, string][] = [
    ['building-2', c.floors.length, c.floors.length === 1 ? 'project' : 'projects'],
    ['clipboard-list', c.issues, 'open issues'],
    ['git-merge', c.prs, 'open PRs'],
    ['users', c.staff, 'on staff'],
    ['settings', c.max ? `${c.running}/${c.max}` : `${c.running}`, 'working now'],
  ];
  return (
    <div className="phone-scroll">
      <div className="tiles">
        {tiles.map(([icon, value, label]) => (
          <div key={label} className="tile">
            <div className="tile-value"><Icon name={icon} /> {value}</div>
            <div className="tile-label">{label}</div>
          </div>
        ))}
      </div>
      <Shortcuts />
      <h3 className="phone-h">Today's report</h3>
      <ul className="report">
        {c.report.map((r, i) => (
          <li key={i} className={r.tone ? `report-${r.tone}` : ''}>
            <span><Icon name={r.icon} /></span>
            <span>{r.text}</span>
          </li>
        ))}
      </ul>
      {c.floors.length > 0 && <h3 className="phone-h">Projects</h3>}
      {c.floors.map((f) => (
        <div key={f.repo.id} className="proj" style={{ ['--accent' as string]: f.repo.color }}>
          <div className="row">
            <span className="floor-badge">{f.repo.floor}</span>
            <div className="grow" style={{ minWidth: 0 }}>
              <b className="proj-name">{f.repo.fullName.split('/')[1]}</b>
              <div className="muted small proj-sum">{f.repo.summary || f.repo.description || f.repo.fullName}</div>
            </div>
            <button className="btn btn-small" onClick={() => goToFloor(f.repo.floor)}>
              Go
            </button>
          </div>
          <div className="proj-stats small">
            <span>
              <Icon name="users" /> {f.team}
              {f.working ? ` (${f.working} busy)` : ''}
            </span>
            <span><Icon name="clipboard-list" /> {f.issues}</span>
            <span><Icon name="search" /> {f.inQa}</span>
            <span className={f.ready ? 'proj-ready' : ''}><Icon name="circle-check" /> {f.ready}</span>
            <span><Icon name="party-popper" /> {f.merged}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- the phone ----------

// Put the phone away mid-game and it opens on that (paused) game next time, unless something new came in meanwhile.
let resumeGames: { game: GameId | null; waiting: number } | null = null;

const waitingNow = () => {
  const s = useStore.getState();
  return pendingRequests(s.requests).length + unreadMessages(s.messages, s.phoneReadAt);
};

export function Phone({ tab: initialTab, requestId }: { tab?: PhoneTab; requestId?: string }) {
  const [tab, setTab] = useState<PhoneTab>(() =>
    resumeGames && !requestId && waitingNow() <= resumeGames.waiting ? 'games' : (initialTab ?? (requestId ? 'hires' : 'chat')),
  );
  const [game, setGame] = useState<GameId | null>(() => (tab === 'games' ? (resumeGames?.game ?? null) : null));
  const where = useRef({ tab, game });
  useEffect(() => {
    where.current = { tab, game };
  });
  useEffect(
    () => () => {
      resumeGames = where.current.tab === 'games' ? { game: where.current.game, waiting: waitingNow() } : null;
    },
    [],
  );
  const openOverlay = useStore((s) => s.openOverlay);
  const box = useRef<HTMLDivElement>(null);
  useDialogFocus(box);
  useBackLayer(closeOverlay);
  // The chat full screen (#201): over the whole office, which stops drawing behind it (store.ts coversView).
  const full = useChatFull((s) => s.on) && tab === 'chat';
  useChatFullBack(full);
  const requests = useStore((s) => s.requests);
  const messages = useStore((s) => s.messages);
  const readAt = useStore((s) => s.phoneReadAt);
  const ceoName = useStore((s) => s.agents[CEO_ID]?.name ?? 'CEO');
  const listenOn = useStore((s) => (s.settings.listen?.provider ?? 'off') !== 'off');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);
  // Keep the overlay's tab in sync so new messages know whether the chat is on screen (during a game it isn't,
  // so the CEO's texts still pop up).
  useEffect(() => {
    openOverlay({ kind: 'phone', tab, requestId, full });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, full]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
      if (e.defaultPrevented) return; // handled inside: a reply or a message's actions closed
      if (e.key === 'Escape' && useChatFull.getState().on && where.current.tab === 'chat') {
        e.preventDefault();
        useChatFull.getState().set(false); // Esc leaves full screen first, then puts the phone away
      } else if (e.key === 'Escape' || (!typing && isKey('phone', e.code))) {
        e.preventDefault();
        closeOverlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pending = pendingRequests(requests).length;
  const unread = unreadMessages(messages, readAt);
  const tabs: [PhoneTab, IconName, string, number][] = [
    ['chat', 'message-circle', ceoName, tab === 'chat' ? 0 : unread],
    ['hires', 'users', 'Team', pending],
    ['company', 'chart-column', 'Company', 0],
    ['games', 'gamepad-2', 'Games', 0],
  ];
  return (
    <div className={`overlay phone-overlay ${full ? 'phone-overlay-full' : ''}`} {...backdropClose(closeOverlay)}>
      <div className={`phone ds-screen ${full ? 'phone-full' : ''}`} ref={box} role="dialog" aria-modal="true" aria-label="Your phone" tabIndex={-1}>
        <CloseButton className="phone-x" onClick={closeOverlay} label="Close" />
        <div className="phone-status" aria-hidden>
          <span>{clock(now)}</span>
          <span className="phone-notch" />
          <span><Icon name="signal" /> <Icon name="battery-full" /></span>
        </div>
        <HolidayStrip />
        <div className="phone-screen">
          {tab !== 'games' && <LobbyNudge />}
          {tab === 'chat' && <Chat />}
          {tab === 'hires' && <TeamChanges focusId={requestId} />}
          {tab === 'company' && <Company />}
          {tab === 'games' && <Games game={game} onGame={setGame} />}
        </div>
        <nav className="phone-tabs" role="tablist" aria-label="Phone">
          {tabs.map(([k, icon, label, badge]) => (
            // Tapping Games again while in a game goes back to the list.
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              className={`phone-tab ${tab === k ? 'phone-tab-on' : ''}`}
              onClick={() => (k === 'games' && tab === 'games' ? setGame(null) : setTab(k))}
            >
              <span className="phone-tab-icon" aria-hidden>
                <Icon name={icon} />
                {badge > 0 && <span className="badge badge-dot">{badge}</span>}
              </span>
              <span>{label}</span>
              {badge > 0 && <span className="sr-only">, {badge} new</span>}
            </button>
          ))}
        </nav>
        <div className="phone-hint">
          {tab === 'chat' && (
            <>
              <kbd>Shift</kbd>+<kbd>Enter</kbd> new line ·{' '}
              {listenOn && (
                <>
                  <Key action="talk" /> to talk ·{' '}
                </>
              )}
            </>
          )}
          {tab === 'games' && game && (
            <>
              <kbd>Backspace</kbd> games ·{' '}
            </>
          )}
          <Key action="phone" /> or <kbd>Esc</kbd> to put it away
        </div>
      </div>
    </div>
  );
}

