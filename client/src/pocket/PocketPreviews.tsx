// Pocket mode's way to the Previews page (#226): the rail's entry with its badge, the page's host beside the chat,
// and the #previews/<floor>/<main|pr-N> deep link.
import { lazy, useEffect } from 'react';
import { useStore } from '../store';
import { Icon } from '../ui/Icon';
import { parsePreviewsHash } from '../ui/previewGroups';
import { useRunningPreviews } from '../ui/runningPreviews';

const PreviewsPage = lazy(() => import('../ui/PreviewsPage').then((m) => ({ default: m.PreviewsPage })));

/** The Previews page over the pages beside the chat: from the menu, and wherever a floor's app is opened. */
export function PreviewsHost() {
  const overlay = useStore((s) => s.overlay);
  if (overlay?.kind !== 'app' && overlay?.kind !== 'previews') return null;
  return <PreviewsPage key={`${overlay.repoId}:${overlay.pr}`} repoId={overlay.repoId} pr={overlay.pr} qa={overlay.qa} merged={overlay.merged} path={overlay.path} />;
}

/** The rail's Previews entry, with a badge for the previews starting or running. */
export function PreviewsRailButton({ open }: { open: boolean }) {
  const running = useRunningPreviews();
  return (
    <button
      data-tour="previews"
      className={`pk-tab ${open ? 'pk-tab-on' : ''}`}
      aria-pressed={open}
      onClick={() => useStore.getState().openOverlay(open ? null : { kind: 'previews' })}
      title="Previews: every live app and PR preview"
    >
      <span className="pk-tab-icon">
        <Icon name="monitor" />
        {running > 0 && (
          <span className="badge badge-dot" role="img" aria-label={`${running} running`}>
            {running}
          </span>
        )}
      </span>
      <span className="pk-tab-label">Previews</span>
    </button>
  );
}

/** A link to the Previews page (#previews/3/pr-12) opens it once the floors are known. */
export function usePreviewsLink(loaded: boolean) {
  useEffect(() => {
    const link = loaded ? parsePreviewsHash(location.hash) : null;
    if (!link) return;
    const repo = useStore.getState().repos.find((r) => r.floor === link.floor);
    useStore.getState().openOverlay({ kind: 'previews', repoId: repo?.id, pr: repo ? link.pr : null });
  }, [loaded]);
}
