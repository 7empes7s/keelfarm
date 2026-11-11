// Installing a missing coding-agent CLI (#493), the pure part: an npm log's tail and OpenCode's signed-in providers.

/** The last lines of a log, colours stripped, for the card. */
export function logTail(text: string, n = 8): string[] {
  return text
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .split(/\r?\n/)
    .map((l) => l.trimEnd().slice(0, 200))
    .filter((l) => l.trim())
    .slice(-n);
}

/** OpenCode's signed-in providers from `opencode auth list`: its "●  Anthropic oauth" lines above the Environment part. */
export function opencodeProviders(text: string): string[] {
  const out: string[] = [];
  for (const raw of logTail(text, 200)) {
    if (/environment/i.test(raw)) break;
    const m = /^[\s│|]*[●•]\s+(.+)$/.exec(raw);
    if (!m) continue;
    const name = m[1].trim().replace(/\s+(oauth|api|wellknown)$/i, '');
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}
