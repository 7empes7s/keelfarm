// A PR's goal in plain words (#203): its body's first paragraph without markdown, for the app viewer's
// "What this PR changes" card. Computed when PRs sync, so the snapshot carries a short line, never the whole body.

const SUMMARY_MAX = 240;

/** Markdown to plain text, one line: links keep their words, code and emphasis lose their marks. */
function plain(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([^*_~]*?\S)\1/g, '$2')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The first paragraph of a PR body that says something: headings, "Closes #N" lines, code fences and tables are
 * skipped. Plain text, up to `max` characters ('' when there is none).
 */
export function prSummary(body: string | null | undefined, max = SUMMARY_MAX): string {
  if (!body) return '';
  const text = body.replace(/\r\n?/g, '\n').replace(/```[\s\S]*?(```|$)/g, '\n\n').replace(/<!--[\s\S]*?-->/g, '');
  for (const para of text.split(/\n\s*\n/)) {
    const lines = para.split('\n').filter((l) => !/^\s*(#{1,6}\s|\||[-=]{3,}\s*$)/.test(l) && !/^\s*(closes|fixes|resolves)\s+#\d+\.?\s*$/i.test(l));
    const out = plain(lines.join('\n'));
    if (out.length < 3) continue;
    return out.length > max ? `${out.slice(0, max - 1).trimEnd()}…` : out;
  }
  return '';
}
