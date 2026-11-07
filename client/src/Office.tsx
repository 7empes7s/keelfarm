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
import { HoldMenu } from './ui/HoldMenu';
import { TouchStick } from './ui/TouchStick';
import { useTouchPage } from './ui/touchMode';
import { parseHash } from './ui/consoleNavRules';
import { parsePreviewsHash } from './ui/previewGroups';
import { SearchPalette } from './ui/SearchPalette';
import { GuideSheet } from './ui/GuideCard';

// Photo mode's panel loads the first time it's opened; the HUD and the tutorial hide while it's on.
const PhotoPanel = lazy(() => import('./photo/PhotoPanel'));

/** This long inside the office without the tab being killed, and the start counts as settled (officeBoot.ts). */
const SETTLED_MS = 15_000;

/** How long after entering a linked console section opens: opened sooner, while entering settles (the mouse grab and
 * the first heavy frames), Chrome can leave its clicks landing on the wrong element. */
const LINK_OPEN_MS = 2500;

/** A link to a console section (#settings/cloud-agents) opens it once you're in. Returns its cancel. */
function openLinkedSection() {
  const link = parseHash(location.hash, 'office');
  const previews = parsePreviewsHash(location.hash); // the Previews page (#226)
  if (!link && !previews) return () => undefined;
  const open = () => {
    const s = useStore.getState();
    if (s.overlay) return; // unless you opened something meanwhile
    if (link) return s.openOverlay({ kind: 'manager', tab: link.id });
    const repo = s.repos.find((r) => r.floor === previews?.floor);
    s.openOverlay({ kind: 'previews', repoId: repo?.id, pr: repo ? previews?.pr : null });
  };
  const t = setTimeout(open, LINK_OPEN_MS);
  return () => clearTimeout(t);
}

/** The start-up breadcrumb's steps: mounted, then entered, then settled. */
function useBootSteps() {
  const started = useStore((s) => s.started);
  useEffect(() => {
    bootStep(started ? 'entering the office' : 'starting the 3D view');
    if (!started) return;
    const stopLink = openLinkedSection();
    const t = setTimeout(bootDone, SETTLED_MS);
    return () => {
      clearTimeout(t);
      stopLink();
    };
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
      {!photo && <Tutorial track="office" />}
      {!photo && <TourInvite track="office" floating />}
      <SearchPalette where="office" />
      <GuideSheet />
      <StartScreen />
      {statsEnabled && <StatsReadout />}
    </>
  );
}
