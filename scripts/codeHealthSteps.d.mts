// Types for codeHealthSteps.mjs (plain JavaScript, so the ratchet runs without a build or tsx).

/** { file: { rule: count } } */
export type LintCounts = Record<string, Record<string, number>>;
export interface Baseline {
  lint: LintCounts;
  knip: string[];
  /** Lines per file: every source file in a run, only the big ones in a baseline. */
  sizes: Record<string, number>;
}
export type Regression =
  | { kind: 'lint'; file: string; rule: string; was: number; now: number }
  | { kind: 'knip'; id: string }
  | { kind: 'size'; file: string; lines: number; limit: number; recorded: number | null };
export type Improvement =
  | { kind: 'lint'; file: string; rule: string; was: number; now: number }
  | { kind: 'knip'; id: string }
  | { kind: 'size'; file: string; was: number; now: number };

export const SOURCE_DIRS: string[];
export const SOURCE_EXTENSIONS: string[];
export const NEW_FILE_MAX_LINES: number;
export const GROWTH_ALLOWANCE: number;
export const FOLDER_MAX_LINES: Record<string, number>;
export function normalizePath(file: string): string;
export function lineCount(text: string): number;
export function isSourceFile(file: string): boolean;
export function sizeLimit(file: string, sizes: Record<string, number>): number;
export function lintCounts(report: { diagnostics?: { filename: string; code?: string }[] }): LintCounts;
export function knipFindings(report: { issues?: Record<string, unknown>[] }): string[];
export function bigFiles(sizes: Record<string, number>): Record<string, number>;
export function makeBaseline(run: Baseline): Baseline;
export function compare(baseline: Baseline, current: Baseline): { regressions: Regression[]; improvements: Improvement[] };
export function lowered(baseline: Baseline, current: Baseline): Baseline;
export function serializeBaseline(baseline: Baseline): string;
export function parseBaseline(text: string): Baseline;
export function describeRegression(r: Regression): string;
