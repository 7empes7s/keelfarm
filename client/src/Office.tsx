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
import { TourInvite, Tutorial } from './ui/Tutorial';
import { TaskTutorial, TutorialInvite } from './ui/TaskTutorial';
import { HoldMenu } from './ui/HoldMenu';
import { TouchStick } from './ui/TouchStick';
import { useTouchPage } from './ui/touchMode';
import { useRouteLink } from './routeLink';
import type { Stand } from './routes';
import { standAt } from './world/Player';
import { standPose } from './world/routeStand';
import { SearchPalette } from './ui/SearchPalette';
import { GuideSheet } from './ui/GuideCard';

// Photo mode's panel loads the first time it's opened; the HUD and the tutorial hide while it's on.
const PhotoPanel = lazy(() => import('./photo/PhotoPanel'));

/** This long inside the office without the tab being killed, and the start counts as settled (officeBoot.ts). */
const SETTLED_MS = 15_000;

/** A deep link's place (#413): the player stands there, looking at it. */
function stand(s: Stand) {
  const p = standPose(s.at);
  return standAt(p.x, p.z, p.yaw, p.pitch);
}

/** The start-up breadcrumb's steps: mounted, then entered, then settled. */
function useBootSteps() {
  const started = useStore((s) => s.started);
  useEffect(() => {
    bootStep(started ? 'entering the office' : 'starting the 3D view');
    if (!started) return;
    const t = setTimeout(bootDone, SETTLED_MS);
    return () => clearTimeout(t);
  }, [started]);
}

export default function Office() {
  const photo = usePhotoGate((s) => s.active);
  useEffect(installPhoto, []);
  useTouchPage();
  useBootSteps();
  useRouteLink('office', stand);
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
      {!photo && <Tutorial track="office" />}
      {!photo && <TourInvite track="office" floating />}
      {!photo && <TutorialInvite track="office" floating />}
      {!photo && <TaskTutorial track="office" />}
      <SearchPalette where="office" />
      <GuideSheet />
      <StartScreen />
      {statsEnabled && <StatsReadout />}
    </>
  );
}
