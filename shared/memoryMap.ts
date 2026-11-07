// The memory map (#136): the company and its projects as a graph, built from what the office already knows (floors,
// charters, issues, PRs, QA, agents, the CEO's chat), no AI calls. Pure: the browser builds it from the snapshot and
// the events it already gets, so a merge or a new issue shows on the map without a reload. Also its filters, the
// local graph, search, the insight cards and what changed between two builds (for the live pulses).
import { objectiveTag } from './charter.ts';
import { blockers } from './issues.ts';
import type { LabView } from './experiments.ts';
import type { ActionRef } from './ceoActions.ts';
import type { AgentView, ChatRef, PhoneMessage, QaView, RepoView } from './types.ts';

export type MapNodeType = 'company' | 'floor' | 'objective' | 'standard' | 'issue' | 'pr' | 'qa' | 'agent' | 'ceo' | 'decision' | 'artifact' | 'file' | 'experiment';

export const NODE_TYPES: MapNodeType[] = ['company', 'floor', 'objective', 'standard', 'issue', 'pr', 'qa', 'agent', 'ceo', 'decision', 'artifact', 'file', 'experiment'];

/** The ring around a node: where its work stands. */
export type MapStatus = 'open' | 'building' | 'qa' | 'fixing' | 'ready' | 'merged' | 'failed' | 'closed' | 'working' | 'idle';

export type MapEdgeKind =
  | 'part-of' // a floor of the company, an objective or standard of a floor, a floor's agent
  | 'serves' // issue → the objective it names
  | 'closes' // PR → issue
  | 'depends' // issue → the issue it waits for
  | 'built' // agent → PR
  | 'tested' // agent → QA round
  | 'fixed' // agent → PR
  | 'round' // QA round → PR
  | 'merged' // PR → floor
  | 'filed' // the CEO → issue
  | 'decided' // the CEO → decision, decision → what it changed
  | 'mentions' // artifact → issue / PR / agent / floor
  | 'touches' // PR → file
  | 'overlap' // open PR ↔ open PR changing the same file (conflict risk)
  | 'trial'; // experiment → issue

/** What a node's card opens. */
export type MapTarget = { kind: 'issue'; repoId: string; number: number } | { kind: 'agent'; agentId: string } | { kind: 'floor'; repoId: string } | { kind: 'artifact'; messageId: number; artifactId: string };

export interface MapNode {
  id: string;
  type: MapNodeType;
  label: string; // short, for the canvas: "#12", "Ada", "O2"
  title: string; // the full name, for the card and search
  repoId: string | null;
  at: number; // when it appeared (epoch ms), for the time slider
  status: MapStatus | null;
  weight: number; // its size: activity and cost
  facts: [string, string][]; // the card's few facts
  objective: string | null; // the objective it serves (issues and their PRs)
  target?: MapTarget;
}

interface MapEdge {
  source: string;
  target: string;
  kind: MapEdgeKind;
}

export interface MemoryGraph {
  nodes: MapNode[];
  edges: MapEdge[];
  hidden: number; // nodes left out by the caps ("show older")
}

/** The parts of the office state the map is built from (the snapshot's shapes). */
export interface MapSource {
  now: number;
  company: string;
  repos: readonly Pick<RepoView, 'id' | 'fullName' | 'floor' | 'issues' | 'pulls' | 'charter' | 'summary'>[];
  agents: readonly Pick<AgentView, 'id' | 'name' | 'role' | 'repoId' | 'status' | 'task' | 'issueNumber' | 'prNumber' | 'costUsd' | 'startedAt'>[];
  qa: readonly Pick<QaView, 'repoId' | 'prNumber' | 'status' | 'round' | 'devAgentId' | 'qaAgentId' | 'updatedAt' | 'summary'>[];
  messages: readonly Pick<PhoneMessage, 'id' | 'from' | 'at' | 'text' | 'artifacts' | 'refs' | 'actions'>[];
  experiments?: LabView;
}

export interface MapCaps {
  sinceDays: number; // work older than this is left out (structure always stays)
  maxNodes: number; // then the heaviest are kept
}

export const DEFAULT_CAPS: MapCaps = { sinceDays: 90, maxNodes: 400 };
const DAY = 86_400_000;

/** Nodes that are the map's skeleton: never dropped by the caps or the time window. */
const STRUCTURE: ReadonlySet<MapNodeType> = new Set(['company', 'floor', 'objective', 'agent', 'ceo']);

const BASE: Record<MapNodeType, number> = { company: 8, floor: 6, objective: 3, standard: 1, issue: 1, pr: 1.5, qa: 0.8, agent: 2, ceo: 3, decision: 0.8, artifact: 1, file: 0.8, experiment: 1.5 };

export const nodeId = {
  floor: (repoId: string) => `floor:${repoId}`,
  issue: (repoId: string, n: number) => `issue:${repoId}#${n}`,
  pr: (repoId: string, n: number) => `pr:${repoId}#${n}`,
  qa: (repoId: string, n: number) => `qa:${repoId}#${n}`,
  agent: (id: string) => `agent:${id}`,
  objective: (repoId: string, id: string) => `obj:${repoId}:${id}`,
  file: (repoId: string, path: string) => `file:${repoId}:${path}`,
};

const time = (iso: string | null | undefined, fallback: number) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : fallback;
};
const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const usd = (n: number) => `$${n.toFixed(2)}`;
const day = (t: number) => new Date(t).toISOString().slice(0, 10);

function qaStatus(s: QaView['status']): MapStatus {
  if (s === 'queued' || s === 'testing') return 'qa';
  if (s === 'fixing') return 'fixing';
  if (s === 'passed') return 'ready';
  return 'failed';
}

/** The graph of the office (capped: see MapCaps). */
export function buildGraph(src: MapSource, caps: MapCaps = DEFAULT_CAPS): MemoryGraph {
  const nodes = new Map<string, MapNode>();
  const edges: MapEdge[] = [];
  const seen = new Set<string>();
  const extra = new Map<string, number>(); // weight beyond the base and the links: cost, size
  const add = (n: Omit<MapNode, 'weight' | 'objective'> & { objective?: string | null }) => {
    if (!nodes.has(n.id)) nodes.set(n.id, { objective: null, ...n, weight: 0 });
    return nodes.get(n.id)!;
  };
  const link = (source: string, target: string, kind: MapEdgeKind) => {
    if (source === target) return;
    const key = `${source}>${target}>${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ source, target, kind });
  };
  const bump = (id: string, w: number) => extra.set(id, (extra.get(id) ?? 0) + w);

  add({ id: 'company', type: 'company', label: src.company || 'Company', title: src.company || 'The company', repoId: null, at: 0, status: null, facts: [['Floors', String(src.repos.length)], ['Agents', String(src.agents.length)]] });
  const qaOf = new Map(src.qa.map((q) => [`${q.repoId}#${q.prNumber}`, q]));
  const byRepoNumber = new Map<string, string>(); // `${repoId}#${n}` → issue or PR node id (issues first)

  for (const repo of src.repos) {
    const f = nodeId.floor(repo.id);
    const name = repo.fullName.split('/')[1] ?? repo.fullName;
    add({ id: f, type: 'floor', label: `${repo.floor} · ${name}`, title: repo.fullName, repoId: repo.id, at: 0, status: null, facts: [['Floor', String(repo.floor)], ['Open issues', String(repo.issues.length)], ['Summary', repo.summary || '—']], target: { kind: 'floor', repoId: repo.id } });
    link(f, 'company', 'part-of');
    const objectives = new Set<string>();
    for (const o of repo.charter.objectives) {
      objectives.add(o.id);
      const id = nodeId.objective(repo.id, o.id);
      add({ id, type: 'objective', label: o.id, title: `${o.id}: ${o.outcome}`, repoId: repo.id, at: 0, status: null, facts: [['Outcome', o.outcome], ['Met when', o.measure || '—']], objective: o.id });
      link(id, f, 'part-of');
    }
    repo.charter.standards.forEach((s, i) => {
      const id = `std:${repo.id}:${i}`;
      add({ id, type: 'standard', label: `S${i + 1}`, title: s, repoId: repo.id, at: 0, status: null, facts: [['Standard', s]] });
      link(id, f, 'part-of');
    });
    const serve = (id: string, tag: string | null) => {
      if (!tag || !objectives.has(tag)) return;
      nodes.get(id)!.objective = tag;
      link(id, nodeId.objective(repo.id, tag), 'serves');
    };

    const open = new Set(repo.issues.map((i) => i.number));
    for (const issue of repo.issues) {
      const id = nodeId.issue(repo.id, issue.number);
      const at = time(issue.createdAt, src.now);
      add({ id, type: 'issue', label: `#${issue.number}`, title: `#${issue.number} ${issue.title}`, repoId: repo.id, at, status: 'open', facts: [['Filed', day(at)], ['Labels', issue.labels.join(', ') || '—']], target: { kind: 'issue', repoId: repo.id, number: issue.number } });
      byRepoNumber.set(`${repo.id}#${issue.number}`, id);
      serve(id, objectiveTag(issue.body));
    }
    for (const issue of repo.issues) for (const b of blockers(issue.body, open)) link(nodeId.issue(repo.id, issue.number), nodeId.issue(repo.id, b), 'depends');

    // merged PRs older than the open issues: the drift view knows their objective
    const driftObjective = new Map<number, string>();
    for (const g of repo.charter.drift) if (g.objective) for (const p of g.prs) driftObjective.set(p.number, g.objective);

    const touched = new Map<string, number[]>(); // file → PRs changing it
    for (const pr of repo.pulls) {
      const id = nodeId.pr(repo.id, pr.number);
      const at = time(pr.createdAt, src.now);
      const q = qaOf.get(`${repo.id}#${pr.number}`);
      const status: MapStatus =
        pr.state === 'MERGED' ? 'merged' : pr.state === 'CLOSED' ? 'closed' : q ? qaStatus(q.status) : pr.checks === 'failing' ? 'failed' : 'building';
      const facts: [string, string][] = [
        ['Opened', day(at)],
        ['Size', `+${pr.additions} −${pr.deletions}`],
      ];
      if (pr.mergedAt) facts.push(['Merged', day(time(pr.mergedAt, at))]);
      if (q) facts.push(['QA rounds', String(q.round)]);
      add({ id, type: 'pr', label: `PR ${pr.number}`, title: `PR #${pr.number} ${pr.title}`, repoId: repo.id, at, status, facts, target: { kind: 'issue', repoId: repo.id, number: pr.number } });
      if (!byRepoNumber.has(`${repo.id}#${pr.number}`)) byRepoNumber.set(`${repo.id}#${pr.number}`, id);
      bump(id, Math.min(3, (pr.additions + pr.deletions) / 300));
      if (pr.state === 'MERGED') link(id, f, 'merged');
      for (const n of pr.closesIssues) {
        const issue = nodeId.issue(repo.id, n);
        if (!nodes.has(issue)) {
          // a closed issue: the office only knows it through the PR
          add({ id: issue, type: 'issue', label: `#${n}`, title: `#${n} ${pr.title}`, repoId: repo.id, at: time(pr.issueCreatedAt, at), status: pr.state === 'MERGED' ? 'closed' : 'open', facts: [['Closed by', `PR #${pr.number}`]], target: { kind: 'issue', repoId: repo.id, number: n } });
          byRepoNumber.set(`${repo.id}#${n}`, issue);
          serve(issue, driftObjective.get(pr.number) ?? null);
        } else if (pr.state === 'OPEN' && nodes.get(issue)!.status === 'open') nodes.get(issue)!.status = status;
        link(id, issue, 'closes');
        const tag = nodes.get(issue)!.objective;
        if (tag) nodes.get(id)!.objective = tag;
      }
      for (const file of pr.files ?? []) touched.set(file, [...(touched.get(file) ?? []), pr.number]);
      if (q) {
        const qid = nodeId.qa(repo.id, pr.number);
        add({ id: qid, type: 'qa', label: `QA ${q.round}`, title: `QA of PR #${pr.number}, round ${q.round}`, repoId: repo.id, at: q.updatedAt, status: qaStatus(q.status), facts: [['Status', q.status], ['Round', String(q.round)], ['Summary', short(q.summary ?? '—', 120)]], target: { kind: 'issue', repoId: repo.id, number: pr.number } });
        link(qid, id, 'round');
        bump(id, q.round - 1);
        if (q.devAgentId) link(nodeId.agent(q.devAgentId), id, 'built');
        if (q.qaAgentId) link(nodeId.agent(q.qaAgentId), qid, 'tested');
      }
    }
    // files more than one PR changed: the hot spots, and the open PRs that may conflict
    for (const [file, prs] of touched) {
      if (prs.length < 2) continue;
      const fid = nodeId.file(repo.id, file);
      add({ id: fid, type: 'file', label: file.split('/').pop() ?? file, title: file, repoId: repo.id, at: Math.min(...prs.map((n) => nodes.get(nodeId.pr(repo.id, n))!.at)), status: null, facts: [['Path', file], ['PRs', prs.map((n) => `#${n}`).join(', ')]] });
      const openPrs = prs.filter((n) => repo.pulls.find((p) => p.number === n)?.state === 'OPEN');
      for (const n of prs) link(nodeId.pr(repo.id, n), fid, 'touches');
      for (let i = 0; i < openPrs.length; i++) for (let j = i + 1; j < openPrs.length; j++) link(nodeId.pr(repo.id, openPrs[i]), nodeId.pr(repo.id, openPrs[j]), 'overlap');
    }
  }

  const floorIds = new Set(src.repos.map((r) => r.id));
  for (const a of src.agents) {
    const id = nodeId.agent(a.id);
    const ceo = a.role === 'ceo';
    add({ id, type: ceo ? 'ceo' : 'agent', label: a.name, title: ceo ? `${a.name} (CEO)` : a.name, repoId: ceo ? null : a.repoId, at: 0, status: a.status === 'working' || a.status === 'preparing' ? 'working' : 'idle', facts: [['Status', a.status], ['Spent', usd(a.costUsd)], ...(a.issueNumber ? [['On', `#${a.issueNumber}`] as [string, string]] : [])], target: { kind: 'agent', agentId: a.id } });
    bump(id, Math.min(4, a.costUsd / 5));
    link(id, ceo ? 'company' : floorIds.has(a.repoId) ? nodeId.floor(a.repoId) : 'company', 'part-of');
    if (ceo || a.status === 'idle') continue;
    if (a.task === 'issue' && a.issueNumber) {
      const issue = nodeId.issue(a.repoId, a.issueNumber);
      if (nodes.has(issue)) {
        link(id, issue, 'built');
        if (nodes.get(issue)!.status === 'open') nodes.get(issue)!.status = 'building';
      }
    }
    if (a.prNumber && (a.task === 'qa' || a.task === 'fix')) {
      const target = a.task === 'qa' ? nodeId.qa(a.repoId, a.prNumber) : nodeId.pr(a.repoId, a.prNumber);
      if (nodes.has(target)) link(id, target, a.task === 'qa' ? 'tested' : 'fixed');
    }
  }

  // the CEO's chat: what its tools changed, and its artifacts with what they name
  const ceo = src.agents.find((a) => a.role === 'ceo');
  const ceoId = ceo ? nodeId.agent(ceo.id) : null;
  const refNode = (r: { kind: ChatRef['kind'] | ActionRef['kind']; repoId?: string; number?: number; agentId?: string }) => {
    if (r.kind === 'agent' && r.agentId) return nodeId.agent(r.agentId);
    if ((r.kind === 'floor' || r.kind === 'section') && r.repoId) return nodeId.floor(r.repoId); // a section of a floor (#215): the floor
    if ((r.kind === 'issue' || r.kind === 'qa') && r.repoId && r.number) return byRepoNumber.get(`${r.repoId}#${r.number}`) ?? null;
    return null;
  };
  for (const m of src.messages) {
    if (m.from !== 'ceo') continue;
    for (const [i, act] of (m.actions ?? []).entries()) {
      if (act.refused || !ceoId) continue;
      const to = act.ref ? refNode(act.ref) : null;
      if (act.tool === 'file_issue' && to) {
        link(ceoId, to, 'filed');
        continue;
      }
      const id = `decision:${m.id}-${i}`;
      add({ id, type: 'decision', label: act.icon, title: act.text, repoId: act.ref && 'repoId' in act.ref ? (act.ref.repoId ?? null) : null, at: m.at, status: null, facts: [['Decided', day(m.at)], ['Tool', act.tool]] });
      link(ceoId, id, 'decided');
      if (to) link(id, to, 'decided');
    }
    for (const art of m.artifacts ?? []) {
      const id = `art:${art.id}`;
      add({ id, type: 'artifact', label: '📄', title: art.title, repoId: null, at: m.at, status: null, facts: [['Written', day(m.at)], ['About', short(art.lead || '—', 100)]], target: { kind: 'artifact', messageId: m.id, artifactId: art.id } });
      if (ceoId) link(ceoId, id, 'part-of');
      const named = new Set<string>();
      for (const r of m.refs ?? []) {
        const to = refNode(r);
        if (to) named.add(to);
      }
      for (const to of textRefs(`${art.title}\n${art.lead}\n${art.markdown ?? ''}`, src)) named.add(to);
      for (const to of named) if (nodes.has(to)) link(id, to, 'mentions');
    }
  }

  for (const e of src.experiments?.experiments ?? []) {
    const id = `exp:${e.id}`;
    add({ id, type: 'experiment', label: '🧪', title: e.name, repoId: e.floors.length === 1 ? e.floors[0] : null, at: e.startedAt ?? e.createdAt, status: e.status === 'running' ? 'working' : 'idle', facts: [['Status', e.status], ['Hypothesis', short(e.hypothesis, 100)], ['Issues', String(e.assigned)]] });
    link(id, 'company', 'part-of');
  }
  for (const t of src.experiments?.tags ?? []) {
    const issue = byRepoNumber.get(`${t.repoId}#${t.issue}`);
    if (issue) link(`exp:${t.experimentId}`, issue, 'trial');
  }

  const valid = edges.filter((e) => nodes.has(e.source) && nodes.has(e.target));
  const degree = new Map<string, number>();
  for (const e of valid) for (const id of [e.source, e.target]) degree.set(id, (degree.get(id) ?? 0) + 1);
  for (const n of nodes.values()) n.weight = Math.round((BASE[n.type] + 0.5 * (degree.get(n.id) ?? 0) + (extra.get(n.id) ?? 0)) * 10) / 10;
  return capGraph({ nodes: [...nodes.values()], edges: valid, hidden: 0 }, caps, src.now);
}

/** "#12", "floor 2 #12", "@Ada" and agents' names in a text: the nodes they name (a bare #N only when one floor has it). */
export function textRefs(text: string, src: Pick<MapSource, 'repos' | 'agents'>): string[] {
  const out = new Set<string>();
  const has = (r: MapSource['repos'][number], n: number) => r.issues.some((i) => i.number === n) || r.pulls.some((p) => p.number === n || p.closesIssues.includes(n));
  const kind = (r: MapSource['repos'][number], n: number) => (r.issues.some((i) => i.number === n) || r.pulls.some((p) => p.closesIssues.includes(n)) ? nodeId.issue(r.id, n) : nodeId.pr(r.id, n));
  for (const m of text.matchAll(/(?:\bfloor\s+(\d+)\s+)?(?:PR\s*)?#(\d+)\b/gi)) {
    const n = Number(m[2]);
    const repos = m[1] ? src.repos.filter((r) => r.floor === Number(m[1])) : src.repos.filter((r) => has(r, n));
    if (repos.length === 1 && has(repos[0], n)) out.add(kind(repos[0], n));
  }
  for (const a of src.agents) if (a.name && new RegExp(`(^|[^\\p{L}])@?${a.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'u').test(text)) out.add(nodeId.agent(a.id));
  return [...out];
}

/** The time window (at 0: timeless, like a standard), then the heaviest nodes; the skeleton (STRUCTURE) always stays. */
export function capGraph(g: MemoryGraph, caps: MapCaps, now: number): MemoryGraph {
  const since = now - caps.sinceDays * DAY;
  const fixed = g.nodes.filter((n) => STRUCTURE.has(n.type));
  const rest = g.nodes.filter((n) => !STRUCTURE.has(n.type) && (n.at === 0 || n.at >= since || n.status === 'open' || n.status === 'building'));
  rest.sort((a, b) => b.weight - a.weight || b.at - a.at);
  const kept = [...fixed, ...rest.slice(0, Math.max(0, caps.maxNodes - fixed.length))];
  const ids = new Set(kept.map((n) => n.id));
  return { nodes: kept, edges: g.edges.filter((e) => ids.has(e.source) && ids.has(e.target)), hidden: g.hidden + g.nodes.length - kept.length };
}

// ---------- navigating it ----------

/** Each node's neighbours, both ways. */
export function neighbours(g: Pick<MemoryGraph, 'edges'>): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  const put = (a: string, b: string) => (m.get(a) ?? m.set(a, new Set()).get(a)!).add(b);
  for (const e of g.edges) {
    put(e.source, e.target);
    put(e.target, e.source);
  }
  return m;
}

/** Obsidian's local graph: the nodes within `depth` links of one (1-3), it included. */
export function localIds(g: Pick<MemoryGraph, 'edges'>, id: string, depth: number): Set<string> {
  const near = neighbours(g);
  const out = new Set([id]);
  let ring = [id];
  for (let d = 0; d < Math.max(1, Math.min(3, depth)); d++) {
    const next: string[] = [];
    for (const n of ring)
      for (const m of near.get(n) ?? []) {
        if (out.has(m)) continue;
        out.add(m);
        next.push(m);
      }
    ring = next;
  }
  return out;
}

export interface MapFilter {
  hiddenTypes?: readonly MapNodeType[];
  repoId?: string | null;
  objective?: string | null; // an objective node's id: it and the work within 2 links
  agentId?: string | null; // an agent node's id: the same
  status?: MapStatus | null;
  until?: number | null; // the time slider: only what existed then
  local?: { id: string; depth: number } | null;
}

/** The part of the map a filter keeps. */
export function filterGraph(g: MemoryGraph, f: MapFilter): MemoryGraph {
  const hidden = new Set(f.hiddenTypes ?? []);
  let keep = g.nodes.filter((n) => !hidden.has(n.type) && (f.until == null || n.at <= f.until));
  if (f.repoId) keep = keep.filter((n) => n.repoId === f.repoId || n.id === nodeId.floor(f.repoId!));
  if (f.status) keep = keep.filter((n) => n.status === f.status || n.type === 'floor' || n.type === 'company');
  for (const around of [f.objective, f.agentId, f.local?.id]) {
    if (!around) continue;
    const near = localIds(g, around, around === f.local?.id ? f.local.depth : 2);
    keep = keep.filter((n) => near.has(n.id));
  }
  const ids = new Set(keep.map((n) => n.id));
  return { nodes: keep, edges: g.edges.filter((e) => ids.has(e.source) && ids.has(e.target)), hidden: g.hidden };
}

/** Type-ahead: "12" or "#12" finds by number, else every word in the title; best first. */
export function searchNodes(g: Pick<MemoryGraph, 'nodes'>, query: string, limit = 8): MapNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const num = q.match(/^(?:pr\s*)?#?(\d+)$/)?.[1];
  const words = q.split(/\s+/);
  const scored: [MapNode, number][] = [];
  for (const n of g.nodes) {
    const title = n.title.toLowerCase();
    let score = 0;
    if (num && new RegExp(`(^|\\D)${num}(\\D|$)`).test(n.label)) score = 3;
    else if (n.label.toLowerCase() === q) score = 3;
    else if (title.startsWith(q) || n.label.toLowerCase().startsWith(q)) score = 2;
    else if (words.every((w) => title.includes(w))) score = 1;
    if (score) scored.push([n, score + n.weight / 100]);
  }
  return scored
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([n]) => n);
}

// ---------- insights ----------

export interface MapInsight {
  id: 'objective' | 'files' | 'stalled' | 'agents' | 'untagged';
  icon: string;
  label: string;
  value: string;
  ids: string[]; // what a tap highlights
}

const STALLED_DAYS = 3;

/** The stat cards over the map. */
export function mapInsights(g: MemoryGraph, now: number): MapInsight[] {
  const near = neighbours(g);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const deg = (n: MapNode) => near.get(n.id)?.size ?? 0;
  const of = (t: MapNodeType) => g.nodes.filter((n) => n.type === t);
  const out: MapInsight[] = [];
  const objectives = of('objective')
    .map((o) => ({ o, work: [...(near.get(o.id) ?? [])].filter((id) => byId.get(id)?.type === 'issue') }))
    .sort((a, b) => b.work.length - a.work.length);
  if (objectives[0]?.work.length) out.push({ id: 'objective', icon: '🎯', label: 'Busiest objective', value: `${objectives[0].o.label} · ${objectives[0].work.length} issues`, ids: [objectives[0].o.id, ...objectives[0].work] });
  const files = of('file').sort((a, b) => deg(b) - deg(a)).slice(0, 5);
  if (files.length) out.push({ id: 'files', icon: '🔥', label: 'Hottest files', value: `${files[0].label} · ${deg(files[0])} PRs`, ids: files.map((f) => f.id) });
  const stalled = of('issue').filter((n) => n.status === 'open' && n.at < now - STALLED_DAYS * DAY && ![...(near.get(n.id) ?? [])].some((id) => ['pr', 'agent'].includes(byId.get(id)?.type ?? '')));
  out.push({ id: 'stalled', icon: '🐌', label: `Waiting > ${STALLED_DAYS} days`, value: `${stalled.length} issue${stalled.length === 1 ? '' : 's'}`, ids: stalled.map((n) => n.id) });
  const agents = of('agent').sort((a, b) => deg(b) - deg(a)).slice(0, 3);
  if (agents.length) out.push({ id: 'agents', icon: '🤝', label: 'Most connected', value: agents.map((a) => a.label).join(', '), ids: agents.map((a) => a.id) });
  const charted = new Set(of('objective').map((o) => o.repoId));
  const untagged = g.nodes.filter((n) => n.type === 'issue' && n.status !== 'closed' && !n.objective && charted.has(n.repoId));
  out.push({ id: 'untagged', icon: '🏷️', label: 'No objective', value: `${untagged.length} issue${untagged.length === 1 ? '' : 's'}`, ids: untagged.map((n) => n.id) });
  return out;
}

// ---------- live changes ----------

export interface MapChange {
  id: string;
  kind: 'new' | 'changed' | 'merged';
}

/** What a new build of the map has that the last one didn't: the nodes to pulse (a merge bursts). */
export function mapChanges(prev: Pick<MemoryGraph, 'nodes'> | null, next: Pick<MemoryGraph, 'nodes'>): MapChange[] {
  if (!prev) return [];
  const before = new Map(prev.nodes.map((n) => [n.id, n.status]));
  const out: MapChange[] = [];
  for (const n of next.nodes) {
    if (!before.has(n.id)) out.push({ id: n.id, kind: 'new' });
    else if (before.get(n.id) !== n.status) out.push({ id: n.id, kind: n.status === 'merged' ? 'merged' : 'changed' });
  }
  return out;
}
