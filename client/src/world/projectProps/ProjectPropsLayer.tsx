import { Component, lazy, Suspense, type ReactNode } from 'react';
import type { RepoView } from '../../../../shared/types';
import type { Agent } from '../../store';
import { useLatestShot } from '../AppMonitor';
import { repoDeskTool, repoPropSet } from './spots';

// A floor's project props (#536) in the 3D office: its set's things, screens and desk tools from a lazy chunk
// (scene.tsx), downloaded the first time an office floor is shown. Every office floor has a set.

const ProjectScene = lazy(() => import('./scene').then((m) => ({ default: m.ProjectScene })));
const OFFICE = { useLatestShot };

/** Props that fail to load (offline after an update, say) leave the floor as it is. */
class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.warn('project props failed to load', err);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function ProjectPropsLayer({ repo, agents }: { repo: RepoView; agents: Agent[] }) {
  const set = repoPropSet(repo);
  return (
    <Quiet key={set}>
      <Suspense fallback={null}>
        <ProjectScene set={set} tool={repoDeskTool(repo)} repo={repo} agents={agents} office={OFFICE} />
      </Suspense>
    </Quiet>
  );
}
