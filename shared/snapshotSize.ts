// A snapshot's size measured the same on every OS (#595): Windows' CRLF, backslash paths and longer temp and home
// folders made the same office ~2 KB bigger there, so a byte count flapped between CI runners. Strings are measured
// with LF line ends, forward slashes, and the machine's own folders (the office's home, the user's, temp) as `~`.

/** The JSON a size is measured on: `roots` (the office's home, the user's home, temp…) become `~`, then LF and `/`. */
export function normalisedJson(value: unknown, roots: readonly string[] = []): string {
  const sorted = [...new Set(roots.filter(Boolean))].sort((a, b) => b.length - a.length); // a home inside temp goes first
  return JSON.stringify(value, (_key, v: unknown) => (typeof v === 'string' ? normaliseText(v, sorted) : v));
}

function normaliseText(s: string, roots: readonly string[]): string {
  let out = s;
  for (const r of roots) if (out.includes(r)) out = out.split(r).join('~');
  return out.replace(/\r\n/g, '\n').replace(/\\/g, '/').replace(/(^|[\s"'(=])[A-Za-z]:\//g, '$1/');
}

/** Its size in UTF-8 bytes. */
export const normalisedBytes = (value: unknown, roots: readonly string[] = []) => new TextEncoder().encode(normalisedJson(value, roots)).length;
