// The code-health ratchet's pure rules (scripts/codeHealth.mjs runs the tools): what oxlint's and knip's reports
// count as, the file-size budget, comparing a run with the checked-in baseline, and writing that baseline so the
// same findings always give the same file. Plain JavaScript like the other scripts, so it runs without a build.

/** Source files under these folders count for the size budget. */
export const SOURCE_DIRS = ['client', 'server', 'shared', 'scripts', 'bin', 'e2e'];
export const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.css'];
/** A file not in the baseline may not pass this many lines. */
export const NEW_FILE_MAX_LINES = 800;
/** A file in the baseline (over NEW_FILE_MAX_LINES when it was recorded) may grow this much past its recorded size. */
export const GROWTH_ALLOWANCE = 0.05;

/** Plain code-unit order, the same on every machine (localeCompare isn't). */
const byKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Forward slashes, no leading `./`, so Windows and Linux runs write the same baseline. */
export function normalizePath(file) {
  return String(file).replaceAll('\\', '/').replace(/^\.\//, '');
}

/** Lines in a file's text, as `wc -l` counts them for a file ending in a newline; CRLF counts the same as LF. */
export function lineCount(text) {
  if (text === '') return 0;
  const lines = text.split(/\r?\n/).length;
  return text.endsWith('\n') ? lines - 1 : lines;
}

export function isSourceFile(file) {
  const f = normalizePath(file);
  return SOURCE_DIRS.some((d) => f.startsWith(`${d}/`)) && SOURCE_EXTENSIONS.some((e) => f.endsWith(e));
}

/** The most lines `file` may have: its recorded size plus the allowance, or the new-file cap. */
export function sizeLimit(file, sizes) {
  const recorded = sizes[normalizePath(file)];
  return recorded == null ? NEW_FILE_MAX_LINES : Math.floor(recorded * (1 + GROWTH_ALLOWANCE));
}

/** oxlint's JSON report → { file: { rule: count } }. */
export function lintCounts(report) {
  const out = {};
  for (const d of report.diagnostics ?? []) {
    const file = normalizePath(d.filename);
    const rule = d.code ?? 'unknown';
    out[file] ??= {};
    out[file][rule] = (out[file][rule] ?? 0) + 1;
  }
  return out;
}

/** knip's JSON report → sorted unique ids like `exports:server/voice.ts:CACHE_MAX_FILES` or `files:client/x.ts`. */
export function knipFindings(report) {
  const out = new Set();
  for (const issue of report.issues ?? []) {
    const file = normalizePath(issue.file);
    for (const [kind, value] of Object.entries(issue)) {
      if (kind === 'file' || kind === 'owners') continue;
      const items = Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : [];
      for (const item of items) {
        // `duplicates` holds arrays of names exported twice; everything else holds { name }.
        const name = Array.isArray(item) ? item.map((i) => i.name).join('|') : item?.name;
        if (kind === 'files') out.add(`files:${file}`);
        else if (name) out.add(`${kind}:${file}:${name}`);
      }
    }
  }
  return [...out].sort(byKey);
}

/** The files that need a recorded size: those over the new-file cap. */
export function bigFiles(sizes) {
  const out = {};
  for (const [file, lines] of Object.entries(sizes)) if (lines > NEW_FILE_MAX_LINES) out[normalizePath(file)] = lines;
  return out;
}

/** A baseline from one run: `lint` from lintCounts, `knip` from knipFindings, `sizes` every source file's lines. */
export function makeBaseline({ lint, knip, sizes }) {
  return { lint, knip, sizes: bigFiles(sizes) };
}

/**
 * Compares a run (`current`, as makeBaseline takes it) with the baseline. Regressions fail the check; improvements
 * are what `--update` would lock in.
 */
export function compare(baseline, current) {
  const regressions = [];
  const improvements = [];
  const base = baseline.lint ?? {};
  for (const [file, rules] of Object.entries(current.lint)) {
    for (const [rule, count] of Object.entries(rules)) {
      const was = base[file]?.[rule] ?? 0;
      if (count > was) regressions.push({ kind: 'lint', file, rule, was, now: count });
    }
  }
  for (const [file, rules] of Object.entries(base)) {
    for (const [rule, was] of Object.entries(rules)) {
      const now = current.lint[file]?.[rule] ?? 0;
      if (now < was) improvements.push({ kind: 'lint', file, rule, was, now });
    }
  }
  const knownKnip = new Set(baseline.knip ?? []);
  const nowKnip = new Set(current.knip);
  for (const id of current.knip) if (!knownKnip.has(id)) regressions.push({ kind: 'knip', id });
  for (const id of knownKnip) if (!nowKnip.has(id)) improvements.push({ kind: 'knip', id });
  const recorded = baseline.sizes ?? {};
  for (const [file, lines] of Object.entries(current.sizes)) {
    const limit = sizeLimit(file, recorded);
    if (lines > limit) regressions.push({ kind: 'size', file, lines, limit, recorded: recorded[file] ?? null });
  }
  for (const [file, was] of Object.entries(recorded)) {
    const now = current.sizes[file] ?? 0;
    if (now < was) improvements.push({ kind: 'size', file, was, now });
  }
  const order = (x) => `${x.kind}:${x.file ?? x.id}:${x.rule ?? ''}`;
  regressions.sort((a, b) => byKey(order(a), order(b)));
  improvements.sort((a, b) => byKey(order(a), order(b)));
  return { regressions, improvements };
}

/**
 * The baseline after `--update`: only ever lower. Each count drops to the run's, findings that are gone are dropped,
 * and a big file's recorded size drops to its current size (or out, below the cap). Nothing new gets in: that takes
 * `--accept`, which records the run as it is.
 */
export function lowered(baseline, current) {
  const lint = {};
  for (const [file, rules] of Object.entries(baseline.lint ?? {})) {
    for (const [rule, was] of Object.entries(rules)) {
      const n = Math.min(was, current.lint[file]?.[rule] ?? 0);
      if (n > 0) (lint[file] ??= {})[rule] = n;
    }
  }
  const nowKnip = new Set(current.knip);
  const knip = (baseline.knip ?? []).filter((id) => nowKnip.has(id));
  const sizes = {};
  for (const [file, was] of Object.entries(baseline.sizes ?? {})) {
    const n = Math.min(was, current.sizes[file] ?? 0);
    if (n > NEW_FILE_MAX_LINES) sizes[file] = n;
  }
  return { lint, knip, sizes };
}

function sortedObject(obj, depth) {
  const out = {};
  for (const key of Object.keys(obj).sort(byKey)) out[key] = depth > 1 ? sortedObject(obj[key], depth - 1) : obj[key];
  return out;
}

/** The baseline file's text: keys and findings sorted, so the same findings always write the same bytes. */
export function serializeBaseline(baseline) {
  const doc = {
    about: 'code-health ratchet baseline: npm run lint fails on anything above this. Lower it with npm run lint:update.',
    lint: sortedObject(baseline.lint ?? {}, 2),
    knip: [...new Set(baseline.knip ?? [])].sort(byKey),
    sizes: sortedObject(baseline.sizes ?? {}, 1),
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export function parseBaseline(text) {
  const doc = JSON.parse(text);
  return { lint: doc.lint ?? {}, knip: doc.knip ?? [], sizes: doc.sizes ?? {} };
}

/** One line per regression, for the console. */
export function describeRegression(r) {
  if (r.kind === 'lint') return `${r.file}: ${r.rule} ${r.was} → ${r.now}`;
  if (r.kind === 'knip') return `knip ${r.id.replace(':', ': ')}`;
  return r.recorded == null
    ? `${r.file}: ${r.lines} lines, new files may have at most ${r.limit}`
    : `${r.file}: ${r.lines} lines, over its budget of ${r.limit} (${r.recorded} + ${Math.round(GROWTH_ALLOWANCE * 100)}%)`;
}
