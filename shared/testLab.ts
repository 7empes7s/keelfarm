// The test lab (#56): one office-wide desk every agent asks for screenshots, browser checks and heavy test runs,
// instead of each starting their own browser or full suite. Its settings and the view the lab desk shows; the queue,
// the allowlist and the runner are server/testLab.ts.

/** Which queue a job waits in: browser jobs share the one browser, heavy ones are commands like a build. */
export type LabLane = 'browser' | 'heavy';
export type LabJobKind = 'screenshot' | 'check' | 'run';
/** Browser profiles: Chromium at a desktop size, a phone, or an iPhone's (touch, 3× pixels, its user agent). */
export type LabProfile = 'desktop' | 'phone' | 'iphone';

/**
 * How the lab's browser draws a 3D page (#301): 'lab', the default, is the office's light graphics profile (same UI and
 * layout, far less memory); 'full' is the real graphics, for one pass on its own with the browser restarted after.
 */
export type LabGraphics = 'lab' | 'full';

export const laneOf = (kind: LabJobKind): LabLane => (kind === 'run' ? 'heavy' : 'browser');

export interface TestLabSettings {
  enabled: boolean; // agents use the lab's tools instead of a browser of their own
  browserJobs: number; // browser jobs at a time
  heavyJobs: number; // heavy commands at a time
}

export const DEFAULT_TEST_LAB: TestLabSettings = { enabled: true, browserJobs: 1, heavyJobs: 1 };

const count = (raw: unknown, base: number) => (Number.isFinite(Number(raw)) ? Math.max(1, Math.min(4, Math.round(Number(raw)))) : base);

/** Test lab settings from a saved state or a PATCH /api/settings, field by field; anything invalid keeps `base`. */
export function testLabSettings(base: TestLabSettings, patch: unknown): TestLabSettings {
  const p = (patch && typeof patch === 'object' ? patch : {}) as Partial<Record<keyof TestLabSettings, unknown>>;
  return {
    enabled: typeof p.enabled === 'boolean' ? p.enabled : base.enabled,
    browserJobs: count(p.browserJobs, base.browserJobs),
    heavyJobs: count(p.heavyJobs, base.heavyJobs),
  };
}

/** A job in the lab's queue or running. */
export interface LabJobView {
  id: string;
  kind: LabJobKind;
  repoId: string;
  floor: number;
  agentId: string;
  agent: string; // the requester's name
  pr: number | null; // the pull request the requester works on, for the link
  title: string; // e.g. "screenshot localhost:6302 × 3" or "npm test"
  queuedAt: number;
  startedAt: number | null;
}

/** A finished job, for the lab desk's recent results. */
export interface LabResultView extends LabJobView {
  endedAt: number;
  ok: boolean;
  summary: string; // one line
  shot: boolean; // has a thumbnail (GET /api/testlab/shot/:id)
}

export interface TestLabView {
  enabled: boolean;
  browser: 'off' | 'up'; // the shared browser process
  running: LabJobView[];
  queue: LabJobView[];
  recent: LabResultView[]; // newest first
  usage: { repoId: string; floor: number; jobs: number; ms: number }[]; // per floor since the office started
  held: string | null; // why the next job waits (memory), if it does
}
