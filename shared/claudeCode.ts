// The Claude Code the office bundles (#546): agents run the binary that ships with the Agent SDK, so a model newer
// than it fails at once ("does not support this model"). Pure: the version from `claude --version`, which models
// need a newer one (the picker greys them out), and that API error in plain words.

/** Models that need at least this Claude Code, as Anthropic's error names them. */
const MODEL_MIN_CLAUDE_CODE: [RegExp, string][] = [[/^claude-fable-5-2\b/i, '2.1.290']];

/** "2.1.322 (Claude Code)" → "2.1.322"; null when there's no x.y.z in it. */
export function claudeCodeVersion(text: string | null | undefined): string | null {
  return text?.match(/\b(\d+\.\d+\.\d+)\b/)?.[1] ?? null;
}

/** Is version `a` at least `b` (x.y.z, numerically)? */
export function versionAtLeast(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return true;
}

/** The Claude Code version a model needs, or null when any will do. */
export const minClaudeCodeFor = (model: string): string | null => MODEL_MIN_CLAUDE_CODE.find(([re]) => re.test(model.trim()))?.[1] ?? null;

/** Why the bundled Claude Code (`version`, as --version prints it) can't run this model, or null when it can or we don't know. */
export function modelNeedsNewerClaude(model: string, version: string | null | undefined): string | null {
  const have = claudeCodeVersion(version);
  const need = minClaudeCodeFor(model);
  return have && need && !versionAtLeast(have, need) ? `Needs Claude Code ${need}+: update the office` : null;
}

/** "Claude Code 2.1.322, bundled with the office" for Settings; null without a version. */
export const bundledLabel = (version: string | null | undefined): string | null => {
  const v = claudeCodeVersion(version);
  return v ? `Claude Code ${v}, bundled with the office` : null;
};

/** Anthropic's "Claude Code X does not support this model; version Y or newer is required." in plain words, or null for any other text. */
export function modelSupportMessage(text: string): string | null {
  if (!/does\s+not\s+support\s+this\s+model/i.test(text)) return null;
  const have = text.match(/Claude\s+Code\s+(\d+\.\d+\.\d+)/i)?.[1];
  const need = text.match(/version\s+(\d+\.\d+\.\d+)\s+or\s+newer/i)?.[1];
  return `${have ? `Claude Code ${have}` : 'This Claude Code'} can't run this model${need ? `: it needs ${need} or newer` : ''}. Update the office, or pick another model`;
}
