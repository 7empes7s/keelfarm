// The manager's attachments while they write a message to the CEO: each file uploads to the office's files store as
// soon as it's picked, pasted or dropped (with progress, cancellable), and the message carries the uploaded ids.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { attachmentProblem, inlineType, type FileRef } from '../../../shared/files';

/** One file in the tray above the message box. */
export interface Pending {
  key: number;
  name: string;
  type: string;
  size: number;
  preview: string | null; // an object URL for images the browser can show
  progress: number; // 0..1
  ref?: FileRef; // uploaded
  error?: string;
}

/** POSTs a file's bytes to the store; `abort` cancels it. */
export function uploadFile(file: File, onProgress: (fraction: number) => void): { done: Promise<FileRef>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const done = new Promise<FileRef>((resolve, reject) => {
    xhr.open('POST', '/api/files');
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data: { error?: string } & Partial<FileRef> = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // not JSON: the status says enough
      }
      if (xhr.status >= 200 && xhr.status < 300 && data.id) resolve(data as FileRef);
      else reject(new Error(data.error ?? (xhr.status === 413 ? 'That file is too big' : `Upload failed (${xhr.status})`)));
    };
    xhr.onerror = () => reject(new Error('Upload failed: the office could not be reached'));
    xhr.onabort = () => reject(new DOMException('Cancelled', 'AbortError'));
    xhr.send(file);
  });
  return { done, abort: () => xhr.abort() };
}

let seq = 0;

/** The tray's files and what to do with them. */
export function useAttachments() {
  const [pending, setPending] = useState<Pending[]>([]);
  const aborts = useRef(new Map<number, () => void>());
  const patch = (key: number, p: Partial<Pending>) => setPending((all) => all.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const latest = useRef(pending);
  latest.current = pending;

  const add = useCallback((files: readonly File[]) => {
    if (!files.length) return;
    const problem = attachmentProblem(files, latest.current.length);
    if (problem) return void useStore.getState().pushToast('error', problem);
    for (const file of files) {
      const key = ++seq;
      const showable = /^image\//.test(file.type) && inlineType(file.type) && !/hei[cf]/.test(file.type);
      setPending((all) => [...all, { key, name: file.name || 'file', type: file.type, size: file.size, preview: showable ? URL.createObjectURL(file) : null, progress: 0 }]);
      const up = uploadFile(file, (progress) => patch(key, { progress }));
      aborts.current.set(key, up.abort);
      up.done.then(
        (ref) => patch(key, { ref, progress: 1 }),
        (err: Error) => err.name !== 'AbortError' && patch(key, { error: err.message }),
      ).finally(() => aborts.current.delete(key));
    }
  }, []);

  /** Takes a file off the tray: cancels its upload, or deletes what was already uploaded. */
  const remove = useCallback((key: number) => {
    const p = latest.current.find((x) => x.key === key);
    aborts.current.get(key)?.();
    if (p?.ref) void api.deleteFile(p.ref.id, false).catch(() => undefined);
    if (p?.preview) URL.revokeObjectURL(p.preview);
    setPending((all) => all.filter((x) => x.key !== key));
  }, []);

  /** Empties the tray once the message took the files. */
  const clear = useCallback(() => {
    for (const p of latest.current) if (p.preview) URL.revokeObjectURL(p.preview);
    setPending([]);
  }, []);

  useEffect(() => () => aborts.current.forEach((abort) => abort()), []);

  const ready = pending.flatMap((p) => (p.ref ? [p.ref] : []));
  const busy = pending.some((p) => !p.ref && !p.error);
  const failed = pending.some((p) => p.error);
  return { pending, add, remove, clear, ready, busy, failed };
}
