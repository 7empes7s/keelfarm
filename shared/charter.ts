// Project charters (#48): a floor's mission, objectives, standards, non-goals and current focus, after Spec Kit's
// constitution and Kiro's always-loaded steering files. Pure rules for both sides: cleaning what the manager or the
// CEO wrote, the compact rendering every build, fix and QA prompt starts with (capped, and byte-identical between
// calls so prompt caching keeps it cheap), the Markdown export, objective tags on issues and the drift view.

import type { Charter, CharterChange, CharterObjective, CharterParts, CharterProposal, CharterView, DriftGroup, IssueInfo, PullInfo } from './types.ts';

/** The most characters of charter in a prompt: the rendering is cut there, and the editor warns above it. */
export const CHARTER_PROMPT_MAX = 1500;
/** How long the mission may be stored (the old free-text brief's limit): the prompt shows its first MISSION_SHOWN. */
export const MISSION_MAX = 4000;
const MISSION_SHOWN = 400;
export const OBJECTIVES_MAX = 8;
export const STANDARDS_MAX = 12;
export const NON_GOALS_MAX = 8;
export const OUTCOME_MAX = 160;
export const STANDARD_MAX = 200;
export const NON_GOAL_MAX = 120;
export const FOCUS_MAX = 200;
/** History entries kept per floor (newest first). */
const HISTORY_MAX = 20;
/** The drift view's window. */
export const DRIFT_MS = 7 * 24 * 3600_000;

export const emptyCharter = (): CharterParts => ({ objectives: [], standards: [], nonGoals: [], focus: '' });
export const emptyCharterView = (): CharterView => ({ ...emptyCharter(), proposal: null, history: [], drift: [] });

const line = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const lines = (v: unknown, each: number, most: number) =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n') : [])
    .map((s) => line(s, each).replace(/^[-*•]\s*/, ''))
    .filter(Boolean)
    .slice(0, most);

/** What the manager or the CEO wrote, checked and capped; objectives without a valid, unused id get the next free one. */
export function cleanCharter(raw: unknown): Charter {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const objectives: CharterObjective[] = [];
  const used = new Set<string>();
  const given = (Array.isArray(r.objectives) ? r.objectives : []).filter((o): o is Record<string, unknown> => !!o && typeof o === 'object');
  for (const o of given) {
    const outcome = line(o.outcome, OUTCOME_MAX);
    if (!outcome || objectives.length >= OBJECTIVES_MAX) continue;
    const id = typeof o.id === 'string' ? o.id.trim().toUpperCase() : '';
    objectives.push({ id: /^O\d{1,2}$/.test(id) && !used.has(id) ? id : '', outcome, measure: line(o.measure, OUTCOME_MAX) });
    if (objectives.at(-1)!.id) used.add(id);
  }
  let next = 1;
  for (const o of objectives) {
    if (o.id) continue;
    while (used.has(`O${next}`)) next++;
    o.id = `O${next}`;
    used.add(o.id);
  }
  return {
    mission: typeof r.mission === 'string' ? r.mission.trim().slice(0, MISSION_MAX) : '',
    objectives,
    standards: lines(r.standards, STANDARD_MAX, STANDARDS_MAX),
    nonGoals: lines(r.nonGoals, NON_GOAL_MAX, NON_GOALS_MAX),
    focus: line(r.focus, FOCUS_MAX),
  };
}

export const isEmptyCharter = (c: Charter) => !c.mission.trim() && !c.objectives.length && !c.standards.length && !c.nonGoals.length && !c.focus;

/** The charter as prompt text, uncut: '' for an empty charter. Its length is what the editor's meter shows. */
export function charterText(c: Charter): string {
  if (isEmptyCharter(c)) return '';
  const mission = c.mission.replace(/\s+/g, ' ').trim();
  return [
    'Project charter (keep every change inside it):',
    mission && `Mission: ${mission.length > MISSION_SHOWN ? `${mission.slice(0, MISSION_SHOWN - 1)}…` : mission}`,
    c.focus && `Current focus: ${c.focus}`,
    ...(c.standards.length ? ['Standards (must always hold; breaking one fails QA):', ...c.standards.map((s) => `- ${s}`)] : []),
    ...(c.objectives.length ? ['Objectives:', ...c.objectives.map((o) => `- ${o.id}: ${o.outcome}${o.measure ? ` (met when: ${o.measure})` : ''}`)] : []),
    c.nonGoals.length ? `Non-goals (out of scope): ${c.nonGoals.join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const CUT = '… (cut: the full charter is in the office)';

/**
 * The compact rendering in every build, fix and QA prompt: at most CHARTER_PROMPT_MAX characters, cut at a line
 * (the later sections go first), and the same bytes for the same charter so the prompt prefix stays cacheable.
 */
export function renderCharter(c: Charter): string {
  const full = charterText(c);
  if (full.length <= CHARTER_PROMPT_MAX) return full;
  const kept: string[] = [];
  let size = CUT.length;
  for (const l of full.split('\n')) {
    if (size + l.length + 1 > CHARTER_PROMPT_MAX) break;
    kept.push(l);
    size += l.length + 1;
  }
  return [...kept, CUT].join('\n');
}

/** The full charter as docs/CHARTER.md, for Export. */
export function charterMarkdown(c: Charter, fullName: string): string {
  const list = (items: string[]) => (items.length ? items.map((s) => `- ${s}`).join('\n') : '_None yet._');
  return [
    `# ${fullName} charter`,
    '',
    '_Kept in the cubefarm office; every agent and QA pass on this project works by it._',
    '',
    '## Mission',
    '',
    c.mission.trim() || '_None yet._',
    '',
    '## Current focus',
    '',
    c.focus || '_None yet._',
    '',
    '## Objectives',
    '',
    c.objectives.length ? c.objectives.map((o) => `- **${o.id}**: ${o.outcome}${o.measure ? `  \n  Met when: ${o.measure}` : ''}`).join('\n') : '_None yet._',
    '',
    '## Standards',
    '',
    list(c.standards),
    '',
    '## Non-goals',
    '',
    list(c.nonGoals),
    '',
  ].join('\n');
}

const PARTS: [keyof Charter, string][] = [
  ['mission', 'mission'],
  ['focus', 'focus'],
  ['objectives', 'objectives'],
  ['standards', 'standards'],
  ['nonGoals', 'non-goals'],
];

/** Which parts differ between two charters, by name, in the editor's order. */
export const changedParts = (a: Charter, b: Charter) => PARTS.filter(([k]) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map(([, name]) => name);

/** History with a change on top (nothing when no part changed), at most HISTORY_MAX entries. */
export function withChange(history: CharterChange[], before: Charter, after: Charter, by: string, note: string, at: number): CharterChange[] {
  const parts = changedParts(before, after);
  return parts.length ? [{ at, by, parts, note }, ...history].slice(0, HISTORY_MAX) : history;
}

// ---------- objectives on issues ----------

/** The objective an issue body names on a line of its own ("Objective: O2"), or null. */
export function objectiveTag(body: string): string | null {
  return body.match(/^\s*\**Objective\**:\**\s*(O\d{1,2})\b/im)?.[1].toUpperCase() ?? null;
}

/** Why the CEO may not file this issue body on a floor with this charter, or null: it must name one of its objectives. */
export function objectiveRefusal(body: string, c: Pick<Charter, 'objectives'>): string | null {
  if (!c.objectives.length) return null;
  const ids = c.objectives.map((o) => o.id).join(', ');
  const tag = objectiveTag(body);
  if (!tag) return `Every issue on this floor names the charter objective it serves: add a line "Objective: <id>" (one of ${ids}). If it serves none, it is outside the charter: ask the manager before filing it.`;
  if (!c.objectives.some((o) => o.id === tag)) return `The charter has no objective ${tag}; its objectives are ${ids}.`;
  return null;
}

/** What the office remembers for the drift view: each issue's objective, and the PRs merged in the last 7 days. */
export interface ObjectiveLog {
  tags: Record<string, string>; // issue number → objective id
  merged: { pr: number; title: string; at: number; objective: string | null }[];
}

export const emptyLog = (): ObjectiveLog => ({ tags: {}, merged: [] });

const TAGS_MAX = 500;

/** A sync's issues and PRs into the log: the open issues' tags, new merges under their issue's objective. True if it changed. */
export function noteObjectives(log: ObjectiveLog, issues: Pick<IssueInfo, 'number' | 'body'>[], pulls: Pick<PullInfo, 'number' | 'title' | 'state' | 'mergedAt' | 'closesIssues'>[], now: number): boolean {
  const before = JSON.stringify(log);
  for (const i of issues) {
    const tag = objectiveTag(i.body);
    if (tag) log.tags[String(i.number)] = tag;
    else delete log.tags[String(i.number)];
  }
  const keys = Object.keys(log.tags);
  for (const k of keys.slice(0, Math.max(0, keys.length - TAGS_MAX))) delete log.tags[k];
  for (const p of pulls) {
    const at = p.mergedAt ? Date.parse(p.mergedAt) : NaN;
    if (p.state !== 'MERGED' || !Number.isFinite(at) || log.merged.some((m) => m.pr === p.number)) continue;
    const objective = p.closesIssues.map((n) => log.tags[String(n)]).find(Boolean) ?? null;
    log.merged.push({ pr: p.number, title: p.title.slice(0, 120), at, objective });
  }
  log.merged = log.merged.filter((m) => now - m.at <= DRIFT_MS).sort((a, b) => b.at - a.at);
  return JSON.stringify(log) !== before;
}

/** The drift view: the last 7 days' merges by objective, in the charter's order, then any it no longer has, then none. */
export function driftView(log: ObjectiveLog, c: Pick<Charter, 'objectives'>, now: number): DriftGroup[] {
  const recent = log.merged.filter((m) => now - m.at <= DRIFT_MS);
  const known = new Map(c.objectives.map((o) => [o.id, o.outcome]));
  const ids = [...c.objectives.map((o) => o.id), ...new Set(recent.map((m) => m.objective).filter((o): o is string => !!o && !known.has(o)))];
  const groups: DriftGroup[] = ids.map((id) => ({ objective: id, outcome: known.get(id) ?? 'no longer in the charter', prs: [] }));
  const none: DriftGroup = { objective: null, outcome: 'No objective', prs: [] };
  for (const m of recent) (groups.find((g) => g.objective === m.objective) ?? none).prs.push({ number: m.pr, title: m.title });
  return [...groups, ...(none.prs.length ? [none] : [])];
}

// ---------- the persisted record ----------

/** A floor's charter as the state file keeps it, besides the mission (the floor's `mission`, the old brief). */
export type CharterRecord = CharterParts & { proposal: CharterProposal | null; history: CharterChange[]; log: ObjectiveLog };

export const newRecord = (): CharterRecord => ({ ...emptyCharter(), proposal: null, history: [], log: emptyLog() });

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** A floor's record from the state file, checked. Floors from before charters have none: theirs starts empty. */
export function loadRecord(raw: unknown): CharterRecord {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const { mission: _, ...parts } = cleanCharter(r);
  const p = r.proposal as Partial<CharterProposal> | null | undefined;
  const log = (r.log && typeof r.log === 'object' ? r.log : {}) as Partial<ObjectiveLog>;
  return {
    ...parts,
    proposal: p && typeof p === 'object' && p.charter ? { at: num(p.at), by: str(p.by, 80), reason: str(p.reason, 600), charter: cleanCharter(p.charter) } : null,
    history: (Array.isArray(r.history) ? r.history : [])
      .filter((h): h is CharterChange => !!h && typeof h === 'object')
      .slice(0, HISTORY_MAX)
      .map((h) => ({ at: num(h.at), by: str(h.by, 120), parts: Array.isArray(h.parts) ? h.parts.map((x) => str(x, 20)) : [], note: str(h.note, 240) })),
    log: {
      tags: Object.fromEntries(Object.entries(log.tags && typeof log.tags === 'object' ? log.tags : {}).filter(([, v]) => typeof v === 'string')),
      merged: (Array.isArray(log.merged) ? log.merged : []).filter((m) => m && typeof m.pr === 'number' && typeof m.at === 'number'),
    },
  };
}

/** The whole charter: the floor's mission and its record's parts. */
export const charterOf = (mission: string, r: CharterParts): Charter => ({ mission, objectives: r.objectives, standards: r.standards, nonGoals: r.nonGoals, focus: r.focus });

/** What the tabs get: the parts, the proposal, the latest changes and the drift view. */
export const charterView = (r: CharterRecord, now: number): CharterView => ({
  objectives: r.objectives,
  standards: r.standards,
  nonGoals: r.nonGoals,
  focus: r.focus,
  proposal: r.proposal,
  history: r.history.slice(0, 10),
  drift: driftView(r.log, r, now),
});
