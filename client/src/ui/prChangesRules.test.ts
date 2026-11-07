import { describe, expect, it } from 'vitest';
import { cardOpen, liveAgent, openingPath, pagePath, prPages, remember, routesFromFiles, shotPages, type PrMemory } from './prChangesRules';

describe('pagePath', () => {
  it('keeps the path, query and hash of a page', () => {
    expect(pagePath('http://localhost:5660/settings/team?x=1#top')).toBe('/settings/team?x=1#top');
    expect(pagePath('http://127.0.0.1:6301/')).toBe('/');
    expect(pagePath('http://localhost:6301')).toBe('/');
  });
  it('drops the office gateway prefix', () => {
    expect(pagePath('https://office.example/preview/6301/todos')).toBe('/todos');
    expect(pagePath('https://office.example/preview/6301')).toBe('/');
  });
  it('has no path for blank or non-web pages', () => {
    expect(pagePath(null)).toBeNull();
    expect(pagePath('about:blank')).toBeNull();
    expect(pagePath('data:text/html,hi')).toBeNull();
    expect(pagePath('not a url')).toBeNull();
  });
});

describe('shotPages', () => {
  it('turns QA screenshots into pages, one per path, first shot kept', () => {
    const shots = [
      { page: 'http://localhost:5660/', caption: 'Home' },
      { page: 'http://localhost:5660/settings', caption: 'Settings' },
      { page: 'http://localhost:5660/', caption: 'Home at 375px' },
      { page: null, caption: 'No page' },
      { page: 'http://localhost:5660/settings#team', caption: 'Team' },
    ];
    expect(shotPages(shots)).toEqual([
      { path: '/settings', caption: 'Settings', shot: 1 },
      { path: '/settings#team', caption: 'Team', shot: 4 },
      { path: '/', caption: 'Home', shot: 0 },
    ]);
  });
  it('keeps the home page when it is the only one', () => {
    expect(shotPages([{ page: 'http://localhost:1/', caption: 'Home' }])).toEqual([{ path: '/', caption: 'Home', shot: 0 }]);
  });
  it('is empty without shots', () => {
    expect(shotPages(undefined)).toEqual([]);
  });
});

describe('routesFromFiles', () => {
  it("maps this office's screens to their hash routes, deduped", () => {
    const files = ['server/swarm.ts', 'client/src/ui/CharterTab.tsx', 'client/src/ui/CharterStats.tsx', 'client/src/ui/NotifySettings.tsx'];
    expect(routesFromFiles('7empes7s/keelfarm', files).map((p) => p.path)).toEqual(['/#company/charter', '/#settings/notifications']);
  });
  it('leaves office rules to the office floors', () => {
    expect(routesFromFiles('acme/shop', ['client/src/ui/CharterTab.tsx'])).toEqual([]);
  });
  it('reads file-based routers on any floor', () => {
    const files = ['app/settings/team/page.tsx', 'app/page.tsx', 'src/pages/about.tsx', 'pages/blog/index.tsx', 'src/routes/cart/+page.svelte', 'app/(shop)/basket/page.tsx'];
    expect(routesFromFiles('acme/shop', files, 10).map((p) => p.path)).toEqual(['/settings/team', '/', '/about', '/blog', '/cart', '/basket']);
  });
  it('stops at max', () => {
    expect(routesFromFiles('acme/shop', ['app/a/page.tsx', 'app/b/page.tsx', 'app/c/page.tsx'], 2)).toHaveLength(2);
  });
});

describe('prPages', () => {
  it("prefers QA's pages over the guess", () => {
    expect(prPages('acme/shop', [{ page: 'http://localhost:1/cart', caption: 'Cart' }], ['app/a/page.tsx']).map((p) => p.path)).toEqual(['/cart']);
    expect(prPages('acme/shop', [], ['app/a/page.tsx']).map((p) => p.path)).toEqual(['/a']);
    expect(prPages('acme/shop', undefined, undefined)).toEqual([]);
  });
});

describe('openingPath', () => {
  it('opens at the first page once, then where it was left', () => {
    const first = openingPath({}, 'o/r#5', '/settings', 1);
    expect(first.path).toBe('/settings');
    expect(first.memory['o/r#5'].path).toBe('/settings');
    const moved = remember(first.memory, 'o/r#5', { path: '/todos' }, 2);
    expect(openingPath(moved, 'o/r#5', '/settings', 3).path).toBe('/todos');
  });
  it('opens at / without pages and remembers nothing, so later pages still count', () => {
    const none = openingPath({}, 'o/r#5', null, 1);
    expect(none).toEqual({ path: '/', memory: {} });
    expect(openingPath(none.memory, 'o/r#5', '/cart', 2).path).toBe('/cart');
  });
  it('keeps each PR apart', () => {
    const a = openingPath({}, 'o/r#5', '/a', 1).memory;
    expect(openingPath(a, 'o/r#6', '/b', 2).path).toBe('/b');
  });
});

describe('cardOpen and remember', () => {
  it('opens the card the first time, then as left', () => {
    expect(cardOpen({}, 'o/r#5')).toBe(true);
    expect(cardOpen(remember({}, 'o/r#5', { closed: true }, 1), 'o/r#5')).toBe(false);
  });
  it('keeps the newest 60 PRs', () => {
    let m: PrMemory = {};
    for (let i = 0; i < 65; i++) m = remember(m, `o/r#${i}`, { path: '/' }, i);
    expect(Object.keys(m)).toHaveLength(60);
    expect(m['o/r#0']).toBeUndefined();
    expect(m['o/r#64']).toBeDefined();
  });
});

describe('liveAgent', () => {
  const a = (repoId: string, prNumber: number | null, task: 'issue' | 'qa' | 'fix' | null, status: 'working' | 'idle' | 'done') => ({ repoId, prNumber, task, status });
  it('finds who is testing or fixing the PR now', () => {
    const agents = { x: a('o/r', 5, 'issue', 'working'), y: a('o/r', 5, 'qa', 'done'), z: a('o/q', 5, 'qa', 'working'), w: a('o/r', 5, 'fix', 'working') };
    expect(liveAgent(agents, 'o/r', 5)).toBe(agents.w);
    expect(liveAgent(agents, 'o/r', 6)).toBeNull();
  });
});
