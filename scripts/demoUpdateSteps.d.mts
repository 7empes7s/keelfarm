// Types for demoUpdateSteps.mjs (plain JavaScript, so the host runs it with Node alone).

export const MIN_MEM_KB: number;
export interface CiRun {
  id: number;
  status: string;
  conclusion: string | null;
}
export interface Decision {
  action: 'idle' | 'wait' | 'skip' | 'update';
  key: string;
  message: string;
}
export function memAvailableKb(meminfo: string): number;
export function ciRun(runsJson: unknown, sha: string): CiRun | null;
export function pickTarget(input: { current: string; newer: string[]; runsJson: unknown; failed: string[] }): string;
export function decide(input: { target: string; current: string; failed: boolean; ci: CiRun | null; memKb: number; minMemKb?: number }): Decision;
export function healthProblem(input: { rootStatus: number; rootBody: string; stateStatus: number; stateBody: string }): string | null;
export function prunable(releases: { name: string; mtimeMs: number }[], opts: { keep: number; protect: string[] }): string[];
