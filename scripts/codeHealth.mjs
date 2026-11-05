// npm run lint: the code-health ratchet (docs/code-health.md). Runs oxlint (type-aware) and knip, counts every source
// file's lines, and fails only on what code-health.baseline.json doesn't already have: a new lint finding, a new
// unused file/export/dependency, or a file past its size budget.
//   node scripts/codeHealth.mjs            check (what CI runs)
//   node scripts/codeHealth.mjs --update   lower the baseline to what's fixed (never raises it)
//   node scripts/codeHealth.mjs --accept   record the run as it is (renames, an accepted exception: say why in the PR)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  SOURCE_DIRS,
  compare,
  describeRegression,
  isSourceFile,
  knipFindings,
  lineCount,
  lintCounts,
  lowered,
  makeBaseline,
  normalizePath,
  parseBaseline,
  serializeBaseline,
} from './codeHealthSteps.mjs';

const root = path.resolve(import.meta.dirname, '..');
const baselineFile = path.join(root, 'code-health.baseline.json');
const mode = process.argv.includes('--accept') ? 'accept' : process.argv.includes('--update') ? 'update' : 'check';

/** Runs a package's JS bin with this Node (no shell, no .cmd shims on Windows) and returns its stdout. */
function runBin(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'node_modules', ...bin), ...args], { cwd: root, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => {
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`${bin[0]} exited ${code} without a JSON report:\n${stderr || stdout}`));
      }
    });
  });
}

function sourceSizes() {
  const sizes = {};
  for (const dir of SOURCE_DIRS) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const rel of fs.readdirSync(abs, { recursive: true })) {
      const file = normalizePath(path.join(dir, String(rel)));
      if (file.includes('/node_modules/') || !isSourceFile(file)) continue;
      sizes[file] = lineCount(fs.readFileSync(path.join(root, file), 'utf8'));
    }
  }
  return sizes;
}

const [oxlint, knip] = await Promise.all([
  runBin(['oxlint', 'bin', 'oxlint'], ['--type-aware', '--format', 'json']),
  runBin(['knip', 'bin', 'knip.js'], ['--reporter', 'json', '--no-progress']),
]);
const current = { lint: lintCounts(oxlint), knip: knipFindings(knip), sizes: sourceSizes() };
const baseline = fs.existsSync(baselineFile)
  ? parseBaseline(fs.readFileSync(baselineFile, 'utf8'))
  : { lint: {}, knip: [], sizes: {} };

if (mode !== 'check') {
  const next = mode === 'accept' ? makeBaseline(current) : lowered(baseline, current);
  fs.writeFileSync(baselineFile, serializeBaseline(next));
  console.log(`wrote ${path.basename(baselineFile)} (${mode === 'accept' ? 'the run as it is' : 'lowered to the run'})`);
  process.exit(0);
}

const { regressions, improvements } = compare(baseline, current);
const total = (lint) => Object.values(lint).reduce((n, rules) => n + Object.values(rules).reduce((a, b) => a + b, 0), 0);
console.log(
  `code health: ${total(current.lint)} lint findings, ${current.knip.length} knip findings, ` +
    `${Object.keys(makeBaseline(current).sizes).length} files over 800 lines (baseline: ${total(baseline.lint)} / ${baseline.knip.length} / ${Object.keys(baseline.sizes).length})`,
);
if (improvements.length) {
  console.log(`${improvements.length} fixed since the baseline: run npm run lint:update and commit code-health.baseline.json to keep them fixed.`);
}
if (!regressions.length) {
  console.log('no new findings.');
  process.exit(0);
}

console.error(`\n${regressions.length} new finding(s) over the baseline:`);
for (const r of regressions) {
  console.error(`  ✗ ${describeRegression(r)}`);
  if (r.kind !== 'lint') continue;
  // Counts per file and rule can't say which one is new: show them all.
  for (const d of oxlint.diagnostics) {
    if (normalizePath(d.filename) !== r.file || d.code !== r.rule) continue;
    const span = d.labels?.[0]?.span;
    console.error(`      ${r.file}:${span?.line ?? '?'}:${span?.column ?? '?'} ${d.message}`);
  }
}
console.error(
  '\nFix them (docs/code-health.md has the rules). If one is a rename or a deliberate exception, ' +
    'run node scripts/codeHealth.mjs --accept and say why in the PR.',
);
process.exit(1);
