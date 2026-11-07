// Port lanes (#227): the live office's previews own 6300-6499 (floors at 6300 + floor, PR previews 100 above). Every
// other office (an agent's or the lab's demo office, a test office) runs its previews in a block of its own, and a demo
// office refuses the live lanes outright, so it can never take a port the live office's previews need.

/** The live office's preview lanes: its floor previews and PR previews (docs/how-it-works.md). */
const LIVE_LANES = { from: 6300, to: 6499 };

/** A demo office's preview base when nothing sets SWARM_PREVIEW_PORT: well clear of the live lanes. */
export const DEMO_PREVIEW_PORT = 16_300;

/** The lab's runs (lab_run: e2e suites booting a demo office) get this block. */
export const LAB_PREVIEW_PORT = 32_000;

/** A preview base's block: floors at base + floor, PR previews at base + 100 … base + 199. */
export const PREVIEW_BLOCK = 200;

/** Agents' reserved ports (Swarm's port(a)): 5200 + 0 … 699. */
const AGENT_PORTS = { from: 5200, count: 700 };
/** Agents' preview blocks: 10000 … 31999, below Linux's ephemeral ports (32768+). */
const AGENT_BLOCKS = { from: 10_000, count: 110 };

/** The preview base of the demo office an agent runs: a block of its own, from its reserved port. */
export function agentPreviewBase(port: number): number {
  const i = (((port - AGENT_PORTS.from) % AGENT_PORTS.count) + AGENT_PORTS.count) % AGENT_PORTS.count;
  return AGENT_BLOCKS.from + (i % AGENT_BLOCKS.count) * PREVIEW_BLOCK;
}

/** Every port an agent may listen on: its reserved port and its preview block. */
export function agentPorts(port: number): number[] {
  const base = agentPreviewBase(port);
  return [port, ...Array.from({ length: PREVIEW_BLOCK }, (_, i) => base + i)];
}

/**
 * What an agent's sessions run with so a demo office they start takes only their own ports: the office itself on their
 * reserved port, its previews (and so PR previews) in their block. The gateway and sync proxy derive from these.
 */
export function agentPortEnv(port: number): Record<string, string> {
  return { SWARM_PORT: String(port), SWARM_PREVIEW_PORT: String(agentPreviewBase(port)) };
}

/** Whether a port is one of the live office's preview lanes. */
export const inLiveLanes = (port: number) => port >= LIVE_LANES.from && port <= LIVE_LANES.to;

/** Why a demo office won't run a preview on this port, or null when it may. */
export function liveLaneRefusal(port: number, demo: boolean): string | null {
  if (!demo || !inLiveLanes(port)) return null;
  return `A demo office never uses the live office's preview ports (${LIVE_LANES.from}-${LIVE_LANES.to}), and port ${port} is one. Set SWARM_PREVIEW_PORT outside them (the demo's default is ${DEMO_PREVIEW_PORT}).`;
}
