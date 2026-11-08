import type http from 'node:http';
import type net from 'node:net';
import { passHeaders, syncedHeaders, tunnel, upstream } from './syncProxy.ts';

// The preview gateway: previews (and compare mode's sync proxies) listen on loopback ports, which a browser on another
// device (a tablet over Tailscale Serve, a reverse proxy) can't reach. The office passes /preview/<port>/... on to that
// port instead, for running previews only, so a preview works wherever the office itself does. Apps ask for their own
// root paths (/assets/app.js, /api/todos), which would land on the office: a small service worker, scoped to
// /preview/, sends a framed preview's requests back under its /preview/<port>/, and a full page load that escapes
// (a link to /about) is sent back by the office. What can't follow: WebSockets opened at root paths (a dev server's
// hot reload), and client-side routers, which see /preview/<port>/ in the address.
// Every request and socket through here is a use of its preview (#252), and its pages get a heartbeat that says so
// while they're visible, so a preview open in its own tab doesn't stop under the manager.

/** Where a preview's paths start on the office's address. */
export const GATEWAY = '/preview/';
export const GATEWAY_WORKER = `${GATEWAY}sw.js`;

const MOUNT = /^\/preview\/(\d{1,5})(.*)$/;
/** The office's own path under a preview's mount, for its pages' heartbeat and "Keep it running". */
const BEAT_PATH = /^\/\.cubefarm\/(beat|keep)$/;
/** How often a visible gateway page says it's in use. */
const PAGE_BEAT_MS = 15_000;

/** What the gateway tells the previews about their use. */
export interface GatewayUse {
  /** A request or socket to a preview port opened: in use until the returned close. */
  opened(port: number): () => void;
  /** A visible page's heartbeat (keep: its "Keep it running"): the lifetime it has left, for its banner; null: no preview there. */
  beat(port: number, keep: boolean): { lifeLeftMs: number | null } | null;
}

/** A gateway path's preview port and the app's own path; `slash` when the mount needs its trailing "/" first. */
export function parseMount(url: string): { port: number; path: string; slash: boolean } | null {
  const m = url.match(MOUNT);
  if (!m) return null;
  const port = Number(m[1]);
  if (port < 1 || port > 65535) return null;
  const rest = m[2];
  if (rest === '' || rest.startsWith('?')) return { port, path: `/${rest}`, slash: true };
  return rest.startsWith('/') ? { port, path: rest, slash: false } : null;
}

/** A redirect from the app stays under its mount: to the app's own loopback address, or to one of its root paths. */
export function gatewayLocation(location: string, port: number): string {
  const abs = location.match(/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]):(\d+)(.*)$/i);
  if (abs) return Number(abs[2]) === port ? `${GATEWAY}${port}${abs[3] || '/'}` : location;
  return location.startsWith('/') && !location.startsWith('//') && !location.startsWith('/\\') ? `${GATEWAY}${port}${location}` : location;
}

/**
 * Runs first on a gateway page: until the preview worker controls it, the page stops loading, the worker is
 * registered and the page loads again under it. Twice at most, then the page shows as it is.
 */
export const BOOT_SCRIPT = `<script data-cubefarm-preview>(function(){
var w=navigator.serviceWorker,k='cubefarm-preview-boot',s;if(!w)return;try{s=sessionStorage}catch(e){return}
var c=w.controller;if(c&&/\\/preview\\/sw\\.js$/.test(c.scriptURL)){s.removeItem(k);return}
var n=+(s.getItem(k)||0);if(n>1){s.removeItem(k);return}s.setItem(k,String(n+1));
function go(){location.reload()}
window.stop();
w.register('${GATEWAY_WORKER}',{scope:'${GATEWAY}'}).then(function(r){var i=r.installing||r.waiting;if(!i)return go();
i.addEventListener('statechange',function(){if(i.state==='activated'||i.state==='redundant')go()})},go);
})();</script>`;

/**
 * A gateway page's heartbeat (#252): while the page is visible it tells the office every 15 s, without credentials,
 * that its preview is in use, and in the last minute of the preview's max lifetime it shows "Still using it?".
 */
export const BEAT_SCRIPT = `<script data-cubefarm-beat>(function(){
var m=location.pathname.match(/^\\/preview\\/\\d{1,5}(?=\\/)/),b,d=document;if(!m||!window.fetch)return;var u=m[0]+'/.cubefarm/';
function send(k){if(!k&&d.visibilityState!=='visible')return;fetch(u+(k?'keep':'beat'),{method:'POST',credentials:'omit',cache:'no-store'}).then(function(r){return r.ok?r.json():null}).then(show,function(){})}
function show(x){var l=x&&x.lifeLeftMs;if(l==null||l>60000){if(b){b.remove();b=null}return}if(b||!d.body)return;
b=d.createElement('div');b.setAttribute('role','alert');b.style.cssText='position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;display:flex;gap:12px;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:12px;background:#1f2430;color:#fff;font:15px/1.3 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35)';
b.textContent='Still using it? This preview stops in a minute.';var k=d.createElement('button');k.textContent='Keep it running';k.style.cssText='min-height:44px;padding:0 14px;border:0;border-radius:10px;background:#4f8cff;color:#fff;font:inherit;cursor:pointer';k.onclick=function(){send(1)};b.appendChild(k);d.body.appendChild(b)}
send();setInterval(send,${PAGE_BEAT_MS});d.addEventListener('visibilitychange',function(){send()});
})();</script>`;

/** The page with the boot script at the very top of its head (or of the page, when it has none), and the heartbeat after it. */
export function injectBoot(html: string): string {
  if (html.includes('data-cubefarm-preview')) return html;
  const scripts = BOOT_SCRIPT + BEAT_SCRIPT;
  const head = html.match(/<head(\s[^>]*)?>/i);
  if (head?.index !== undefined) return html.slice(0, head.index + head[0].length) + scripts + html.slice(head.index + head[0].length);
  const doctype = html.match(/^\s*<!doctype[^>]*>/i);
  if (doctype) return doctype[0] + scripts + html.slice(doctype[0].length);
  return scripts + html;
}

/**
 * The page's own scripts and stylesheets at root paths, put under its mount: a module script keeps the address it
 * was asked for, while its imports resolve against the worker's answer under the mount, so the app's entry would run
 * twice (a Vite app's two React roots, a blank page: #192).
 */
export function mountAssets(html: string, port: number): string {
  return html.replace(/(<(?:script|link)\b[^>]*?\s(?:src|href)=)(["'])\/(?![/\\]|preview\/\d)/gi, `$1$2${GATEWAY}${port}/`);
}

/** The preview worker, served at GATEWAY_WORKER. It only sees pages under /preview/ and the requests they make. */
export const WORKER_SOURCE = `// cubefarm's preview worker (server/previewGateway.ts): keeps a preview's root paths under its /preview/<port>/.
const MOUNT = /^\\/preview\\/\\d{1,5}(?=\\/)/;
const mounts = new Map(); // client id -> its mount, kept when the app moves its address with pushState

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

async function mountOf(id) {
  if (!id) return null;
  const client = await self.clients.get(id);
  const m = client && new URL(client.url).pathname.match(MOUNT);
  if (m) mounts.set(id, m[0]);
  return mounts.get(id) || null;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || req.mode === 'navigate') return;
  event.respondWith(
    mountOf(event.clientId).then(async (mount) => {
      if (!mount || url.pathname.startsWith(mount + '/')) return fetch(req);
      const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();
      return fetch(mount + url.pathname + url.search, { method: req.method, headers: req.headers, body, credentials: req.credentials, cache: req.cache, redirect: req.redirect, integrity: req.integrity, signal: req.signal });
    }),
  );
});
`;

/**
 * Where a page load that left its preview belongs: a frame or tab showing /preview/<port>/... that follows a link to
 * one of the app's root paths. Null for everything else, the office's own pages included.
 */
export function escapedTo(req: { method?: string; url?: string; headers: http.IncomingHttpHeaders }, proxied: (port: number) => boolean): string | null {
  // A page load passed on by the office's own worker (server/pwa.ts) keeps its mode but says its destination is "empty".
  const dest = req.headers['sec-fetch-dest'];
  const load = req.headers['sec-fetch-mode'] === 'navigate' || dest === 'iframe' || dest === 'frame' || dest === 'document';
  if (req.method !== 'GET' || req.headers['sec-fetch-site'] !== 'same-origin' || !load) return null;
  const url = req.url ?? '/';
  if (url.startsWith(GATEWAY) || url.startsWith('/api/') || url.startsWith('/ws') || url === '/sw.js') return null;
  let from: string;
  try {
    from = new URL(String(req.headers.referer ?? '')).pathname;
  } catch {
    return null;
  }
  const at = parseMount(from);
  return at && proxied(at.port) ? `${GATEWAY}${at.port}${url}` : null;
}

/**
 * A request on the office's address: a gateway path goes on to its preview, a page load that escaped one goes back
 * under it. False when it's neither (the office handles it).
 */
export function handleGateway(req: http.IncomingMessage, res: http.ServerResponse, proxied: (port: number) => boolean, use?: GatewayUse): boolean {
  const url = req.url ?? '/';
  if (url === GATEWAY_WORKER || url.startsWith(`${GATEWAY_WORKER}?`)) {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' }).end(WORKER_SOURCE);
    return true;
  }
  const back = escapedTo(req, proxied);
  if (back) {
    res.writeHead(302, { location: back, 'cache-control': 'no-store' }).end();
    return true;
  }
  const at = parseMount(url);
  if (!at) return false;
  if (!proxied(at.port)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end(`No preview is running on port ${at.port}.`);
    return true;
  }
  if (at.slash) {
    res.writeHead(301, { location: `${GATEWAY}${at.port}${at.path}` }).end();
    return true;
  }
  const beat = at.path.match(BEAT_PATH);
  if (beat) {
    const said = req.method === 'POST' ? (use?.beat(at.port, beat[1] === 'keep') ?? null) : null;
    res.writeHead(said ? 200 : 404, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(said ?? { error: 'not a running preview' }));
    req.resume();
    return true;
  }
  // In use while the request is open (a long poll, server-sent events) and from when it ends.
  const done = use?.opened(at.port);
  if (done) res.once('close', done);
  // The body is buffered first: a request retried on IPv6 has to be sent again.
  const body: Buffer[] = [];
  req.on('data', (c: Buffer) => body.push(c));
  req.once('end', () =>
    upstream(
      at.port,
      req,
      Buffer.concat(body),
      (ur) => {
        const headers = passHeaders(ur.headers);
        if (typeof headers.location === 'string') headers.location = gatewayLocation(headers.location, at.port);
        const html = /^text\/html/i.test(String(headers['content-type'] ?? '')) && !headers['content-encoding'] && req.method !== 'HEAD';
        if (!html) {
          res.writeHead(ur.statusCode ?? 502, headers);
          ur.pipe(res);
          return;
        }
        const chunks: Buffer[] = [];
        ur.on('data', (c: Buffer) => chunks.push(c));
        ur.once('end', () => {
          const page = Buffer.from(injectBoot(mountAssets(Buffer.concat(chunks).toString('utf8'), at.port)), 'utf8');
          res.writeHead(ur.statusCode ?? 200, syncedHeaders(headers, page.length));
          res.end(page);
        });
        ur.once('error', () => res.destroy());
      },
      (err) => {
        if (res.headersSent) return void res.destroy();
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }).end(`The app isn't answering on port ${at.port}: ${err.message}`);
      },
      at.path,
    ),
  );
  return true;
}

/** A WebSocket on a gateway path goes on to its preview; false when the path isn't one. */
export function upgradeGateway(req: http.IncomingMessage, socket: net.Socket, head: Buffer, proxied: (port: number) => boolean, use?: GatewayUse): boolean {
  const at = parseMount(req.url ?? '/');
  if (!at) return false;
  if (!proxied(at.port) || at.slash) {
    socket.destroy();
    return true;
  }
  const done = use?.opened(at.port); // an open socket keeps its preview in use
  if (done) socket.once('close', done);
  tunnel(at.port, req, socket, head, at.path);
  return true;
}
