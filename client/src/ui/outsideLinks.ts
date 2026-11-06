// In the home-screen app there's no browser Back button: a link that replaces the page leaves no way back to the
// office (#129). There, links away from the office's own pages open in a new tab instead.

/** Whether following a link to `href` (with this `target`) would replace the office in this tab with another page. */
export function opensOutside(href: string, origin: string, target: string): boolean {
  if (target && target !== '_self') return false;
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false; // mailto:, tel: … leave the page alone
  return url.origin !== origin || url.pathname.startsWith('/preview/') || url.pathname.startsWith('/api/');
}

/** In the home-screen app, sends links that would replace the office to a new tab; call once at startup. */
export function keepOfficeOpen(standalone: boolean) {
  if (!standalone) return;
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.('a[href]');
    if (!(a instanceof HTMLAnchorElement) || !opensOutside(a.href, location.origin, a.target)) return;
    e.preventDefault();
    window.open(a.href, '_blank', 'noopener');
  });
}
