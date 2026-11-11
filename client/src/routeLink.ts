// Deep links in the running office (#413): opens the address's route once the snapshot is in (and again when the
// hash changes), writes what's open back to the address, and says when the routed view is on screen:
// <html data-route="#…" data-route-ready="1"> ("unknown": the link names nothing here; "missing": its view never
// showed). The table and the rules are pure, in routes.ts; the 3D office passes how to stand at a spot.
import { useEffect } from 'react';
import { useStore, type State } from './store';
import { useTour } from './ui/tour';
import { ownsHash, overlayRoute, parseRoute, routeHash, routeTarget, ROUTES, sampleLinks, type Mode, type Stand, type World } from './routes';

const READY_MS = 15_000;

const worldOf = (s: State): World => ({ repos: s.repos, agents: s.agents, floor: s.floor });
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Waits for `ok` (polled), up to `ms`; true once it holds. */
async function until(ok: () => boolean, ms: number) {
  for (const end = performance.now() + ms; performance.now() < end; await sleep(100)) if (ok()) return true;
  return ok();
}

const mark = (hash: string, ready: string | null) => {
  const el = document.documentElement;
  el.dataset.route = hash;
  if (ready) el.dataset.routeReady = ready;
  else delete el.dataset.routeReady;
};

let seq = 0; // the latest link being opened: an older one's wait stops
let applied = false; // the address's own link has been opened (until then pocket mode doesn't rewrite it)

async function open(mode: Mode, hash: string, cold: boolean, stand?: (s: Stand) => boolean) {
  const mine = ++seq;
  mark(hash, null);
  const route = parseRoute(hash);
  const s = useStore.getState();
  const t = route && routeTarget(route, worldOf(s), mode);
  applied = true;
  if (!route) return void (await frame(), mine === seq && mark(hash, '1'));
  if (!t) return mark(hash, 'unknown');
  if (mode === 'office' && !s.started) s.start(); // a link goes straight in, past the start screen
  if (t.tab) window.dispatchEvent(new CustomEvent('cubefarm:open', { detail: `?tab=${t.tab}` }));
  if (t.tour) useTour.setState({ replay: { ids: [t.tour], at: 0 } });
  if (t.stand && stand) {
    const to = t.stand.floor;
    if (useStore.getState().floor !== to) {
      if (cold) useStore.setState({ floor: to });
      else useStore.getState().goToFloor(to);
    }
    await until(() => useStore.getState().floor === to && !useStore.getState().travel, READY_MS);
    await frame();
    await frame(); // the player has arrived on the floor (its spawn) before it's moved
    // a cold link's 3D view mounts the player only once its chunks load and the scene builds: give it the full wait
    const stood = mine === seq && (await until(() => mine !== seq || stand(t.stand!), READY_MS));
    if (mine !== seq) return;
    if (!stood) return mark(hash, 'missing');
  }
  if (t.overlay && !(cold && t.native)) useStore.getState().openOverlay(t.overlay);
  const ok = await until(() => mine !== seq || !t.ready || !!document.querySelector(t.ready), READY_MS);
  if (mine !== seq) return;
  await frame();
  mark(hash, ok ? '1' : 'missing');
}

/** What's open now, as the address's hash (replaced, never a new history entry: Back stays the panels', backStack.ts). */
function write(mode: Mode) {
  const s = useStore.getState();
  const r = overlayRoute(s.overlay, worldOf(s), mode);
  const base = location.pathname + location.search;
  if (r) history.replaceState(history.state, '', base + routeHash(r));
  else if (ownsHash(location.hash, mode)) history.replaceState(history.state, '', base);
}

/** Pocket mode's tab in the address (?tab=), dropping a tab link the tab has moved on from. */
export function showTab(tab: string) {
  if (!applied) return;
  const r = parseRoute(location.hash);
  const stale = (r?.to === 'tab' && r.tab !== tab) || (r?.to === 'kanban' && tab !== 'kanban');
  const q = new URLSearchParams(location.search);
  q.set('tab', tab);
  history.replaceState(history.state, '', `${location.pathname}?${q}${stale ? '' : location.hash}`);
}

/** Opens the address's link once loaded, follows hash changes, and keeps the address on what's open. */
export function useRouteLink(mode: Mode, stand?: (s: Stand) => boolean) {
  const ready = useStore((s) => s.loaded && (mode === 'pocket' || s.settings.setupDone));
  useEffect(() => {
    if (!ready) return;
    void open(mode, location.hash, true, stand);
    let popped = 0;
    const onPop = () => void (popped = performance.now());
    // Back to an entry with another hash fires hashchange after popstate: that's Back closing a panel, not a link.
    const onHash = () => void (performance.now() - popped > 50 && open(mode, location.hash, false, stand));
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onHash);
    const unsubscribe = useStore.subscribe((s, prev) => void (s.overlay !== prev.overlay && write(mode)));
    (window as unknown as Record<string, unknown>).__swarmRoutes = { table: ROUTES, links: () => sampleLinks(worldOf(useStore.getState()), mode) };
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onHash);
      unsubscribe();
    };
  }, [ready, mode, stand]);
}
