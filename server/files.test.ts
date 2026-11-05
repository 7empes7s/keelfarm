import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RETENTION_MS } from '../shared/files.ts';
import { checkAttachPath, FileStore, filePath } from './files.ts';
import { fileRoutes } from './fileRoutes.ts';
import { HttpError } from './httpError.ts';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cubefarm-files-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 });
});

describe('id → path', () => {
  it('maps ids inside the store and refuses anything path-like', () => {
    expect(filePath(dir, '0123456789abcdef01234567')).toBe(path.join(dir, '0123456789abcdef01234567'));
    for (const bad of ['..', '../x', 'a/b', '0123456789abcdef0123456/', '']) expect(() => filePath(dir, bad)).toThrow(/Not a file id/);
  });
});

describe('attach_file allow-list', () => {
  const roots = () => [path.join(dir, 'ceo')];
  beforeEach(async () => {
    await fs.mkdir(path.join(dir, 'ceo'));
    await fs.writeFile(path.join(dir, 'ceo', 'report.pdf'), '%PDF-1.4');
    await fs.writeFile(path.join(dir, 'secret.pdf'), 'nope');
  });

  it('takes a file in an allowed folder', async () => {
    const ok = await checkAttachPath(path.join(dir, 'ceo', 'report.pdf'), roots());
    expect(ok.name).toBe('report.pdf');
    expect(ok.size).toBe(8);
  });

  it('refuses relative and outside paths, missing files and wrong types', async () => {
    await expect(checkAttachPath('report.pdf', roots())).rejects.toThrow(/absolute/);
    await expect(checkAttachPath(path.join(dir, 'secret.pdf'), roots())).rejects.toThrow(/outside/);
    await expect(checkAttachPath(path.join(dir, 'ceo', '..', 'secret.pdf'), roots())).rejects.toThrow(/outside/);
    await expect(checkAttachPath(path.join(dir, 'ceo', 'gone.pdf'), roots())).rejects.toThrow(/no file/);
    await fs.writeFile(path.join(dir, 'ceo', 'run.exe'), 'x');
    await expect(checkAttachPath(path.join(dir, 'ceo', 'run.exe'), roots())).rejects.toThrow(/can't be attached/);
    await expect(checkAttachPath(path.join(dir, 'ceo', 'report.pdf'), roots(), 4)).rejects.toThrow(/at most/);
  });

  it('refuses a symlink that escapes the folder', async (ctx) => {
    const link = path.join(dir, 'ceo', 'escape.pdf');
    try {
      await fs.symlink(path.join(dir, 'secret.pdf'), link);
    } catch {
      return ctx.skip(); // Windows without symlink rights
    }
    await expect(checkAttachPath(link, roots())).rejects.toThrow(/outside/);
  });
});

describe('the store', () => {
  it('stores, keeps, sweeps and reloads', async () => {
    let changes = 0;
    const store = new FileStore(dir, () => changes++);
    await store.load();
    const a = await store.addStream(Readable.from([Buffer.from('hello')]), { name: '../notes.md', type: 'text/plain', from: 'manager' });
    expect(a).toMatchObject({ name: 'notes.md', type: 'text/markdown', size: 5, keep: false });
    const b = await store.addStream(Readable.from([Buffer.from('world')]), { name: 'b.txt', type: '', from: 'manager' });
    store.setKeep(b.id, true, 'worth it');
    expect(changes).toBe(3);
    // a shortened clock: the sweep a day after expiry
    expect(await store.sweep(a.at + RETENTION_MS + 1)).toBe(1);
    expect(store.get(a.id)).toBeUndefined();
    await expect(fs.access(store.pathOf(a.id))).rejects.toThrow();
    expect(store.get(b.id)?.keepReason).toBe('worth it');
    await store.flush();
    const again = new FileStore(dir);
    await again.load();
    expect(again.list().map((f) => f.id)).toEqual([b.id]);
    expect(again.list()[0].expiresAt).toBeNull();
  });

  it('refuses an upload over the limit and leaves nothing behind', async () => {
    const store = new FileStore(dir);
    await expect(store.addStream(Readable.from([Buffer.alloc(10)]), { name: 'a.txt', type: '', from: 'manager' }, 5)).rejects.toMatchObject({ status: 413 });
    expect((await fs.readdir(dir)).filter((f) => f !== 'index.json')).toEqual([]);
  });
});

describe('routes', () => {
  let server: http.Server;
  let base: string;
  let store: FileStore;
  beforeEach(async () => {
    store = new FileStore(dir);
    await store.load();
    const app = express();
    app.use(fileRoutes(store, { max: 64 }));
    app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => void res.status(err instanceof HttpError ? err.status : 500).json({ error: (err as Error).message }));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  const upload = (body: string, name = 'a.png', type = 'image/png') => fetch(`${base}/api/files`, { method: 'POST', headers: { 'Content-Type': type, 'X-File-Name': encodeURIComponent(name) }, body });

  it('uploads and serves by id, images inline and other files as downloads', async () => {
    const res = await upload('png bytes');
    expect(res.status).toBe(200);
    const f = (await res.json()) as { id: string };
    const got = await fetch(`${base}/api/files/${f.id}`);
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('image/png');
    expect(got.headers.get('content-disposition')).toMatch(/^inline/);
    expect(await got.text()).toBe('png bytes');
    const md = (await (await upload('# hi', 'n.md', 'text/markdown')).json()) as { id: string };
    expect((await fetch(`${base}/api/files/${md.id}`)).headers.get('content-disposition')).toMatch(/^attachment/);
  });

  it('answers 404 for an unknown id and 400 for path-like ones', async () => {
    expect((await fetch(`${base}/api/files/0123456789abcdef01234567`)).status).toBe(404);
    expect((await fetch(`${base}/api/files/..%2F..%2Fstate.json`)).status).toBe(400);
    expect((await fetch(`${base}/api/files/index.json`)).status).toBe(400);
  });

  it('refuses an oversize upload with 413', async () => {
    const res = await upload('x'.repeat(65));
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toMatch(/at most/);
  });

  it('keeps and deletes', async () => {
    const f = (await (await upload('x')).json()) as { id: string };
    await fetch(`${base}/api/files/${f.id}/keep`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"keep":true}' });
    expect(store.get(f.id)?.keep).toBe(true);
    expect((await fetch(`${base}/api/files/${f.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await fetch(`${base}/api/files/${f.id}`)).status).toBe(404);
  });
});
