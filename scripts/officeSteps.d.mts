// Types for officeSteps.mjs (plain JavaScript, so the launcher runs without a build or tsx).

export interface OfficeArgs {
  dev: boolean;
  demo: boolean;
  open: boolean;
  help: boolean;
}
export function parseOfficeArgs(argv: string[]): OfficeArgs;
export function swarmHome(env?: Record<string, string | undefined>, home?: string): string;
export function clientPort(env?: Record<string, string | undefined>): number;
export function parseSymref(output: string): string | null;
export function refusal(state: { branch: string; defaultBranch: string; dirty: boolean; ahead: number }): string | null;
export function stepsFor(changedFiles: string[], opts: { startMode: boolean }): { install: boolean; build: boolean };
export function rollbackPlan(progress: { moved: boolean; installed: boolean; built: boolean }): { reset: boolean; install: boolean; build: boolean };
export function isUpdateCommand(line: string): boolean;

export const BOOT_TIMEOUT_MS: number;
export const PROBATION_MS: number;
export type PreflightStep = 'install' | 'test' | 'build' | 'boot';
export interface StepResult {
  step: string;
  ok: boolean;
  error?: string | null;
}
export function preflightSteps(opts: { startMode: boolean }): PreflightStep[];
export function preflightOutcome(steps: string[], results: StepResult[]): { go: boolean; error: string | null };
export const PREFLIGHT_TEST: string[];
export const TEST_RETRY_WAIT_MS: number;
export interface FailedTest {
  file: string;
  name: string;
}
export function failedTests(output: string): FailedTest[];
export function testRetryArgs(failed: FailedTest[]): string[];
export function testsFailedError(failed: FailedTest[], fallback: string): string;
export function isOfficeState(json: unknown): boolean;
export interface Verdict {
  done: boolean;
  ok: boolean;
  error: string | null;
}
export function probationVerdict(watch: {
  exited: number | string | null | undefined;
  elapsedMs: number;
  lastProbe: { ok: boolean; error: string | null } | null;
  everAnswered: boolean;
  windowMs?: number;
}): Verdict;
export interface PendingMarker {
  from: string;
  to: string;
  startedAt: number;
  rollingBack: boolean;
}
export function parseMarker(raw: string): PendingMarker | null;
export function pendingAction(marker: PendingMarker | null, head: string): 'rollback' | 'clear' | 'none';
export function officeUrl(env?: Record<string, string | undefined>): string;
