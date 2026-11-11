import { useMemo } from 'react';
import { AgentCard } from './AgentCard';
import { floorPrCounts, repoOnFloor, usePhoneBadge, useStore } from '../store';
import { CEO_ID } from '../../../shared/types';
import { HeldHint } from './HeldHint';
import { CareerPeek } from './CareerCard';
import { CoinChip } from './CoinChip';
import './progressProbe';
import './doctorProbe';
import { eAction } from '../world/toys/sip';
import { SNACKS } from '../world/fridge';
import { stickyDrop } from '../world/boardHands';
import { WorkersPanel } from './WorkersPanel';
import { PresenceHud } from './PresenceHud';
import { officeUpdateChip } from '../officeUpdate';
import { UpdatePill } from './UpdatePill';
import { useA11y } from './a11y';
import { useCameraView } from '../world/camera/rig';
import { CameraHud, OverviewButton } from './CameraHud';
import { useKeyName } from './controls';
import { Key, MoveKeys } from './Key';
import { ROOF } from '../world/layout';
import { useRoof } from '../world/roof/roofState';
import { RoofHud } from './RoofHud';
import { SearchButton } from './SearchPalette';
import { GuideButton } from './GuideCard';
import { NoticeBell, NoticeToasts } from './Notices';
import { QuickToggles } from './QuickToggles';
import { usageChip } from '../ops';
import { heldNote } from '../../../shared/health';
import { togglePhoto, usePhotoGate } from '../photo/gate';
import { isTouch, openHoldMenu, useTouchLook, useTouchStick } from '../world/touch/touchState';
import { TouchZoneHints } from './TouchZoneHints';
import { switchOffice } from '../pocket/switchOffice';
import { Icon, IconText } from './Icon';
import { useChatMode } from './chatMode';
import { SessionsButton, SettingsButton } from './HudSettings';
import { useLayout } from '../pocket/mode';
import { PhoneHud } from './PhoneHud';
import { useAimCard } from './AgentCard';
import { touchHelpShows, tourAllows, useTourGate } from './tourGate';

/** While the office is on its way to updating itself (or restarting to do it); opens the console's Office row. */
function OfficeUpdateChip() {
  const text = useStore((s) => (s.restarting ? 'Office restarting…' : officeUpdateChip(s.officeUpdate)));
  const overlay = useStore((s) => s.overlay);
  const openOverlay = useStore((s) => s.openOverlay);
  if (!text || overlay?.kind === 'manager') return null;
  return (
    <button className="office-chip" onClick={() => openOverlay({ kind: 'manager', tab: 'floors' })} title="The office is updating itself. Open the manager's console">
      {text}
    </button>
  );
}

/** While Claude's usage holds new work back (pacing or paused); opens Mission control at the usage meter. */
function UsageChip() {
  const usage = useStore((s) => s.usage);
  const sessions = useStore((s) => s.settings.pacingSessions);
  const overlay = useStore((s) => s.overlay);
  const openOverlay = useStore((s) => s.openOverlay);
  const text = usageChip(usage, sessions, Date.now());
  if (!text || overlay?.kind === 'manager') return null;
  return (
    <button className={`office-chip usage-chip usage-chip-${usage.state}`} onClick={() => openOverlay({ kind: 'manager', tab: 'ops', card: 'usage' })} title="Claude's usage is holding new work back. Open Mission control">
      {text}
    </button>
  );
}

/** While work waits for memory (#115): a quiet note, no sound; opens Mission control at the server's health. */
function MemoryChip() {
  const text = useStore((s) => heldNote(s.health?.heldWork));
  const overlay = useStore((s) => s.overlay);
  const openOverlay = useStore((s) => s.openOverlay);
  if (!text || overlay?.kind === 'manager') return null;
  return (
    <button className="office-chip memory-chip" onClick={() => openOverlay({ kind: 'manager', tab: 'ops', card: 'health' })} title="Work waits for memory and starts by itself. Open Mission control">
      <IconText text={text} />
    </button>
  );
}

/** The office doctor's findings (server/watchdog.ts); opens them in Mission control. */
function DoctorChip() {
  const count = useStore((s) => s.doctor.length);
  const overlay = useStore((s) => s.overlay);
  const openOverlay = useStore((s) => s.openOverlay);
  if (!count || overlay?.kind === 'manager') return null;
  return (
    <button className="office-chip doctor-chip" onClick={() => openOverlay({ kind: 'manager', tab: 'ops', card: 'doctor' })} title="The office doctor found something stuck. Open Mission control">
      <Icon name="stethoscope" /> {count} to check
    </button>
  );
}

/** The phone in your pocket: always one key (or click) away, with a badge when the CEO is waiting on you. */
function PhoneButton() {
  const badge = usePhoneBadge();
  const started = useStore((s) => s.started);
  const overlay = useStore((s) => s.overlay);
  const openOverlay = useStore((s) => s.openOverlay);
  const ceo = useStore((s) => s.agents[CEO_ID]);
  const key = useKeyName('phone');
  if (!started || overlay?.kind === 'phone') return null;
  const busy = ceo?.status === 'working';
  return (
    <button data-tour="phone" className={`phone-btn ${badge ? 'phone-btn-ring' : ''}`} onClick={() => openOverlay({ kind: 'phone' })} title={`Your phone (${key})`}>
      <span className="phone-btn-icon">
        <Icon name="smartphone" />
      </span>
      {badge > 0 && <span className="badge phone-btn-badge">{badge}</span>}
      <span className="phone-btn-label">
        <Key action="phone" /> {badge ? `${badge} waiting` : busy ? `${ceo.name} is working` : 'Phone'}
      </span>
    </button>
  );
}

/** Photo mode (K by default); a red dot while instant replay keeps the last 15 s (I saves them). */
function PhotoButton() {
  const started = useStore((s) => s.started);
  const replay = usePhotoGate((s) => s.replay);
  const photoKey = useKeyName('photo');
  const replayKey = useKeyName('saveReplay');
  if (!started) return null;
  return (
    <button className="pill pill-photo" onClick={togglePhoto} title={replay ? `Photo mode (${photoKey}). Instant replay is on: ${replayKey} saves the last 15 s` : `Photo mode (${photoKey}): freeze the office, frame a shot, record a clip`}>
      <Icon name="camera" /> <kbd>{photoKey}</kbd>
      {replay && <span className="pill-photo-rec" aria-label="Instant replay on" />}
    </button>
  );
}

/** The 2D office (pocket mode, #104): the same office as pages, a click or a key away; this device remembers it. */
function SwitchButton() {
  const key = useKeyName('switchOffice');
  return (
    <button data-tour="switch" className="pill pill-switch" onClick={switchOffice} title={`The 2D office: every floor, the CEO's chat and your approvals as pages (${key})`}>
      <Icon name="map" /> 2D office <kbd>{key}</kbd>
    </button>
  );
}

/** Chat mode (#120): desks, Team and Kanban open an agent's chat instead of their terminal; this device remembers it. */
function ChatModeButton() {
  const { on, set } = useChatMode();
  return (
    <button className="pill pill-switch" aria-pressed={on} onClick={() => set(!on)} title={`Chat mode is ${on ? 'on' : 'off'}: desks open an agent's ${on ? 'chat, their steps in plain words' : 'terminal'}. Click to switch`}>
      <Icon name="message-circle" /> Chat {on ? 'on' : 'off'}
    </button>
  );
}

/** On the phone icon while a message is read aloud (ui/voiceMessages.ts); a click stops it. */
function VoiceIndicator() {
  const speaking = useStore((s) => s.voiceSpeaking);
  const started = useStore((s) => s.started);
  if (!started || speaking === null) return null;
  return (
    <button className="voice-speaking" onClick={() => void import('./voiceMessages').then((v) => v.stopSpeaking())} title="Reading a message aloud. Click to stop" aria-label="Stop reading the message aloud">
      <Icon name="volume-2" />
    </button>
  );
}

/** What E does with what's in your hands: a sip of coffee, a bite of a sausage, or a sip or bite of a snack. */
function sipLabel(held: ReturnType<typeof useStore.getState>['held']) {
  if (held?.kind === 'sausage') return 'Take a bite';
  if (held?.kind === 'snack') return SNACKS[held.snack].kind === 'drink' ? `Sip the ${SNACKS[held.snack].short}` : `Bite the ${SNACKS[held.snack].short}`;
  return 'Sip coffee';
}

export function HUD() {
  const floor = useStore((s) => s.floor);
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const settings = useStore((s) => s.settings);
  const connected = useStore((s) => s.connected);
  const restarting = useStore((s) => s.restarting);
  const replaying = useStore((s) => s.replaying);
  const demo = useStore((s) => s.demo);
  const publicDemo = useStore((s) => s.publicDemo);
  const user = useStore((s) => s.user);
  const ghReady = useStore((s) => s.ghReady);
  const ghError = useStore((s) => s.ghError);
  const focus = useStore((s) => s.focus);
  const held = useStore((s) => s.held);
  // With coffee in hand, E sips whatever you aim at (except the coffee machine).
  const sip = eAction(held, focus?.action.kind ?? null) === 'sip';
  // With a sticky in hand, the hint says what E does with it here.
  const drop = stickyDrop(focus);
  const dropLabel =
    !drop || drop.kind === 'none' ? null : drop.kind === 'refuse' ? (
      <>
        <Icon name="triangle-alert" /> {drop.label}
      </>
    ) : (
      drop.label
    );
  const overlay = useStore((s) => s.overlay);
  const locked = useStore((s) => s.locked);
  const started = useStore((s) => s.started);
  const travel = useStore((s) => s.travel);
  const centerDot = useA11y((s) => s.prefs.centerDot);
  const walked = useTouchStick((s) => s.walked);
  const looked = useTouchStick((s) => s.looked);
  const touchClassic = useTouchLook((s) => s.classic);
  // In the overview, the building view and the follow cam there's no crosshair to aim (camera/rig.ts).
  const onFoot = useCameraView((s) => s.mode) === 'first';

  const roof = floor === ROOF;
  const scope = useRoof((s) => s.telescope); // the telescope's eyepiece has its own crosshair
  const repo = floor === 0 || roof ? null : repoOnFloor(repos, floor);
  const running = useMemo(() => Object.values(agents).filter((a) => a.status === 'working' || a.status === 'preparing').length, [agents]);
  const floorAgents = repo ? Object.values(agents).filter((a) => a.repoId === repo.id) : [];
  const qa = useStore((s) => s.qa);
  const prs = useMemo(() => (repo ? floorPrCounts(repo, qa) : null), [repo, qa]);

  const compact = useLayout() === 'compact';
  const tourStep = useTourGate((s) => s.step);
  const cardOpen = useAimCard((s) => s.open);
  const accent = roof ? '#7cc6fe' : (repo?.color ?? '#ff8a5b');
  const floorName = roof ? `${settings.companyName || 'cubefarm'} · Roof terrace` : repo ? repo.fullName : `${settings.companyName || 'cubefarm'} · Lobby`;
  const floorSub = roof
    ? 'deck chairs, the barbecue and the telescope'
    : repo && prs
      ? `${floorAgents.length} agents · ${floorAgents.filter((a) => a.status === 'working' || a.status === 'preparing').length} working · ${prs.inQa} in QA · ${prs.ready} ready to merge${prs.needsYou ? ` · ${prs.needsYou} need${prs.needsYou === 1 ? 's' : ''} you` : ''}`
      : `${repos.length} floor${repos.length === 1 ? '' : 's'} connected`;
  const chips = (
    <>
      <OfficeUpdateChip />
      <UpdatePill className="office-chip update-pill" />
      <UsageChip />
      <MemoryChip />
      <DoctorChip />
    </>
  );

  return (
    <div className="hud ds-screen">
      {compact ? (
        // a phone: one row of four controls; the rest is in Options (#406)
        <PhoneHud num={roof ? 'R' : repo ? String(repo.floor) : 'G'} title={floorName} sub={floorSub} accent={accent} phone={<PhoneButton />} chips={chips} />
      ) : (
        <>
          <div className="hud-floor" style={{ ['--accent' as string]: accent }}>
            <div className="floor-num">{roof ? 'R' : repo ? repo.floor : 'G'}</div>
            <div>
              <div className="floor-name">{floorName}</div>
              <div className="floor-sub">{floorSub}</div>
            </div>
            <OverviewButton />
          </div>

          {/* the bell and Settings first: when the row wraps, its last pills go under the workers list, never these */}
          <div className="hud-status">
            <NoticeBell className="pill" />
            <SettingsButton />
            <QuickToggles className="pill" />
            {demo && <span className="pill pill-demo">{publicDemo ? `Demo office · resets every ${publicDemo.resetHours} h` : 'DEMO'}</span>}
            <span className={`pill ${replaying ? 'pill-replay' : connected ? 'pill-ok' : restarting ? 'pill-demo' : 'pill-bad'}`}>
              {replaying ? (
                <>
                  <Icon name="play" /> replay
                </>
              ) : connected ? (
                <>
                  <Icon name="circle-dot" /> live
                </>
              ) : (
                <>
                  <Icon name="circle" /> {restarting ? 'restarting' : 'reconnecting'}
                </>
              )}
            </span>
            <SessionsButton running={running} limit={settings.sessionLimit} />
            <CoinChip />
            {user && (
              <span className="pill">
                <Icon name="git-branch" /> {user}
              </span>
            )}
            <PhotoButton />
            <SearchButton />
            <GuideButton />
            <ChatModeButton />
            <SwitchButton />
          </div>

          <WorkersPanel />
          <div className="hud-chips">{chips}</div>
        </>
      )}

      {!ghReady && ghError && (
        <div className="hud-banner">
          <Icon name="triangle-alert" /> {ghError}
        </div>
      )}

      {/* the centre dot (Settings → Accessibility) is a bolder crosshair that stays through the elevator's fade too */}
      {started && !overlay && (!travel || centerDot) && onFoot && !scope && held?.kind !== 'paddle' && <div className={`crosshair ${focus ? 'crosshair-hot' : ''} ${centerDot ? 'crosshair-dot' : ''}`} />}
      {started && !overlay && !travel && onFoot && <RoofHud />}
      {/* the cards for whoever you're looking at, docked at the left edge: the middle is their screen */}
      <div className="aim-cards">
        <AgentCard />
        {/* on a touch screen the career peek is part of the expanded card; the tour may hold it back (#406) */}
        {started && !overlay && !travel && onFoot && (!isTouch || cardOpen) && tourAllows(tourStep, { kind: 'card' }) && <CareerPeek />}
      </div>
      {/* one card at a time on a touch screen: aiming at someone, their card has the ⋯ (#406) */}
      {started && !overlay && onFoot && (focus || sip) && !(isTouch && !sip && focus?.action.kind === 'terminal') && (
        <div className="hud-hint">
          {isTouch ? <kbd>Tap</kbd> : <Key action="interact" />} {!held && !isTouch && <>/ <kbd>Click</kbd> </>}
          {sip ? sipLabel(held) : (dropLabel ?? focus?.label)}
          {!held && focus?.action.kind === 'card' && focus.action.peel && (
            <>
              {' '}
              · <Key action="drop" /> / hold <kbd>Click</kbd> take it
            </>
          )}
          {!sip && focus?.action.kind === 'jukebox' && (
            <>
              {' '}
              · <Key action="volumeDown" /> <Key action="volumeUp" /> / <kbd>Scroll</kbd> volume
            </>
          )}
          {isTouch && focus && !sip && (
            <button className="hint-more" onClick={() => openHoldMenu(focus)} aria-label={`More for ${focus.label}`} title="More options">
              <Icon name="ellipsis" />
            </button>
          )}
        </div>
      )}
      {started && !overlay && !travel && onFoot && <HeldHint />}
      {started && !overlay && !locked && !travel && onFoot && !isTouch && <div className="hud-resume">Click to look around</div>}
      {started && !overlay && !travel && onFoot && isTouch && <TouchZoneHints walked={walked} looked={looked} />}
      {started && isTouch && touchHelpShows(tourStep) && (
        <div className="hud-help">
          {touchClassic ? 'Drag low to walk (far to run) · drag high to look' : 'Thumb on the ghost stick walks (far to run) · the other bottom corner looks · tap things to go there'} · hold, then let go, for more ·{' '}
          <Icon name="smartphone" /> for the phone
        </div>
      )}
      {started && !(settings.setupDone && settings.tutorialStep >= 0) && !isTouch && (
        <div className="hud-help">
          <MoveKeys joined /> move · <Key action="run" /> run · <Key action="interact" /> / <kbd>Click</kbd> interact · <Key action="phone" /> phone · <Key action="emote" /> emote · <Key action="ping" /> ping · <Key action="photo" /> photo ·{' '}
          <Key action="overview" /> overview · <Key action="workers" /> workers · <Key action="mute" /> mute · <Key action="help" /> help · <kbd>Esc</kbd> free mouse
        </div>
      )}

      <div className={`fade ${travel?.phase === 'closing' ? 'fade-in' : ''}`}>
        {travel && <div className="fade-label">{travel.to === 0 ? 'Lobby' : travel.to === ROOF ? 'Roof' : `Floor ${travel.to}`}</div>}
      </div>

      <CameraHud />
      <PresenceHud />
      {!compact && <PhoneButton />}
      <VoiceIndicator />
      {/* the tour owns the screen: toasts wait in the store until it's over (#406) */}
      {tourAllows(tourStep, { kind: 'toast' }) && <NoticeToasts max={3} />}
    </div>
  );
}
