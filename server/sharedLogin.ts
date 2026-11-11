// One shared set for every Claude login on this computer (#377): an account's own login folder (CLAUDE_CONFIG_DIR, under
// <SWARM_HOME>/accounts/<id>/claude) links to the built-in login's transcripts and auto memory, CLAUDE.md, skills,
// agents, commands, plugins, settings.json and history.jsonl, so a switch of account keeps the memory and `--resume`
// finds the conversation. Each account keeps its own .credentials.json, .claude.json, locks and caches. What an account
// folder already had of the shared items is merged into the shared set first, never overwriting or deleting a file
// there: a same-name file that differs is kept beside it as <name>.from-<account>. Only the account folder is changed
// otherwise. Folders link as junctions on Windows; a file that can't be a symlink is hard-linked, else copied.
import fs from 'node:fs';
import path from 'node:path';

/** What every Claude login shares; true: a folder. */
export const SHARED_ITEMS: readonly { name: string; dir: boolean }[] = [
  { name: 'projects', dir: true },
  { name: 'CLAUDE.md', dir: false },
  { name: 'skills', dir: true },
  { name: 'agents', dir: true },
  { name: 'commands', dir: true },
  { name: 'plugins', dir: true },
  { name: 'settings.json', dir: false },
  { name: 'history.jsonl', dir: false },
];

/** What preparing a folder did: items linked now, items merged into the shared set, and items it couldn't share. */
export interface ShareResult {
  linked: string[];
  moved: string[]; // "<item path> → <where in the shared set>"
  missing: string[];
}

/** history.jsonl's lines in `mine` that `shared` doesn't have yet, in order (a line is one prompt, already timestamped). */
export function newLines(shared: string, mine: string): string[] {
  const have = new Set(shared.split(/\r?\n/));
  return mine.split(/\r?\n/).filter((l) => l.trim() && !have.has(l));
}

/** A name for a copy kept beside one of the same name: <name>.from-<account>, then .from-<account>-2, … */
export function keptName(name: string, account: string, taken: (n: string) => boolean): string {
  let n = `${name}.from-${account}`;
  for (let i = 2; taken(n); i++) n = `${name}.from-${account}-${i}`;
  return n;
}

// ---------- on disk ----------

const lstat = (p: string) => {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
};

const real = (p: string) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
};

/** Whether `p` is `target` (through a link) or the same file (a hard link), or (`copies`) a copy with the same bytes. */
function isShared(p: string, target: string, dir: boolean, copies = true): boolean {
  const a = real(p);
  const b = real(target);
  if (!a || !b) return false;
  if (path.resolve(a) === path.resolve(b)) return true;
  if (dir) return false;
  const sa = fs.statSync(a);
  const sb = fs.statSync(b);
  if (sa.ino && sa.ino === sb.ino && sa.dev === sb.dev) return true;
  return copies && sa.size === sb.size && fs.readFileSync(a).equals(fs.readFileSync(b));
}

function move(from: string, to: string) {
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false });
    fs.rmSync(from, { recursive: true, force: true, maxRetries: 5 });
  }
}

/** A link (a symlink or junction, never a real folder) taken away. */
function unlink(p: string) {
  try {
    fs.unlinkSync(p);
  } catch {
    fs.rmdirSync(p); // a junction on some Windows versions
  }
}

/**
 * `mine` (a file) merged into the shared set's entry `name` in `sharedDir`: the same bytes dropped, else kept beside it;
 * `append`: its new lines added instead (history.jsonl).
 */
function mergeFile(mine: string, sharedDir: string, name: string, account: string, moved: string[], append = false) {
  const target = path.join(sharedDir, name);
  if (append) {
    const lines = newLines(fs.readFileSync(target, 'utf8'), fs.readFileSync(mine, 'utf8'));
    if (lines.length) {
      const text = fs.readFileSync(target, 'utf8');
      fs.appendFileSync(target, `${text && !text.endsWith('\n') ? '\n' : ''}${lines.join('\n')}\n`);
      moved.push(`${mine} → ${target} (${lines.length} line${lines.length === 1 ? '' : 's'})`);
    }
    fs.unlinkSync(mine);
    return;
  }
  if (fs.readFileSync(mine).equals(fs.readFileSync(target))) return fs.unlinkSync(mine);
  const kept = path.join(sharedDir, keptName(name, account, (n) => !!lstat(path.join(sharedDir, n))));
  move(mine, kept);
  moved.push(`${mine} → ${kept}`);
}

/** Everything in folder `mine` merged into folder `shared`, then `mine` removed once it's empty. */
function mergeDir(mine: string, shared: string, account: string, moved: string[]) {
  for (const e of fs.readdirSync(mine, { withFileTypes: true })) {
    const m = path.join(mine, e.name);
    const s = path.join(shared, e.name);
    const there = lstat(s);
    if (!there) {
      move(m, s);
      moved.push(`${m} → ${s}`);
    } else if (e.isDirectory() && there.isDirectory()) mergeDir(m, s, account, moved);
    else if (e.isFile() && there.isFile()) mergeFile(m, shared, e.name, account, moved);
    else {
      const kept = path.join(shared, keptName(e.name, account, (n) => !!lstat(path.join(shared, n))));
      move(m, kept);
      moved.push(`${m} → ${kept}`);
    }
  }
  fs.rmdirSync(mine);
}

function link(target: string, p: string, dir: boolean) {
  if (dir) return fs.symlinkSync(target, p, 'junction'); // the type only matters on Windows, where junctions need no rights
  try {
    fs.symlinkSync(target, p, 'file');
  } catch {
    try {
      fs.linkSync(target, p); // Windows without symlink rights
    } catch {
      fs.copyFileSync(target, p);
    }
  }
}

/**
 * Links an account's login folder `dir` to the shared set in `source` (the built-in login's folder), merging what the
 * folder already had into it first. Runs again safely: a link that's right is left alone, a broken or replaced one is
 * made again. An item the shared set doesn't have and the account doesn't either is skipped. Never touches `source`
 * except to add what the account had.
 */
export function shareLogin(dir: string, source: string, account: string): ShareResult {
  const r: ShareResult = { linked: [], moved: [], missing: [] };
  if (!lstat(source)?.isDirectory() || path.resolve(dir) === path.resolve(source)) return r;
  fs.mkdirSync(dir, { recursive: true });
  for (const { name, dir: isDir } of SHARED_ITEMS) {
    const target = path.join(source, name);
    const p = path.join(dir, name);
    try {
      const at = lstat(p);
      if (at && isShared(p, target, isDir, false)) continue;
      if (at?.isSymbolicLink()) unlink(p);
      else if (at) {
        if (!lstat(target)) {
          move(p, target); // only this account has it: it becomes the shared one
          r.moved.push(`${p} → ${target}`);
        } else if (isDir && at.isDirectory() && lstat(target)!.isDirectory()) mergeDir(p, target, account, r.moved);
        else if (!isDir && at.isFile()) mergeFile(p, source, name, account, r.moved, name === 'history.jsonl');
        else continue; // a folder where a file belongs (or the other way round): left as it is, and reported below
      }
      if (!lstat(target)) continue;
      link(target, p, isDir);
      r.linked.push(name);
    } catch (err) {
      console.warn(`account ${account}: couldn't share ${name}: ${(err as Error).message}`);
    }
  }
  r.missing = shareStatus(dir, source);
  return r;
}

/** The shared items `dir` doesn't share with `source` (that `source` has); nothing is written. */
export function shareStatus(dir: string, source: string): string[] {
  if (!lstat(source)?.isDirectory() || path.resolve(dir) === path.resolve(source)) return [];
  return SHARED_ITEMS.filter(({ name, dir: isDir }) => lstat(path.join(source, name)) && !isShared(path.join(dir, name), path.join(source, name), isDir)).map((i) => i.name);
}

/** The links in an account's folder taken away (before the folder is deleted), so nothing reaches the shared set. */
export function unshareLogin(dir: string) {
  for (const { name } of SHARED_ITEMS) {
    const p = path.join(dir, name);
    if (lstat(p)?.isSymbolicLink()) unlink(p);
  }
}
