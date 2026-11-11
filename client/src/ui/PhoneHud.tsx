// The 3D office's top bar on a phone (#406): one row, four controls: the floor chip (its sheet: the floor's status,
// the overview and every floor), the bell, the phone and Options. Options holds what a computer's top bar shows
// (hudOptions.ts) as a grouped list; the search runs the same Options (setOptionRunner). Notices that hold work back
// (memory, usage, the doctor, the office's update) put a dot on the floor chip and rows in both sheets.
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { heldNote } from '../../../shared/health';
import { repoOnFloor, useStore } from '../store';
import { usageChip } from '../ops';
import { officeUpdateChip } from '../officeUpdate';
import { togglePhoto } from '../photo/gate';
import { switchOffice } from '../pocket/switchOffice';
import { enterOverview } from '../world/camera/rig';
import { canGoFullscreen, toggleBrowserFull, useBrowserFull } from './browserFull';
import { keyName } from './controls';
import { useChatMode } from './chatMode';
import { useCoinGain } from './CoinChip';
import { go, openSearch, setOptionRunner } from './goTo';
import { openSettings, openTeam } from './HudSettings';
import { HUD_OPTIONS, OPTION_GROUPS, type HudOptionId } from './hudOptions';
import { Icon } from './Icon';
import { NoticeBell } from './Notices';
import { flip } from './quickToggleRules';
import { getAudioPrefs, subscribeAudio } from './sfx';
import { useA11y } from './a11y';
import { Sheet } from './Sheet';
import { gateAllows } from './tourGate';
import './phoneHud.css';

const toast = (text: string | null) => text && useStore.getState().pushToast('info', text);

const RUN: Record<HudOptionId, () => void> = {
  overview: enterOverview,
  photo: togglePhoto,
  switch: switchOffice,
  'browser-full': () => toggleBrowserFull(),
  mute: () => toast(flip('mute', keyName('mute'))),
  captions: () => toast(flip('captions', keyName('mute'))),
  'sound-settings': () => useStore.getState().openOverlay({ kind: 'help' }),
  search: openSearch,
  guide: () => go({ kind: 'guide' }),
  'chat-mode': () => useChatMode.getState().set(!useChatMode.getState().on),
  sessions: openTeam,
  coins: () => {
    const s = useStore.getState();
    s.openOverlay({ kind: 'catalogue', repoId: repoOnFloor(s.repos, s.floor)?.id });
  },
  settings: openSettings,
};
setOptionRunner((id) => RUN[id]());

/** Switches that flip in place: the sheet stays open to show the new state. */
const IN_PLACE = new Set<HudOptionId>(['mute', 'captions', 'chat-mode', 'browser-full']);

/** What a row shows at its end: a switch's state or a count. */
function useValues(): Partial<Record<HudOptionId, string>> {
  const muted = useSyncExternalStore(subscribeAudio, () => getAudioPrefs().muted);
  const captions = useA11y((s) => s.prefs.captions);
  const chat = useChatMode((s) => s.on);
  const full = useBrowserFull();
  const running = useStore((s) => Object.values(s.agents).filter((a) => a.status === 'working' || a.status === 'preparing').length);
  const limit = useStore((s) => s.settings.sessionLimit);
  const coins = useStore((s) => {
    const repo = s.floor === 0 ? null : repoOnFloor(s.repos, s.floor);
    return repo ? (s.progress.floors[repo.id]?.coins ?? 0) : Object.values(s.progress.floors).reduce((n, f) => n + f.coins, 0);
  });
  const on = (x: boolean) => (x ? 'On' : 'Off');
  return { 'browser-full': on(full), mute: on(!muted), captions: on(captions), 'chat-mode': on(chat), sessions: limit ? `${running}/${limit}` : `${running}`, coins: `${coins}` };
}

/** Whether something holds work back or needs a look: the floor chip's dot. */
const useAlert = () =>
  useStore((s) => !!heldNote(s.health?.heldWork) || s.doctor.length > 0 || !!usageChip(s.usage, s.settings.pacingSessions, Date.now()) || s.restarting || !!officeUpdateChip(s.officeUpdate));

/** The connection, the demo and the GitHub account, then the notices (HUD.tsx's chips). */
function Status({ chips }: { chips: ReactNode }) {
  const connected = useStore((s) => s.connected);
  const restarting = useStore((s) => s.restarting);
  const replaying = useStore((s) => s.replaying);
  const demo = useStore((s) => s.demo);
  const publicDemo = useStore((s) => s.publicDemo);
  const user = useStore((s) => s.user);
  const line = replaying ? 'Replay' : connected ? 'Live' : restarting ? 'Restarting' : 'Reconnecting';
  return (
    <>
      <div className="opt-status muted small">
        <span>
          <Icon name={replaying ? 'play' : connected ? 'circle-dot' : 'circle'} /> {line}
        </span>
        {demo && <span>{publicDemo ? `Demo office · resets every ${publicDemo.resetHours} h` : 'Demo'}</span>}
        {user && (
          <span>
            <Icon name="git-branch" /> {user}
          </span>
        )}
      </div>
      <div className="opt-chips">{chips}</div>
    </>
  );
}

function OptionsSheet({ chips, onClose }: { chips: ReactNode; onClose: () => void }) {
  const values = useValues();
  const pick = (id: HudOptionId) => {
    if (!IN_PLACE.has(id)) onClose();
    RUN[id]();
  };
  return (
    <Sheet title="Options" onClose={onClose} className="opt-sheet">
      <Status chips={chips} />
      {OPTION_GROUPS.map((g) => (
        <section key={g} className="opt-group" aria-label={g}>
          <h3 className="opt-group-title">{g}</h3>
          <div className="opt-list">
            {HUD_OPTIONS.filter((o) => o.group === g && (o.id !== 'browser-full' || canGoFullscreen())).map((o) => (
              <button key={o.id} type="button" className="ds-menu-item opt-item" onClick={() => pick(o.id)} aria-pressed={IN_PLACE.has(o.id) ? values[o.id] === 'On' : undefined}>
                <span className="opt-row">
                  <span className="opt-glyph">
                    <Icon name={o.icon} />
                  </span>
                  <span className="opt-label">{o.label}</span>
                  {values[o.id] && <span className="opt-value">{values[o.id]}</span>}
                  {!IN_PLACE.has(o.id) && <Icon name="chevron-right" />}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </Sheet>
  );
}

function FloorSheet({ title, sub, chips, onClose }: { title: string; sub: string; chips: ReactNode; onClose: () => void }) {
  const then = (f: () => void) => () => {
    onClose();
    f();
  };
  return (
    <Sheet title={title} onClose={onClose} className="opt-sheet">
      <p className="opt-sub">{sub}</p>
      <Status chips={chips} />
      <div className="opt-list">
        <button type="button" className="ds-menu-item opt-item" onClick={then(enterOverview)}>
          <span className="opt-row">
            <span className="opt-glyph">
              <Icon name="map" />
            </span>
            <span className="opt-label">Overview</span>
            <Icon name="chevron-right" />
          </span>
        </button>
        <button type="button" className="ds-menu-item opt-item" onClick={then(() => useStore.getState().openOverlay({ kind: 'floorList' }))}>
          <span className="opt-row">
            <span className="opt-glyph">
              <Icon name="building-2" />
            </span>
            <span className="opt-label">Every floor</span>
            <Icon name="chevron-right" />
          </span>
        </button>
      </div>
    </Sheet>
  );
}

/** The phone's top bar. `phone`: the phone button; `chips`: the notices, shown in the sheets. */
export function PhoneHud({ num, title, sub, accent, phone, chips }: { num: string; title: string; sub: string; accent: string; phone: ReactNode; chips: ReactNode }) {
  const [sheet, setSheet] = useState<'floor' | 'options' | null>(null);
  useCoinGain(); // the coins' chip lives in Options here: its plings go on
  const alert = useAlert();
  const open = (which: 'floor' | 'options') => {
    if (gateAllows({ kind: 'options' })) setSheet(which);
  };
  const close = () => setSheet(null);
  return (
    <>
      <div className="hud-bar">
        <button type="button" className="hud-floor hud-floor-chip" style={{ ['--accent' as string]: accent }} onClick={() => open('floor')} aria-label={`${title}: ${sub}${alert ? '. Something needs a look' : ''}`}>
          <span className="floor-num">{num}</span>
          <span className="hud-floor-text">
            <span className="floor-name">{title}</span>
            <span className="floor-sub">{sub}</span>
          </span>
          {alert && <span className="hud-floor-dot" aria-hidden />}
        </button>
        <NoticeBell className="pill" compact />
        {phone}
        <button type="button" data-tour="options" className="pill hud-options" onClick={() => open('options')} aria-label="Options" title="Options">
          <Icon name="sliders-horizontal" />
        </button>
      </div>
      {sheet === 'options' && <OptionsSheet chips={chips} onClose={close} />}
      {sheet === 'floor' && <FloorSheet title={title} sub={sub} chips={chips} onClose={close} />}
    </>
  );
}
