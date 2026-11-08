// Settings → Cloud agents (docs/cloud.md): where new agents work, and the Upstash Box size and limit. Shared so the
// server checks what the client offers.

import type { AgentCli, BoxSize, CloudSettings, CloudView, HybridSettings, MachineHost, MachineKind } from './types.ts';

export const BOX_SIZES: BoxSize[] = ['small', 'medium', 'large'];

/** Upstash's pay-as-you-go price per active CPU hour, and what each size is (upstash.com/pricing/box). */
export const BOX_SIZE_INFO: Record<BoxSize, { usdPerCpuHour: number; spec: string }> = {
  small: { usdPerCpuHour: 0.1, spec: '2 vCPU · 4 GB' },
  medium: { usdPerCpuHour: 0.2, spec: '4 vCPU · 8 GB' },
  large: { usdPerCpuHour: 0.4, spec: '8 vCPU · 16 GB' },
};

/** The free plan's most Boxes, paused ones included. */
export const FREE_BOX_LIMIT = 10;
export const MAX_BOX_LIMIT = 1000;

/** Hybrid (#260): burst on, after 5 minutes of work waiting for memory, at most 2 at once, gone after 10 idle minutes. */
export const DEFAULT_HYBRID: HybridSettings = { localMax: 0, burst: true, burstAfterMin: 5, burstMax: 2, burstIdleMin: 10 };

export const DEFAULT_CLOUD: CloudSettings = { machineKind: 'local', boxSize: 'small', boxLimit: FREE_BOX_LIMIT, hybrid: DEFAULT_HYBRID };

const KINDS: MachineKind[] = ['local', 'box', 'hybrid'];

const whole = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Math.round(Number(v));
  return v !== null && v !== '' && Number.isFinite(n) && n >= lo ? Math.min(hi, n) : dflt;
};

/** Saved or patched Hybrid settings, with anything malformed replaced by `base`'s. */
function hybridSettings(base: HybridSettings, raw: unknown): HybridSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof HybridSettings, unknown>>;
  return {
    localMax: whole(r.localMax, 0, 64, base.localMax),
    burst: typeof r.burst === 'boolean' ? r.burst : base.burst,
    burstAfterMin: whole(r.burstAfterMin, 1, 240, base.burstAfterMin),
    burstMax: whole(r.burstMax, 1, 50, base.burstMax),
    burstIdleMin: whole(r.burstIdleMin, 1, 240, base.burstIdleMin),
  };
}

/** Before the server says otherwise: no account connected, nothing to sign in with. */
const NONE = { ready: false, source: null, hint: '' } as const;
export const EMPTY_CLOUD: CloudView = { keySet: false, keyHint: '', keyError: null, github: NONE, claude: NONE, codex: NONE, boxes: null };

/** Saved or patched cloud settings, with anything unknown replaced by `base`'s. */
export function cloudSettings(base: CloudSettings, raw: unknown): CloudSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof CloudSettings, unknown>>;
  const limit = Math.round(Number(r.boxLimit));
  return {
    machineKind: KINDS.includes(r.machineKind as MachineKind) ? (r.machineKind as MachineKind) : base.machineKind,
    boxSize: BOX_SIZES.includes(r.boxSize as BoxSize) ? (r.boxSize as BoxSize) : base.boxSize,
    boxLimit: Number.isFinite(limit) && limit >= 1 ? Math.min(MAX_BOX_LIMIT, limit) : base.boxLimit,
    hybrid: hybridSettings(base.hybrid ?? DEFAULT_HYBRID, r.hybrid),
  };
}

/** A CLI that can run in a Box (OpenCode can't yet). */
export const boxCli = (cli: AgentCli) => cli !== 'opencode';

/** Where an agent works, for their card: "☁ Cloud" or "This computer". */
export const hostLabel = (host: MachineHost | '' | undefined) => (host === 'box' ? '☁ Cloud (Upstash Box)' : 'This computer');
