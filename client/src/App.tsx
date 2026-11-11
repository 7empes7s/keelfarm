import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useMode } from './pocket/mode';
import { installSwitchKey } from './pocket/switchOffice';
import { Captions, LiveRegions } from './ui/CaptionStrip';
import { ConfirmDialog } from './ui/Confirm';
import { SetupChecklist } from './ui/FloorSetup';
import { OfficeBoundary } from './ui/OfficeBoundary';
import { installQuickKeys } from './ui/QuickToggles';
import { useCall } from './ui/voiceCallStore';

// Each loads only when it's shown: a phone in pocket mode never fetches three.js.
const loadOffice = () => lazy(() => import('./Office'));
const Pocket = lazy(() => import('./pocket/Pocket'));
// The voice call's screens sit over both offices, so switching between them never touches the call.
const CallScreens = lazy(() => import('./ui/CallScreens'));

export function App() {
  const mode = useMode((s) => s.mode);
  // A fresh lazy component per attempt: React keeps a failed import's error otherwise.
  const [attempt, setAttempt] = useState(0);
  const Office = useMemo(loadOffice, [attempt]);
  const calling = useCall((s) => s.call.phase !== 'idle');
  useEffect(installSwitchKey, []);
  useEffect(installQuickKeys, []);
  return (
    <>
      <Suspense fallback={<div className="app-loading">Loading the office…</div>}>
        {mode === 'pocket' ? (
          <Pocket />
        ) : (
          <OfficeBoundary onRetry={() => setAttempt((n) => n + 1)}>
            <Office />
          </OfficeBoundary>
        )}
      </Suspense>
      {calling && (
        <Suspense fallback={null}>
          <CallScreens />
        </Suspense>
      )}
      <SetupChecklist />
      <ConfirmDialog />
      <Captions />
      <LiveRegions />
    </>
  );
}
