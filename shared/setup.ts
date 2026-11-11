// The setup advisor's checks (#366), pure: a floor's setup against its use case's recommendation (shared/useCases.ts),
// each gap with its one-tap actions (the recommended one first), Not now, the one notification per gap, the agents a
// gap blocks, and the CEO's line. The server gathers the inputs (server/swarm/setup.ts); nothing here sees a secret.
import type { AgentCli, ProviderCategory, SetupAction, SetupGap, UseCase } from './types.ts';
import { missingChecks, caseDef } from './useCases.ts';

export interface SetupAgent {
  id: string;
  name: string;
  cli: AgentCli;
  model: string;
  /** Can't run: its login is signed out, or the provider key its model needs is missing or turned away. */
  signedOut: { why: string; fix: 'accounts' | 'providers' | 'terminal' } | null;
}

export interface SetupInput {
  useCase: UseCase;
  qaBrief: string;
  previewCommand: string | null;
  /** The preview runs without a command of its own (package.json has a dev, start or preview script). */
  previewAuto: boolean;
  browserTesting: boolean;
  testLab: boolean;
  agents: SetupAgent[];
  /** Categories with a working key (a connection whose last test didn't fail). */
  providers: ProviderCategory[];
  /** Installed Tools & skills items by name: their id and whether builders have them on. */
  tools: { id: string; name: string; on: boolean }[];
  /** The company's main use cases ([]: not set, so nothing to mismatch). */
  company: UseCase[];
}

/** A label inside a sentence: "web app", but "API" and "3D / browser game" keep their capitals. */
const lower = (label: string) => (label[1] === label[1].toLowerCase() ? label[0].toLowerCase() + label.slice(1) : label);

const CATEGORY: Record<ProviderCategory, string> = { coding: 'coding agent', text: 'text model', audio: 'voice', video: 'video', image: 'image', cloud: 'cloud', mcp: 'MCP server' };

/** Every gap between a floor's setup and its use case's recommendation, most blocking first. */
export function setupGaps(x: SetupInput): SetupGap[] {
  const def = caseDef(x.useCase);
  const gaps: SetupGap[] = [];
  for (const a of x.agents) {
    if (!a.signedOut) continue;
    const rec = def.jobs.build;
    const actions: SetupAction[] = [{ label: 'Sign in', open: a.signedOut.fix, agentId: a.id }];
    if (a.cli !== rec.cli) actions.push({ label: `Switch to ${rec.label}`, fix: { kind: 'cli', agentId: a.id, cli: rec.cli, model: rec.model } });
    gaps.push({ id: `signin:${a.id}`, title: `${a.name} isn't signed in`, why: `${a.signedOut.why} ${a.name} takes no work until then.`, blocks: [a.id], actions });
  }
  for (const c of def.providers) {
    if (x.providers.includes(c)) continue;
    gaps.push({ id: `provider:${c}`, title: `No ${CATEGORY[c]} provider`, why: `${def.label} floors need a ${CATEGORY[c]} key. ${def.why}`, actions: [{ label: 'Add provider', open: 'providers' }] });
  }
  if (def.needsPreview && !x.previewCommand && !x.previewAuto) {
    gaps.push({
      id: 'preview',
      title: 'No preview command',
      why: 'QA and you need the app running to look at it.',
      actions: def.preview ? [{ label: `Use ${def.preview.replace('{port}', 'its port')}`, fix: { kind: 'preview' } }, { label: 'Set it up', open: 'floor' }] : [{ label: 'Set it up', open: 'floor' }],
    });
  }
  const missing = missingChecks(def, x.qaBrief);
  if (missing.length) {
    gaps.push({
      id: 'qa-brief',
      title: x.qaBrief.trim() ? `The QA brief skips ${lower(def.label)} checks` : 'No QA brief',
      why: `QA should check: ${missing.map((c) => c.label.toLowerCase()).join('; ')}.`,
      actions: [{ label: 'Add the checks', fix: { kind: 'qaBrief' } }, { label: 'Edit the brief', open: 'floor' }],
    });
  }
  if (def.browserLab && !x.browserTesting) gaps.push({ id: 'browser', title: 'Browser testing is off', why: `${def.label} floors are tested in a real browser.`, actions: [{ label: 'Turn it on', fix: { kind: 'browserTesting' } }] });
  if (def.browserLab && !x.testLab) gaps.push({ id: 'test-lab', title: 'The Test lab is off', why: 'Its shared browser checks screens and frame rates without a browser per agent.', actions: [{ label: 'Turn it on', fix: { kind: 'testLab' } }] });
  for (const name of def.skills) {
    const t = x.tools.find((i) => i.name === name);
    if (t && !t.on) gaps.push({ id: `skill:${name}`, title: `${name} is switched off`, why: `Builders on ${lower(def.label)} floors use it.`, actions: [{ label: 'Turn it on', fix: { kind: 'skill', id: t.id } }, { label: 'Tools & skills', open: 'tools' }] });
  }
  if (x.company.length && !x.company.includes(x.useCase)) {
    gaps.push({ id: 'company', title: `The company isn't set up for ${lower(def.label)}s`, why: `Its main use cases are ${x.company.map((u) => lower(caseDef(u).label)).join(', ')}.`, actions: [{ label: `Add ${lower(def.label)}`, fix: { kind: 'companyUseCase' } }, { label: 'Read the guide', open: 'guide' }] });
  }
  return gaps;
}

// ---------- Not now, the notifications, blocking ----------

export const SNOOZE_MS = 7 * 24 * 3_600_000;

/** Gaps still shown: not snoozed (Not now lasts a week). */
export function openGaps(gaps: SetupGap[], snoozed: Record<string, number>, now: number): SetupGap[] {
  return gaps.filter((g) => !(snoozed[g.id] > now));
}

/** Not now: remembered for SNOOZE_MS; expired ones and those of gaps gone are dropped. */
export function snooze(snoozed: Record<string, number>, id: string, gaps: SetupGap[], now: number): Record<string, number> {
  const ids = new Set(gaps.map((g) => g.id));
  const kept = Object.fromEntries(Object.entries(snoozed).filter(([k, until]) => until > now && ids.has(k)));
  return { ...kept, [id]: now + SNOOZE_MS };
}

/**
 * The gaps to notify about now, once each: shown, and not told before. `told` comes back without the gaps that closed,
 * so a gap that comes back later is news again.
 */
export function toTell(shown: SetupGap[], all: SetupGap[], told: string[]): { tell: SetupGap[]; told: string[] } {
  const open = new Set(all.map((g) => g.id));
  const kept = told.filter((id) => open.has(id));
  const tell = shown.filter((g) => !kept.includes(g.id));
  return { tell, told: [...kept, ...tell.map((g) => g.id)] };
}

/** Agents a floor's gaps keep from work (snoozed or not: Not now doesn't sign anyone in). */
export function blockedAgents(gaps: SetupGap[]): Set<string> {
  return new Set(gaps.flatMap((g) => g.blocks ?? []));
}

/** company_status's line for a floor: "3D / browser game (guessed) · 2 gaps: No preview command; …". */
export function setupLine(useCase: UseCase | null, guessed: boolean, gaps: SetupGap[]): string {
  if (!useCase) return 'use case not known yet';
  const head = `${caseDef(useCase).label}${guessed ? ' (guessed)' : ''}`;
  return gaps.length ? `${head} · ${gaps.length} gap${gaps.length === 1 ? '' : 's'}: ${gaps.map((g) => `${g.id} (${g.title})`).join('; ')}` : `${head} · set up as recommended`;
}
