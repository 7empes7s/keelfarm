// The office's websocket addresses. Opened through another office's preview gateway (/preview/<port>/, #192), a
// socket has to keep that mount: the preview worker can't rewrite websockets, and the root /ws is the other office's.

const MOUNT = /^\/preview\/\d{1,5}(?=\/)/;

/** The /preview/<port> this page is served under, or '' on the office's own address. */
export function mountOf(pathname: string): string {
  return pathname.match(MOUNT)?.[0] ?? '';
}

/** A websocket URL for one of the office's own paths (/ws, /ws/term?...), under the page's mount. */
export function socketUrl(path: string, loc: Pick<Location, 'protocol' | 'host' | 'pathname'> = location): string {
  const proto = loc.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${loc.host}${mountOf(loc.pathname)}${path}`;
}
