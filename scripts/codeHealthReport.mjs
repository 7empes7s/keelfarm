// node scripts/codeHealthReport.mjs: prints the measured tables of docs/code-health.md as Markdown. Report only, never
// run by CI. It reads code-health.baseline.json (lint and knip counts) and the source files (sizes, and functions'
// length and cyclomatic complexity, parsed with oxc-parser), plus whatever these left in .code-health/ (docs/code-health.md
// has the exact commands): jscpd/jscpd-report.json, coverage/coverage-summary.json and tests.json.
import fs from 'node:fs';
import path from 'node:path';
import { parseSync } from 'oxc-parser';
import { SOURCE_DIRS, isSourceFile, lineCount, normalizePath, parseBaseline } from './codeHealthSteps.mjs';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, '.code-health');
const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);
const rel = (abs) => normalizePath(path.relative(root, abs));
const lines = [];
const print = (s = '') => lines.push(s);
const table = (head, rows) => {
  print(`| ${head.join(' | ')} |`);
  // Numbers right-aligned, text left.
  print(`| ${head.map((h, i) => (rows.every((r) => typeof r[i] === 'number') ? '---:' : '---')).join(' | ')} |`);
  for (const r of rows) print(`| ${r.join(' | ')} |`);
  print();
};

/** client/src/world/x.ts → client/src/world; server/x.ts → server. */
function area(file) {
  const parts = normalizePath(file).split('/');
  if (parts[0] === 'client' && parts[1] === 'src') return parts.length > 3 ? parts.slice(0, 3).join('/') : 'client/src';
  return parts[0];
}

function sourceFiles() {
  const files = [];
  for (const dir of SOURCE_DIRS) {
    for (const r of fs.readdirSync(path.join(root, dir), { recursive: true })) {
      const file = normalizePath(path.join(dir, String(r)));
      if (!file.includes('/node_modules/') && isSourceFile(file)) files.push(file);
    }
  }
  return files.sort();
}

// ---------- functions and complexity ----------

const DECISIONS = new Set([
  'IfStatement',
  'ConditionalExpression',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
  'CatchClause',
  'AssignmentPattern',
]);
const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/** ESLint's `complexity`: 1 + branches, loops, catches, cases, defaults, && || ?? (and their assignments). */
function decisions(node) {
  if (DECISIONS.has(node.type)) return 1;
  if (node.type === 'SwitchCase') return node.test ? 1 : 0;
  if (node.type === 'LogicalExpression') return 1;
  if (node.type === 'AssignmentExpression') return ['&&=', '||=', '??='].includes(node.operator) ? 1 : 0;
  return 0;
}

function children(node) {
  const out = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'type' || !value || typeof value !== 'object') continue;
    if (Array.isArray(value)) for (const v of value) v && typeof v.type === 'string' && out.push(v);
    else if (typeof value.type === 'string') out.push(value);
  }
  return out;
}

function nameOf(node, parent) {
  if (node.id?.name) return node.id.name;
  if (parent?.type === 'VariableDeclarator' && parent.id?.name) return parent.id.name;
  if ((parent?.type === 'MethodDefinition' || parent?.type === 'Property' || parent?.type === 'PropertyDefinition') && parent.key) {
    return parent.key.name ?? parent.key.value ?? '(computed)';
  }
  return '(anonymous)';
}

function functionsIn(file) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  if (file.endsWith('.css')) return [];
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  const lineAt = (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const found = [];
  // Walks one function's body, counting its decisions; nested functions are measured on their own.
  const measure = (fn, parent) => {
    const entry = { file, name: nameOf(fn, parent), line: lineAt(fn.start), lines: lineAt(fn.end) - lineAt(fn.start) + 1, complexity: 1 };
    found.push(entry);
    const stack = children(fn).map((c) => [c, fn]);
    while (stack.length) {
      const [node, up] = stack.pop();
      if (FUNCTIONS.has(node.type)) {
        measure(node, up);
        continue;
      }
      entry.complexity += decisions(node);
      for (const c of children(node)) stack.push([c, node]);
    }
  };
  const { program } = parseSync(file, text);
  const stack = [[program, null]];
  while (stack.length) {
    const [node, up] = stack.pop();
    if (FUNCTIONS.has(node.type)) measure(node, up);
    else for (const c of children(node)) stack.push([c, node]);
  }
  return found;
}

// ---------- report ----------

const files = sourceFiles();
const sizes = Object.fromEntries(files.map((f) => [f, lineCount(fs.readFileSync(path.join(root, f), 'utf8'))]));
const totalLines = Object.values(sizes).reduce((a, b) => a + b, 0);
print(`### Size\n`);
print(`${files.length} source files, ${totalLines} lines (${SOURCE_DIRS.join(', ')}; tests included).\n`);
const bySize = Object.entries(sizes).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
table(['File', 'Lines'], bySize.slice(0, 15).map(([f, n]) => [`\`${f}\``, n]));

const fns = files.filter((f) => !/\.test\.tsx?$/.test(f)).flatMap(functionsIn);
print(`### Largest and most complex functions\n`);
print(`${fns.length} functions outside tests; ${fns.filter((f) => f.complexity > 20).length} have a complexity over 20, ${fns.filter((f) => f.lines > 100).length} are over 100 lines.\n`);
const fnRow = (f) => [`\`${f.name}\``, `\`${f.file}:${f.line}\``, f.lines, f.complexity];
table(['Function (longest)', 'Where', 'Lines', 'Complexity'], [...fns].sort((a, b) => b.lines - a.lines).slice(0, 15).map(fnRow));
table(['Function (most complex)', 'Where', 'Lines', 'Complexity'], [...fns].sort((a, b) => b.complexity - a.complexity).slice(0, 15).map(fnRow));

const baseline = parseBaseline(fs.readFileSync(path.join(root, 'code-health.baseline.json'), 'utf8'));
print(`### Lint and knip by area\n`);
const areas = {};
const at = (a) => (areas[a] ??= { lint: 0, rules: {}, exports: 0, types: 0, other: 0 });
for (const [file, rules] of Object.entries(baseline.lint)) {
  for (const [rule, n] of Object.entries(rules)) {
    at(area(file)).lint += n;
    at(area(file)).rules[rule] = (at(area(file)).rules[rule] ?? 0) + n;
  }
}
for (const id of baseline.knip) {
  const [kind, file] = id.split(':');
  const a = at(area(file));
  if (kind === 'exports') a.exports++;
  else if (kind === 'types') a.types++;
  else a.other++;
}
const top = (rules) =>
  Object.entries(rules)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([r, n]) => `${r} ${n}`)
    .join(', ');
table(
  ['Area', 'Lint', 'Top rules', 'Unused exports', 'Unused types', 'Other knip'],
  Object.entries(areas)
    .sort((a, b) => b[1].lint + b[1].exports + b[1].types - (a[1].lint + a[1].exports + a[1].types))
    .map(([a, v]) => [`\`${a}\``, v.lint, top(v.rules) || '', v.exports, v.types, v.other]),
);
const ruleTotals = {};
for (const rules of Object.values(baseline.lint)) for (const [r, n] of Object.entries(rules)) ruleTotals[r] = (ruleTotals[r] ?? 0) + n;
table(['Rule', 'Findings'], Object.entries(ruleTotals).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)));

const jscpd = readJson(path.join(out, 'jscpd', 'jscpd-report.json'));
if (jscpd) {
  const t = jscpd.statistics.total;
  print(`### Duplicated blocks (jscpd)\n`);
  print(`${t.clones} clones, ${t.duplicatedLines} duplicated lines of ${t.lines} (${Number(t.percentage).toFixed(2)}%).\n`);
  const dups = [...jscpd.duplicates].sort((a, b) => b.lines - a.lines).slice(0, 12);
  table(
    ['Lines', 'First', 'Second'],
    dups.map((d) => [d.lines, `\`${rel(d.firstFile.name)}:${d.firstFile.start}\``, `\`${rel(d.secondFile.name)}:${d.secondFile.start}\``]),
  );
}

const coverage = readJson(path.join(out, 'coverage', 'coverage-summary.json'));
if (coverage) {
  print(`### Test coverage by area (lines)\n`);
  const cov = {};
  for (const [file, s] of Object.entries(coverage)) {
    if (file === 'total') continue;
    const c = (cov[area(rel(file))] ??= { covered: 0, total: 0, files: 0 });
    c.covered += s.lines.covered;
    c.total += s.lines.total;
    c.files++;
  }
  const pct = (c, t) => (t ? `${((100 * c) / t).toFixed(1)}%` : '–');
  print(`All files the tests load: ${pct(coverage.total.lines.covered, coverage.total.lines.total)} of lines, ${pct(coverage.total.branches.covered, coverage.total.branches.total)} of branches. Files no test imports don't appear (vitest's default).\n`);
  table(
    ['Area', 'Files loaded', 'Lines', 'Covered'],
    Object.entries(cov)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([a, c]) => [`\`${a}\``, c.files, c.total, pct(c.covered, c.total)]),
  );
}

const tests = readJson(path.join(out, 'tests.json'));
if (tests) {
  print(`### Slowest tests\n`);
  print(`${tests.numTotalTests} tests in ${tests.testResults.length} files.\n`);
  const suites = tests.testResults.map((r) => ({ file: rel(r.name), ms: r.endTime - r.startTime }));
  table(['Test file', 'ms'], suites.sort((a, b) => b.ms - a.ms).slice(0, 10).map((s) => [`\`${s.file}\``, Math.round(s.ms)]));
  const cases = tests.testResults.flatMap((r) => r.assertionResults.map((a) => ({ file: rel(r.name), name: a.fullName, ms: a.duration ?? 0 })));
  table(['Test', 'File', 'ms'], cases.sort((a, b) => b.ms - a.ms).slice(0, 10).map((c) => [c.name.replaceAll('|', '\\|'), `\`${c.file}\``, Math.round(c.ms)]));
}

console.log(lines.join('\n'));
