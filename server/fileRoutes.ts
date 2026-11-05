// The files store's REST routes, by id only (server/files.ts): uploads from the manager's phone as a raw body (the
// name in X-File-Name), downloads, keep and delete. Served before the JSON body parser, so uploads stream to disk.

import express, { type NextFunction, type Request, type Response } from 'express';
import { formatSize, inlineType, isFileId, MAX_FILE_BYTES } from '../shared/files.ts';
import { HttpError } from './httpError.ts';
import type { FileStore } from './files.ts';

/** The id in the path: 400 for anything path-like, 404 for an id the store doesn't have. */
function known(store: FileStore, raw: string) {
  if (!isFileId(raw)) throw new HttpError(400, 'Not a file id');
  const f = store.get(raw);
  if (!f) throw new HttpError(404, 'That file is no longer saved');
  return f;
}

/** An RFC 6266 Content-Disposition with the name in both forms. */
export function disposition(kind: 'inline' | 'attachment', name: string) {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function fileRoutes(store: FileStore, opts: { max?: number; onDeleted?: (id: string) => void } = {}) {
  const max = opts.max ?? MAX_FILE_BYTES;
  const r = express.Router();
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      const out = await fn(req, res);
      if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (err) {
      next(err);
    }
  };

  r.post(
    '/api/files',
    wrap(async (req, res) => {
      const length = Number(req.headers['content-length'] ?? 0);
      if (length > max) {
        // Say so before reading a byte; the connection closes so the rest of the body isn't waited for.
        res.set('Connection', 'close');
        throw new HttpError(413, `That file is ${formatSize(length)}: files can be at most ${formatSize(max)}.`);
      }
      let name = 'file';
      try {
        name = decodeURIComponent(String(req.headers['x-file-name'] ?? 'file'));
      } catch {
        // a malformed name: keep the default
      }
      try {
        return await store.addStream(req, { name, type: String(req.headers['content-type'] ?? ''), from: 'manager' }, max);
      } catch (err) {
        if (err instanceof HttpError && err.status === 413) res.set('Connection', 'close');
        throw err;
      }
    }),
  );

  r.get(
    '/api/files/:id',
    wrap((req, res) => {
      const f = known(store, String(req.params.id));
      const inline = inlineType(f.type) && req.query.download === undefined;
      res.set({
        'Content-Type': f.type,
        'Content-Disposition': disposition(inline ? 'inline' : 'attachment', f.name),
        'X-Content-Type-Options': 'nosniff',
        // Chrome's PDF viewer doesn't run in a sandboxed document; everything else gets no script at all.
        ...(f.type !== 'application/pdf' && { 'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox" }),
        'Cache-Control': 'private, max-age=86400',
      });
      // dotfiles: the store lives under ~/.cubefarm
      return new Promise<void>((resolve, reject) => res.sendFile(store.pathOf(f.id), { cacheControl: false, dotfiles: 'allow' }, (err) => (err && !res.headersSent ? reject(new HttpError(404, 'That file is no longer saved')) : resolve())));
    }),
  );

  r.post(
    '/api/files/:id/keep',
    express.json({ limit: '4kb' }),
    wrap((req) => {
      const f = known(store, String(req.params.id));
      store.setKeep(f.id, req.body?.keep === true, 'Kept by the manager');
      return { ok: true };
    }),
  );

  r.delete(
    '/api/files/:id',
    wrap(async (req) => {
      const f = known(store, String(req.params.id));
      await store.remove(f.id);
      opts.onDeleted?.(f.id);
      return { ok: true };
    }),
  );

  return r;
}
