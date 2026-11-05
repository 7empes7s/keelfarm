// The 3D office and everything drawn over it. Loaded on its own (App.tsx), so pocket mode never downloads the 3D world.
import { lazy, Suspense, useEffect } from 'react';
import { StatsReadout, statsEnabled } from './perf';
import { bootDone, bootStep } from './pocket/officeBoot';
import { useStore } from './store';
import { installPhoto, usePhotoGate } from './photo/gate';
import { Game } from './world/Game';
import { HUD } from './ui/HUD';
import { ReplayBar } from './ui/TimeLapse';
import { Overlays } from './ui/Overlays';
import { StartScreen } from './ui/StartScreen';
import { Tutorial } from './ui/Tutorial';
import { HoldMenu } from './ui/HoldMenu';
import { TouchStick } from './ui/TouchStick';
import { useTouchPage } from './ui/touchMode';

// Photo mode's panel loads the first time it's opened; the HUD and the tutorial hide while it's on.
const PhotoPanel = lazy(() => import('./photo/PhotoPanel'));

/** This long inside the office without the tab being killed, and the start counts as settled (officeBoot.ts). */
const SETTLED_MS = 15_000;

/** The start-up breadcrumb's steps: mounted, then entered, then settled. */
function useBootSteps() {
  const started = useStore((s) => s.started);
  useEffect(() => {
    if (!started) return void bootStep('starting the 3D view');
    bootStep('entering the office');
    const t = setTimeout(bootDone, SETTLED_MS);
    return () => clearTimeout(t);
  }, [started]);
}

export default function Office() {
  const photo = usePhotoGate((s) => s.active);
  useEffect(installPhoto, []);
  useTouchPage();
  useBootSteps();
  return (
    <>
      <Game />
      {photo ? (
        <Suspense fallback={null}>
          <PhotoPanel />
        </Suspense>
      ) : (
        <HUD />
      )}
      {!photo && <TouchStick />}
      <ReplayBar />
      <Overlays />
      <HoldMenu />
      {!photo && <Tutorial />}
      <StartScreen />
      {statsEnabled && <StatsReadout />}
    </>
  );
}
