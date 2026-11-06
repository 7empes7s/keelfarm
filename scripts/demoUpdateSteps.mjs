// The public demo's auto-update (ops/cubefarm-demo-update.sh, docs/public-demo.md): its pure decisions, plus a tiny
// CLI the shell script calls. Plain JavaScript so the host runs it with Node alone, no install or build.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const MIN_MEM_KB = 2 * 1024 * 1024;
const HOST_PATHS = ['/root', '/opt', '/var/lib'];

/** MemAvailable from /proc/meminfo, in kB (0 when missing, so a strange file never lets a build start). */
export function memAvailableKb(meminfo) {
  const m = /^MemAvailable:\s+(\d+)\s*kB/m.exec(meminfo);
  return m ? Number(m[1]) : 0;
}

/** The newest push or manual run of CI on the sha, from GitHub's `actions/workflows/ci.yml/runs` answer. */
export function ciRun(runsJson) {
  const runs = (runsJson?.workflow_runs ?? []).filter((r) => r.event === 'push' || r.event === 'workflow_dispatch');
  runs.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const r = runs[0];
  return r ? { id: r.id, status: r.status, conclusion: r.conclusion } : null;
}

/**
 * What one tick does. `key` names the reason so the script logs a wait or skip once per (sha, key), not every tick.
 * @returns {{ action: 'idle' | 'wait' | 'skip' | 'update', key: string, message: string }}
 */
export function decide({ target, current, failed, ci, memKb, minMemKb = MIN_MEM_KB }) {
  const s = target.slice(0, 7);
  if (target === current) return { action: 'idle', key: 'current', message: '' };
  if (failed) return { action: 'skip', key: 'failed', message: `skip ${s}: its update already failed and was rolled back` };
  if (!ci) return { action: 'wait', key: 'no-run', message: `wait ${s}: no CI run on this commit yet` };
  if (ci.status !== 'completed') return { action: 'wait', key: `ci-${ci.status}`, message: `wait ${s}: CI run ${ci.id} is ${ci.status}` };
  // A newer push cancels the run it replaces: that sha is about to stop being the head, so wait rather than skip.
  if (ci.conclusion === 'cancelled') return { action: 'wait', key: 'ci-cancelled', message: `wait ${s}: CI run ${ci.id} was cancelled` };
  if (ci.conclusion !== 'success') return { action: 'skip', key: `ci-${ci.conclusion}`, message: `skip ${s}: CI run ${ci.id} concluded ${ci.conclusion}` };
  if (memKb < minMemKb) {
    return { action: 'wait', key: 'memory', message: `wait ${s}: MemAvailable ${Math.round(memKb / 1024)} MB < ${Math.round(minMemKb / 1024)} MB` };
  }
  return { action: 'update', key: 'update', message: `update ${current.slice(0, 7) || 'none'} -> ${s} (CI run ${ci.id} success)` };
}

/** The health check from docs/public-demo.md "Verification": null when healthy, else why not. */
export function healthProblem({ rootStatus, rootBody, stateStatus, stateBody }) {
  if (rootStatus !== 200) return `GET / answered ${rootStatus}`;
  if (stateStatus !== 200) return `GET /api/state answered ${stateStatus}`;
  let state;
  try { state = JSON.parse(stateBody); } catch { return '/api/state is not JSON'; }
  if (state?.demo !== true) return '/api/state is not in demo mode';
  for (const [name, body] of [['/', rootBody], ['/api/state', stateBody]]) {
    const leak = HOST_PATHS.find((p) => body.includes(p));
    if (leak) return `${name} shows a host path (${leak})`;
  }
  return null;
}

/** Releases to delete: everything but the newest `keep` (by mtime) and never the running or the previous one. */
export function prunable(releases, { keep, protect }) {
  return [...releases]
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(keep)
    .map((r) => r.name)
    .filter((n) => !protect.includes(n));
}

// ---------- CLI ----------
// decide <target> <current> <failed 0|1> <runs.json> <meminfo>  → prints "action\tkey\tmessage"
// health <rootStatus> <rootBody> <stateStatus> <stateBody>       → exit 0, or prints the problem and exits 1
// status <result> <sha> <message>                                → prints the status file's JSON
// prune <releasesDir> <keep> <protected sha…>                     → prints the release folders to delete

function main([cmd, ...a]) {
  if (cmd === 'decide') {
    const [target, current, failed, runsFile, meminfoFile] = a;
    let ci = null;
    try { ci = ciRun(JSON.parse(readFileSync(runsFile, 'utf8'))); } catch { /* no answer: wait */ }
    const d = decide({ target, current, failed: failed === '1', ci, memKb: memAvailableKb(readFileSync(meminfoFile, 'utf8')) });
    process.stdout.write(`${d.action}\t${d.key}\t${d.message}\n`);
    return 0;
  }
  if (cmd === 'health') {
    const [rootStatus, rootFile, stateStatus, stateFile] = a;
    const read = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
    const problem = healthProblem({ rootStatus: Number(rootStatus), rootBody: read(rootFile), stateStatus: Number(stateStatus), stateBody: read(stateFile) });
    if (problem) process.stdout.write(`${problem}\n`);
    return problem ? 1 : 0;
  }
  if (cmd === 'status') {
    const [result, sha, message] = a;
    process.stdout.write(`${JSON.stringify({ result, sha, message, at: new Date().toISOString() })}\n`);
    return 0;
  }
  if (cmd === 'prune') {
    const [dir, keep, ...protect] = a;
    const releases = readdirSync(dir).filter((n) => /^[0-9a-f]{40}$/.test(n))
      .map((name) => ({ name, mtimeMs: statSync(path.join(dir, name)).mtimeMs }));
    for (const n of prunable(releases, { keep: Number(keep), protect })) process.stdout.write(`${n}\n`);
    return 0;
  }
  process.stderr.write('usage: demoUpdateSteps.mjs decide|health|status|prune …\n');
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main(process.argv.slice(2));
