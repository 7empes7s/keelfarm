// "Try this" (#381): 2-5 plain steps telling the manager how to see a PR's change in its preview. From the PR body's
// "## Try it" section, QA's corrected steps (they win), else the issue's acceptance criteria. Pure, for both sides.
import type { TryStep } from './types.ts';
import { plain } from './prSummary.ts';

const TRY_MAX = 5;
const TEXT_MAX = 200;

/** One step from its markdown: plain words, and the first `/path` in backticks as its deep link. */
function tryStep(md: string): TryStep | null {
  const path = md.match(/`(\/[^`\s]*)`/)?.[1];
  const words = plain(md.replace(/^\s*\[[ xX]\]\s*/, ''));
  if (words.length < 2) return null;
  const text = words.length > TEXT_MAX ? `${words.slice(0, TEXT_MAX - 1).trimEnd()}…` : words;
  return path ? { text, path } : { text };
}

/** The lines under the first heading matching `heading`, up to the next heading of any level. */
function section(body: string | null | undefined, heading: RegExp): string | null {
  if (!body) return null;
  const lines = body.replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const start = lines.findIndex((l) => /^\s*#{1,6}\s/.test(l) && heading.test(l.replace(/^\s*#+\s*/, '')));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^\s*#{1,6}\s/.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

/** A section's steps: its list items, else a paragraph's inline "1. … 2. …" numbering, at most TRY_MAX. */
function stepsOf(text: string | null): TryStep[] {
  if (!text) return [];
  const items: string[] = [];
  for (const line of text.split('\n')) {
    const item = line.match(/^\s*(?:\d+[.)]|[-*+])\s+(.*)$/);
    if (item) items.push(item[1]);
    else if (line.trim() && items.length && /^\s{2,}/.test(line)) items[items.length - 1] += ` ${line.trim()}`; // a wrapped item
  }
  if (!items.length) items.push(text);
  return items
    .flatMap((i) => i.split(/(?:^|\s)\d+[.)]\s+/))
    .map(tryStep).filter((s): s is TryStep => !!s).slice(0, TRY_MAX);
}

/** A PR body's "## Try it" (or "Try this") steps; [] when it has none. */
export function tryItSteps(body: string | null | undefined): TryStep[] {
  return stepsOf(section(body, /^try (it|this)\b/i));
}

/** A PullInfo's `tryIt` field: set only when the body has steps, so the snapshot stays small. */
export function tryItField(body: string | null | undefined): { tryIt?: TryStep[] } {
  const steps = tryItSteps(body);
  return steps.length ? { tryIt: steps } : {};
}

/**
 * Takes a sync's steps off its PRs, by PR number: the snapshot carries every open PR, and their steps would outgrow
 * its budget (scale.test.ts), so they are read on demand. In place: the PRs keep their identity.
 */
export function takeSteps(pulls: { number: number; tryIt?: TryStep[] }[]): Map<number, TryStep[]> {
  const steps = new Map<number, TryStep[]>();
  for (const p of pulls) {
    if (!p.tryIt) continue;
    steps.set(p.number, p.tryIt);
    delete p.tryIt;
  }
  return steps;
}

/** The fallback: an issue's acceptance criteria ("## Acceptance", "Acceptance criteria") as steps. */
export function criteriaSteps(issueBody: string | null | undefined): TryStep[] {
  return stepsOf(section(issueBody, /^acceptance\b/i));
}

export interface TryThis {
  steps: TryStep[];
  /** Where they come from: QA's report, the PR body, or the issue's acceptance criteria. */
  from: 'qa' | 'pr' | 'issue';
}

/** The steps to show: QA's version wins, then the developer's, then the issue's criteria; null when there are none. */
export function tryThis(pr: readonly TryStep[] | undefined, qa: readonly TryStep[] | undefined, issueBody?: string | null): TryThis | null {
  if (qa?.length) return { steps: [...qa], from: 'qa' };
  if (pr?.length) return { steps: [...pr], from: 'pr' };
  const issue = criteriaSteps(issueBody);
  return issue.length ? { steps: issue, from: 'issue' } : null;
}

/** QA's report's steps (`{ step, result, note }`), checked: plain text, a known result, a short note. */
export function qaTrySteps(raw: unknown): TryStep[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const steps: TryStep[] = [];
  for (const r of raw.slice(0, TRY_MAX)) {
    const s = r && typeof r === 'object' ? tryStep(String((r as { step?: unknown }).step ?? '')) : null;
    if (!s) continue;
    const { result, note } = r as { result?: unknown; note?: unknown };
    if (result === 'pass' || result === 'fail' || result === 'skip') s.result = result;
    if (typeof note === 'string' && note.trim()) s.note = note.trim().slice(0, TEXT_MAX);
    steps.push(s);
  }
  return steps.length ? steps : undefined;
}
