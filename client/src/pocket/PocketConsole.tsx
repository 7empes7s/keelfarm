// Pocket mode's ⚙️: the manager's console on a phone. The same tabs as the 3D office's console (floors and adding a
// project, the CEO, the team, every office setting, mission control), plus this device's notifications and
// accessibility. Loaded when first opened; nothing here loads 3D (the look editor's preview loads on its own).
import { useEffect, useRef } from 'react';
import { CeoTab, FloorsTab, SettingsTab, TeamTab } from '../ui/ManagerConsole';
import { OpsTab } from '../ui/MissionConsole';
import { NotifySettings } from '../ui/NotifySettings';
import { AccessibilitySettings } from '../ui/AccessibilitySettings';
import { pendingRequests, useStore } from '../store';
import { setMode } from './mode';

export type ConsoleSection = 'floors' | 'ceo' | 'team' | 'settings' | 'ops' | 'device';

function openOffice() {
  useStore.getState().openOverlay(null);
  setMode('office');
}

export function PocketConsole({ section, pick }: { section: ConsoleSection; pick: (s: ConsoleSection) => void }) {
  const pending = useStore((s) => pendingRequests(s.requests).length);
  const alarms = useStore((s) => s.ops.alarms.length + s.doctor.length);
  // The sections scroll sideways on a phone: keep the open one in view.
  const chips = useRef<HTMLDivElement>(null);
  useEffect(() => {
    chips.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [section]);
  const sections: [ConsoleSection, string][] = [
    ['floors', '🏢 Floors'],
    ['ceo', `🧠 CEO${pending ? ` (${pending})` : ''}`],
    ['team', '👩‍💻 Team'],
    ['settings', '⚙️ Office'],
    ['ops', `🛰️ Mission control${alarms ? ` (${alarms})` : ''}`],
    ['device', '📱 This device'],
  ];
  return (
    <div className="pk-console">
      <div ref={chips} className="pk-chips pk-console-chips" role="tablist" aria-label="Settings">
        {sections.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={section === k} className={`pk-chip ${section === k ? 'pk-chip-on' : ''}`} onClick={() => pick(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="ds-stack-scope" role="tabpanel" aria-label={sections.find(([k]) => k === section)?.[1]}>
        {section === 'floors' && <FloorsTab />}
        {section === 'ceo' && <CeoTab />}
        {section === 'team' && <TeamTab />}
        {section === 'settings' && <SettingsTab pocket />}
        {section === 'ops' && <OpsTab />}
        {section === 'device' && (
          <>
            <NotifySettings />
            <AccessibilitySettings pocket />
            <div className="card">
              <h3>📱 Pocket mode</h3>
              <p className="muted small">
                This is the office without the 3D building, for phones and touch screens. It's picked on its own on small or touch screens; this device remembers what you last chose. To reach the office from
                your phone safely, see <a href="https://github.com/leonvanzyl/cubefarm/blob/main/docs/pocket.md">docs/pocket.md</a>.
              </p>
              <button className="btn" onClick={openOffice}>
                🏢 Open the 3D office
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
