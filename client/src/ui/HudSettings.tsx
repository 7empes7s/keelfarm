// The 3D HUD's Settings button and sessions pill (#315): the gear opens the console on Settings, like the 2D office's
// Settings tab, and the sessions count opens Team.
import { useStore } from '../store';
import { useKeyName } from './controls';
import { XLabel } from './HoverCard';
import { Icon } from './Icon';

export const openSettings = () => useStore.getState().openOverlay({ kind: 'manager', tab: 'settings' });
export const openTeam = () => useStore.getState().openOverlay({ kind: 'manager', tab: 'team' });

export function SettingsButton() {
  const key = useKeyName('settings');
  return (
    <button type="button" className="pill pill-switch xbtn" onClick={openSettings} aria-label={`Settings (${key})`}>
      <Icon name="settings" />
      <XLabel text="Settings" keys={key} />
    </button>
  );
}

/** Sessions running now (out of the limit): opens Team. */
export function SessionsButton({ running, limit }: { running: number; limit: number }) {
  return (
    <button type="button" className="pill pill-switch" onClick={openTeam} title="Sessions running now. Open Team">
      <Icon name="activity" /> {limit ? `${running}/${limit}` : running} sessions
    </button>
  );
}
