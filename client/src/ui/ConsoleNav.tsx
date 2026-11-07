// The manager's console (#102): five top tabs (consoleNavRules.ts's groups), a side menu of the open tab's sections with a
// search over every setting at its top, and one section beside it. Pocket mode draws the same map as a list you tap
// into (PocketConsole.tsx); both keep the open section in the address (#settings/cloud-agents) and remember it.
import { lazy, Suspense, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { pendingRequests, useStore, type ManagerTab } from '../store';
import { GROUPS, hashFor, loadRemembered, opening, remember, search, sectionsIn, type GroupId, type Hit, type Section, type SectionId, type Where } from './consoleNavRules';
import { CeoTab, FloorsTab, IssuesTab, TeamTab } from './ManagerConsole';
import { AboutOffice, AgentsSettings, CeoSettings, CompanySettings, RuntimeSettings } from './SettingsSections';
import { OpsTab } from './MissionConsole';
import { CharterTab } from './CharterTab';
import { ToolsTab } from './ToolsSettings';
import { HistorySettings, HistoryTab, type HistoryFocus } from './HistoryTab';
import { EveryProjectCard } from './PracticesSettings';
import { ProfileSettings } from './ProfileSettings';
import { CloudSettings } from './CloudSettings';
import { VoiceSettings } from './VoiceSettings';
import { OutsideSettings } from './OutsideSettings';
import { NotifySettings } from './NotifySettings';
import { ThemeSettings } from './ThemeSettings';
import { AccessibilitySettings } from './AccessibilitySettings';
import { Panel } from './Panel';
import { InfoButton } from './InfoButton';
import { Icon } from './Icon';
import { setMode } from '../pocket/mode';
import './console.css';

// The time-lapse drives the 3D sky's clock, so it loads when its section opens: pocket mode never shows it.
const TimeLapseTab = lazy(() => import('./TimeLapse').then((m) => ({ default: m.TimeLapseTab })));
const MemoryMap = lazy(() => import('./MemoryMap').then((m) => ({ default: m.MemoryMap })));

/** What to open a section at: a floor, Mission control's card, the History's filter. */
export interface SectionFocus {
  repoId?: string;
  card?: string;
  history?: HistoryFocus;
}

function openOffice() {
  useStore.getState().openOverlay(null);
  setMode('office');
}

/** One section's content. */
export function SectionBody({ id, where, focus = {} }: { id: SectionId; where: Where; focus?: SectionFocus }) {
  const one = (body: ReactNode) => <div className="cn-one">{body}</div>;
  switch (id) {
    case 'floors':
      return <FloorsTab />;
    case 'issues':
      return <IssuesTab initialRepo={focus.repoId} />;
    case 'team':
      return <TeamTab />;
    case 'ops':
      return <OpsTab card={focus.card} />;
    case 'charter':
      return <CharterTab initialRepo={focus.repoId} />;
    case 'map':
      return (
        <Suspense fallback={<p className="muted">Loading…</p>}>
          <MemoryMap />
        </Suspense>
      );
    case 'ceo':
      return <CeoTab />;
    case 'ceo-settings':
      return one(<CeoSettings />);
    case 'tools':
      return <ToolsTab />;
    case 'history':
      return <HistoryTab key={JSON.stringify(focus.history ?? {})} focus={focus.history} />;
    case 'daily-log':
      return one(<HistorySettings />);
    case 'timelapse':
      return (
        <Suspense fallback={<p className="muted">Loading…</p>}>
          <TimeLapseTab />
        </Suspense>
      );
    case 'agents':
      return one(<AgentsSettings />);
    case 'projects':
      return one(<EveryProjectCard />);
    case 'runtime':
      return one(<RuntimeSettings />);
    case 'office':
      return one(<CompanySettings />);
    case 'profile':
      return one(<ProfileSettings />);
    case 'cloud-agents':
      return one(<CloudSettings />);
    case 'voice':
      return one(<VoiceSettings />);
    case 'outside':
      return one(<OutsideSettings />);
    case 'notifications':
      return one(<NotifySettings />);
    case 'themes':
      return one(<ThemeSettings />);
    case 'access':
      return <div className="tab-grid a11y-grid"><AccessibilitySettings pocket={where === 'pocket'} /></div>;
    case 'pocket':
      return one(
        <div className="card">
          <h3><Icon name="smartphone" /> Pocket mode</h3>
          <p className="muted small">
            This is the office without the 3D building, for phones and touch screens. It's picked on its own on small or touch screens; this device remembers what you last chose. To reach the office from
            your phone safely, see <a href="https://github.com/leonvanzyl/cubefarm/blob/main/docs/pocket.md">docs/pocket.md</a>.
          </p>
          <button className="btn" onClick={openOffice}>
            <Icon name="building-2" /> Open the 3D office
          </button>
        </div>,
      );
    case 'about':
      return one(<AboutOffice />);
  }
}

/** The number waiting in each section: team changes for the CEO, alarms in Mission control, charter proposals. */
export function useBadges(): Partial<Record<SectionId, number>> {
  const ceo = useStore((s) => pendingRequests(s.requests).length);
  const ops = useStore((s) => s.ops.alarms.length + s.doctor.length);
  const charter = useStore((s) => s.repos.filter((r) => r.charter.proposal).length);
  return { ceo, ops, charter };
}

const groupBadge = (g: GroupId, where: Where, badges: Partial<Record<SectionId, number>>) => sectionsIn(g, where).reduce((n, s) => n + (badges[s.id] ?? 0), 0);

export function Badge({ n }: { n?: number }) {
  return n ? <span className="badge">{n}</span> : null;
}

/** Keeps the open section in the address and remembers it; the address goes back when the console closes. */
export function useSectionAddress(section: Section | null) {
  useEffect(() => {
    if (!section) return;
    remember(section);
    history.replaceState(history.state, '', hashFor(section));
  }, [section]);
  useEffect(() => () => history.replaceState(history.state, '', location.pathname + location.search), []);
}

/** After a search: the setting it found, scrolled to and outlined in the section that just opened. Returns its setter. */
export function useFoundLabel(pane: RefObject<HTMLElement | null>) {
  const [label, setLabel] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (!label) return;
    const t = setTimeout(() => {
      const want = label.toLowerCase();
      const el = [...(pane.current?.querySelectorAll<HTMLElement>('h3, h4, label > span, b, summary, legend') ?? [])].find((x) => x.textContent?.toLowerCase().includes(want));
      if (el) {
        el.scrollIntoView({ block: 'center' });
        el.classList.add('cn-found');
        setTimeout(() => el.classList.remove('cn-found'), 2500);
      }
      setLabel(null);
    }, 60); // lazy sections render a moment later
    return () => clearTimeout(t);
  }, [label, pane]);
  return setLabel;
}

/** The search at the top of the side menu (and pocket mode's list): every setting, by its label. */
export function ConsoleSearch({ where, query, setQuery, go }: { where: Where; query: string; setQuery: (q: string) => void; go: (hit: Hit) => void }) {
  const hits = search(query, where);
  const id = useId();
  return (
    <div className="cn-search" data-tour="console-search">
      <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search settings" aria-label="Search settings" aria-controls={query ? id : undefined} />
      {query.trim() && (
        <ul className="cn-hits" id={id} aria-label="Search results">
          {hits.length === 0 && <li className="muted small cn-none">Nothing called that.</li>}
          {hits.map((h) => (
            <li key={`${h.section.id}:${h.label}`}>
              <button className="cn-item" onClick={() => go(h)}>
                <Icon name={h.section.icon} />
                <span className="cn-item-text">
                  {h.label}
                  {h.label !== h.section.label && <span className="cn-item-meta">{h.section.label}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The console's top tabs, the open tab's side menu and one section beside it: the 3D office's console, and pocket mode's ⚙️ on a desktop (#104). */
export function ConsoleSplit({ where, section, pick, focus }: { where: Where; section: Section; pick: (s: Section) => void; focus?: SectionFocus }) {
  const [query, setQuery] = useState('');
  const pane = useRef<HTMLDivElement>(null);
  const setFound = useFoundLabel(pane);
  const badges = useBadges();
  const ids = useId();
  useEffect(() => {
    pane.current?.scrollTo(0, 0); // a block: Chrome's scrollTo can return a promise, which React would take for a cleanup
  }, [section]);
  const openGroup = (g: GroupId) => pick(opening(g, '', where, loadRemembered()));
  const sections = sectionsIn(section.group, where);
  return (
    <>
      <div className="tabs cn-groups" role="tablist" aria-label="Console">
        {GROUPS.map((g) => (
          <button key={g.id} role="tab" aria-selected={section.group === g.id} className={`tab ${section.group === g.id ? 'tab-on' : ''}`} onClick={() => openGroup(g.id)}>
            <Icon name={g.icon} /> {g.label} <Badge n={groupBadge(g.id, where, badges)} />
          </button>
        ))}
      </div>
      <div className="cn-split">
        <nav className="cn-side" aria-label="Sections">
          <ConsoleSearch
            where={where}
            query={query}
            setQuery={setQuery}
            go={(h) => {
              setQuery('');
              pick(h.section);
              setFound(h.label === h.section.label ? null : h.label);
            }}
          />
          {!query.trim() && (
            <div className="cn-menu" role="tablist" aria-orientation="vertical" aria-label={GROUPS.find((g) => g.id === section.group)?.label}>
              {sections.map((s) => (
                <button
                  key={s.id}
                  role="tab"
                  aria-selected={section.id === s.id}
                  aria-controls={`${ids}-pane`}
                  className={`cn-item ${section.id === s.id ? 'cn-item-on' : ''}`}
                  onClick={() => pick(s)}
                >
                  <Icon name={s.icon} />
                  <span className="cn-item-text">{s.label}</span>
                  <Badge n={badges[s.id]} />
                </button>
              ))}
            </div>
          )}
        </nav>
        <div ref={pane} className="cn-pane tab-body ds-stack-scope" role="tabpanel" id={`${ids}-pane`} aria-label={section.label}>
          <div className="cn-pane-info">
            <InfoButton key={section.id} screen={section.id} />
          </div>
          <SectionBody key={section.id} id={section.id} where={where} focus={focus} />
        </div>
      </div>
    </>
  );
}

/** The 3D office's console. tab: a section or one of the old tab names (consoleNavRules.ts `resolve`). */
export function ManagerConsole({ initialTab, initialRepo, card, history }: { initialTab?: ManagerTab; initialRepo?: string; card?: string; history?: HistoryFocus }) {
  const [section, setSection] = useState<Section>(() => opening(initialTab, location.hash, 'office', loadRemembered()));
  useSectionAddress(section);
  return (
    <Panel wide title={<><Icon name="laptop" /> Manager's console</>} className="ds-console">
      <ConsoleSplit where="office" section={section} pick={setSection} focus={{ repoId: initialRepo, card, history }} />
    </Panel>
  );
}
