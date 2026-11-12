// No AI attribution in anything the office lands (#599): the agents' CLIs are told not to add it (Claude Code's
// settings and Codex's config, in clis.ts), and this is the safety net at merge time, for the squash commit and the PR body.

const LINES = [
  /^[ \t]*Co-Authored-By:[^\n]*<noreply@(anthropic|openai)\.com>[ \t]*$/gim, // Claude's and Codex's trailers
  /^[ \t]*(🤖[ \t]*)?Generated with \[?(Claude Code|Codex)\]?(\([^)\n]*\))?\.?[ \t]*$/gim,
];

/** Whether a commit message or PR body carries an AI co-author trailer or a "Generated with" line. */
export function hasAttribution(text: string): boolean {
  return LINES.some((re) => new RegExp(re.source, re.flags.replace('g', '')).test(text));
}

/** The text without those lines, and without the blank lines they leave behind. */
export function stripAttribution(text: string): string {
  if (!hasAttribution(text)) return text;
  const out = LINES.reduce((t, re) => t.replace(re, ''), text);
  return out.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** A commit of a PR, as `gh pr view --json commits` lists it. */
export interface PrCommit {
  messageHeadline: string;
  messageBody: string;
  authors?: { name: string; email: string }[];
}

/**
 * The squash commit's body as GitHub would write it (one commit: its body; several: a bullet per commit; then a
 * Co-authored-by per author), without the attribution. Null when no commit has any, so GitHub's own stays.
 */
export function squashBody(commits: PrCommit[]): string | null {
  if (!commits.some((c) => hasAttribution(c.messageBody))) return null;
  const trailer = /^Co-authored-by:.*$/gim;
  const coAuthors = new Set<string>();
  const parts = commits.map((c) => {
    const body = stripAttribution(c.messageBody);
    for (const m of body.match(trailer) ?? []) coAuthors.add(m.trim());
    const text = body.replace(trailer, '').trim();
    return commits.length === 1 ? text : `* ${c.messageHeadline}${text ? `\n\n${text}` : ''}`;
  });
  for (const c of commits) for (const a of c.authors ?? []) coAuthors.add(`Co-authored-by: ${a.name} <${a.email}>`);
  const seen = new Set<string>();
  const trailers = [...coAuthors].filter((t) => !hasAttribution(t) && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
  return [parts.filter(Boolean).join('\n\n'), trailers.join('\n')].filter(Boolean).join('\n\n');
}
