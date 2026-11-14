// The CEO chat's files store on the office server (shared/files.ts has the rules): `<SWARM_HOME>/files/<id>`, owner
// only, with an index of names, types and keep flags beside them. Files arrive from the manager's phone (uploads) or
// from the CEO (attach_file copies one from its folders), are served by id only, and are deleted 30 days after upload
// unless kept. Never in state.json, never in git.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { diskProblem, expired, expiry, fileType, formatSize, isFileId, MAX_FILE_BYTES, sanitizeName, type FileRef, type FileView } from '../shared/files.ts';
import { HttpError } from './httpError.ts';

interface StoredFile extends FileRef {
  keepReason?: string;
}

/** A file's bytes in the store: refuses anything that isn't a store id, so no request can name a path. */
export function filePath(root: string, id: string): string {
  if (!isFileId(id)) throw new HttpError(400, 'Not a file id');
  return path.join(root, id);
}

/** True when `child` is `parent` or inside it. */
function inside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * attach_file's checks: an absolute path to a regular file that, with every symlink resolved, is inside one of
 * `roots`, of any type and at most 500 MB. Errors say what to do instead.
 */
export async function checkAttachPath(p: string, roots: readonly string[], max = MAX_FILE_BYTES): Promise<{ real: string; name: string; size: number }> {
  if (!path.isAbsolute(p)) throw new Error(`Give an absolute path, not "${p}".`);
  const real = await fs.realpath(p).catch(() => null);
  if (!real) throw new Error(`There is no file at ${p}. Write it first, then attach it.`);
  const allowed = await Promise.all(roots.map((r) => fs.realpath(r).catch(() => null)));
  if (!allowed.some((r) => r && inside(real, r))) throw new Error(`${p} is outside the folders files can be attached from. Save it under ${roots[0]} first.`);
  const st = await fs.stat(real);
  if (!st.isFile()) throw new Error(`${p} is not a file.`);
  const name = sanitizeName(path.basename(p));
  if (st.size > max) throw new Error(`${name} is ${formatSize(st.size)}; files can be at most ${formatSize(max)}.`);
  if (st.size === 0) throw new Error(`${name} is empty.`);
  return { real, name, size: st.size };
}

/** Free bytes on the disk holding `dir`. */
async function diskFree(dir: string): Promise<number> {
  const s = await fs.statfs(dir);
  return s.bavail * s.bsize;
}

export class FileStore {
  private files = new Map<string, StoredFile>();
  private saving: Promise<void> = Promise.resolve();

  /** `freeBytes`: the disk probe (tests pass a fake one). */
  constructor(
    readonly root: string,
    private onChange: () => void = () => undefined,
    private freeBytes: (dir: string) => Promise<number> = diskFree,
  ) {}

  /** 507 when taking `incoming` bytes would leave the disk under MIN_FREE_BYTES free. */
  private async checkDisk(incoming: number) {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    const free = await this.freeBytes(this.root).catch(() => {
      throw new HttpError(503, "Couldn't check free disk space. Try the upload again.");
    });
    const why = diskProblem(free, incoming);
    if (why) throw new HttpError(507, why);
  }

  private get indexFile() {
    return path.join(this.root, 'index.json');
  }

  async load() {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    const raw = await fs.readFile(this.indexFile, 'utf8').catch(() => '[]');
    let list: StoredFile[] = [];
    try {
      list = JSON.parse(raw) as StoredFile[];
    } catch {
      console.warn('files: the index was unreadable; starting empty');
    }
    for (const f of Array.isArray(list) ? list : []) if (f && isFileId(f.id)) this.files.set(f.id, f);
  }

  /** Every file, newest first. */
  list(): FileView[] {
    return [...this.files.values()].sort((a, b) => b.at - a.at).map((f) => ({ ...f, expiresAt: f.keep ? null : expiry(f) }));
  }

  get(id: string): StoredFile | undefined {
    return isFileId(id) ? this.files.get(id) : undefined;
  }

  pathOf(id: string) {
    return filePath(this.root, id);
  }

  /**
   * An upload: the stream's bytes written as they arrive, refused with 413 past `max` (counted, whatever the declared
   * length said) and with 507 when the disk can't take `meta.length` more. A failed or cut-off upload leaves nothing.
   */
  async addStream(body: Readable, meta: { name: string; type: string; from: FileRef['from']; length?: number }, max = MAX_FILE_BYTES): Promise<FileRef> {
    const name = sanitizeName(meta.name);
    await this.checkDisk(meta.length ?? 0);
    const id = crypto.randomBytes(12).toString('hex');
    const part = `${this.pathOf(id)}.part`;
    let size = 0;
    const count = new Transform({
      transform(chunk: Buffer, _enc, done) {
        size += chunk.length;
        if (size > max) done(new HttpError(413, `${name} is over ${formatSize(max)}: files can be at most ${formatSize(max)}.`));
        else done(null, chunk);
      },
    });
    try {
      await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
      await pipeline(body, count, createWriteStream(part, { mode: 0o600 }));
    } catch (err) {
      await fs.rm(part, { force: true, maxRetries: 3 }).catch(() => undefined);
      throw err;
    }
    if (!size) {
      await fs.rm(part, { force: true, maxRetries: 3 }).catch(() => undefined);
      throw new HttpError(400, `${name} is empty.`);
    }
    await fs.rename(part, this.pathOf(id));
    return this.record({ id, name, type: fileType(name, meta.type), size, from: meta.from, at: Date.now(), keep: false });
  }

  /** A copy of a file already checked (checkAttachPath), e.g. one the CEO made. A file of the store itself is returned as it is. */
  async addCopy(real: string, meta: { name: string; from: FileRef['from'] }): Promise<FileRef> {
    const own = path.basename(real);
    if (path.dirname(real) === (await fs.realpath(this.root).catch(() => this.root)) && this.files.has(own)) return this.files.get(own)!;
    await this.checkDisk((await fs.stat(real)).size);
    const id = crypto.randomBytes(12).toString('hex');
    await fs.copyFile(real, this.pathOf(id));
    await fs.chmod(this.pathOf(id), 0o600).catch(() => undefined);
    const { size } = await fs.stat(this.pathOf(id));
    return this.record({ id, name: meta.name, type: fileType(meta.name), size, from: meta.from, at: Date.now(), keep: false });
  }

  private record(f: StoredFile): FileRef {
    this.files.set(f.id, f);
    this.changed();
    const { keepReason: _, ...ref } = f;
    return ref;
  }

  /** Keep (never deleted) or unkeep: an unkept file goes at its original expiry, or at the next sweep if that has passed. */
  setKeep(id: string, keep: boolean, reason?: string): StoredFile {
    const f = this.get(id);
    if (!f) throw new HttpError(404, 'That file is no longer saved');
    f.keep = keep;
    if (keep && reason) f.keepReason = reason.slice(0, 200);
    if (!keep) delete f.keepReason;
    this.changed();
    return f;
  }

  async remove(id: string) {
    const f = this.get(id);
    if (!f) throw new HttpError(404, 'That file is no longer saved');
    this.files.delete(id);
    await fs.rm(this.pathOf(id), { force: true, maxRetries: 3 }).catch((err) => console.warn('files: could not delete', id, err));
    this.changed();
  }

  /** Deletes every expired file and its bytes (shared/files.ts expired); returns how many went. */
  async sweep(now = Date.now()): Promise<number> {
    const gone = [...this.files.values()].filter((f) => expired(f, now));
    for (const f of gone) {
      this.files.delete(f.id);
      await fs.rm(this.pathOf(f.id), { force: true, maxRetries: 3 }).catch(() => undefined);
    }
    if (gone.length) this.changed();
    return gone.length;
  }

  /** Waits for the index to be written (tests, shutdown). */
  flush() {
    return this.saving;
  }

  private changed() {
    const list = JSON.stringify([...this.files.values()]);
    this.saving = this.saving.then(async () => {
      const tmp = `${this.indexFile}.tmp`;
      try {
        await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
        await fs.writeFile(tmp, list, { mode: 0o600 });
        await fs.rename(tmp, this.indexFile);
      } catch (err) {
        console.warn('files: could not save the index', err);
      }
    });
    this.onChange();
  }
}
