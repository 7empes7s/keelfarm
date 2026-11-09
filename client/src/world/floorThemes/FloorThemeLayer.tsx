import { Component, lazy, Suspense, useEffect, type ReactNode } from 'react';
import type { RepoView } from '../../../../shared/types';
import type { Agent } from '../../store';
import { useLatestShot } from '../AppMonitor';
import { InstancedModel } from '../decor/Decorations';
import { startAmbience } from './ambience';
import { setFloorMood } from './floorLook';
import type { ThemePack } from './packs';

// A themed floor (#370) in the 3D office: its mood (lights and grade, floorLook.ts) and ambience while it's on screen,
// and its dressing from the lazy chunk (scenes.tsx), downloaded the first time a themed floor is shown. The plain
// office has no pack and none of this runs.

const ThemeScene = lazy(() => import('./scenes').then((m) => ({ default: m.ThemeScene })));
const OFFICE = { InstancedModel, useLatestShot };

/** A theme that fails to load (offline after an update, say) leaves the floor as it is. */
class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.warn('floor theme failed to load', err);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function FloorThemeLayer({ pack, repo, agents }: { pack: ThemePack | null; repo: RepoView; agents: Agent[] }) {
  useEffect(() => {
    setFloorMood(pack?.mood ?? null);
    return () => setFloorMood(null);
  }, [pack]);
  useEffect(() => (pack ? startAmbience(pack.ambience) : undefined), [pack]);
  if (!pack) return null;
  return (
    <Quiet key={pack.id}>
      <Suspense fallback={null}>
        <ThemeScene pack={pack} repo={repo} agents={agents} office={OFFICE} />
      </Suspense>
    </Quiet>
  );
}
