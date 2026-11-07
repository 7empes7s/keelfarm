// The installable app's service worker (docs/pocket.md), served by the office at /sw.js. Its version is the build's
// index.html, the package version and the office's commit, so every office update makes a new worker, which drops the
// old cache. It caches only the app shell (the page and its hashed /assets/, icons and manifest): never /api, the
// websockets or anything else. It also shows Web Push notifications (not while an office window is in use, #210),
// closes those read elsewhere, and opens the office when one is tapped.
import crypto from 'node:crypto';

/** A short version: changes when the built page, the package or the office's commit does. */
export function swVersion(indexHtml: string, packageVersion: string, commit: string | null): string {
  return crypto.createHash('sha256').update(`${packageVersion}\n${commit ?? ''}\n${indexHtml}`).digest('hex').slice(0, 12);
}

/** The worker itself. Only `version` changes between offices. */
export function serviceWorkerSource(version: string): string {
  return `// cubefarm's service worker (server/pwa.ts). Version ${version}.
const VERSION = ${JSON.stringify(version)};
const CACHE = 'cubefarm-shell-' + VERSION;
const PRECACHE = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('cubefarm-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** The app shell: the page, its hashed bundles, the icons and the manifest. Never /api, /ws or the worker itself. */
function isShell(url) {
  return url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest';
}

/** Keeps a response in this version's cache, unless a newer worker has already deleted it (it then stays deleted). */
async function keep(req, res) {
  if (res.ok && (await caches.has(CACHE))) await (await caches.open(CACHE)).put(req, res);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return;
  if (req.mode === 'navigate') {
    // The page: always the office's latest; this version's copy (cached when it installed) only while it can't be reached.
    event.respondWith(fetch(req).catch(() => caches.open(CACHE).then((c) => c.match('/')).then((hit) => hit || Response.error())));
    return;
  }
  if (!isShell(url)) return;
  // Bundles are content-hashed, so a cached one never goes stale.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          event.waitUntil(keep(req, res.clone()));
          return res;
        }),
    ),
  );
});

self.addEventListener('push', (event) => {
  let n = { title: 'cubefarm', body: '', tag: 'cubefarm', url: '/' };
  try {
    n = Object.assign(n, event.data ? event.data.json() : {});
  } catch {}
  event.waitUntil(onPush(n));
});

/** A push: shown with its thread's tag, replacing the last; a clear closes that thread's; nothing while the office is in use here. */
async function onPush(n) {
  // Read on another device (server/notify.ts): close what this one still shows.
  if (n.type === 'clear') {
    for (const old of await self.registration.getNotifications({ tag: n.tag })) old.close();
    return;
  }
  // A second guard to the office's own (#210): an office window here is on screen and focused, so it shows this already.
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (windows.some((c) => c.visibilityState === 'visible' && c.focused)) return;
  await self.registration.showNotification(n.title, { body: n.body, tag: n.tag, renotify: true, icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', data: { url: n.url } });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => new URL(c.url).origin === self.location.origin);
      if (!open) return self.clients.openWindow(url);
      open.postMessage({ type: 'cubefarm:open', url });
      return open.focus();
    }),
  );
});
`;
}
