// The manager's attachments while they write a message to the CEO: each file uploads to the office's files store as
// soon as it's picked, pasted or dropped (with progress, cancellable, retried from the start after a drop), and the
// message carries the uploaded ids.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { attachmentProblem, inlineType, type FileRef } from '../../../shared/files';
import { readDraft, writeDraft } from '../drafts';
import { markBusy } from '../updateGate';

/** One file in the tray above the message box. */
export interface Pending {
  key: number;
  name: string;
  type: string;
  size: number;
  preview: string | null; // an object URL for images the browser can show
  progress: number; // 0..1
  loaded: number; // bytes sent
  startedAt: number; // this attempt, epoch ms
  ref?: FileRef; // uploaded
  error?: string;
}

/** POSTs a file's bytes to the store; `abort` cancels it. */
function uploadFile(file: File, onProgress: (loaded: number) => void): { done: Promise<FileRef>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const done = new Promise<FileRef>((resolve, reject) => {
    xhr.open('POST', '/api/files');
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
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

/** The tray's uploaded files saved with the draft, back in the tray. */
const restored = (draftKey?: string): Pending[] =>
  (draftKey ? (readDraft<FileRef[]>(`files:${draftKey}`) ?? []) : []).map((ref) => ({ key: ++seq, name: ref.name, type: ref.type, size: ref.size, preview: null, progress: 1, loaded: ref.size, startedAt: ref.at, ref }));

/** The tray's files and what to do with them; with a `draftKey`, the uploaded ones come back after a reload (#216). */
export function useAttachments(draftKey?: string) {
  const [pending, setPending] = useState<Pending[]>(() => restored(draftKey));
  const aborts = useRef(new Map<number, () => void>());
  const patch = (key: number, p: Partial<Pending>) => setPending((all) => all.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const latest = useRef(pending);
  latest.current = pending;

  const held = useRef(new Map<number, File>()); // for Retry

  /** Uploads (again) the file under `key`, from its first byte. */
  const send = useCallback((key: number) => {
    const file = held.current.get(key);
    if (!file) return;
    patch(key, { progress: 0, loaded: 0, startedAt: Date.now(), error: undefined });
    const up = uploadFile(file, (loaded) => patch(key, { loaded, progress: file.size ? loaded / file.size : 0 }));
    aborts.current.set(key, up.abort);
    up.done.then(
      (ref) => {
        held.current.delete(key);
        patch(key, { ref, progress: 1, loaded: file.size });
      },
      (err: Error) => err.name !== 'AbortError' && patch(key, { error: err.message }),
    ).finally(() => aborts.current.delete(key));
  }, []);

  const add = useCallback((files: readonly File[]) => {
    if (!files.length) return;
    const problem = attachmentProblem(files, latest.current.length);
    if (problem) {
      useStore.getState().pushToast('error', problem);
      return;
    }
    for (const file of files) {
      const key = ++seq;
      const showable = file.type.startsWith('image/') && inlineType(file.type) && !/hei[cf]/.test(file.type);
      held.current.set(key, file);
      setPending((all) => [...all, { key, name: file.name || 'file', type: file.type, size: file.size, preview: showable ? URL.createObjectURL(file) : null, progress: 0, loaded: 0, startedAt: Date.now() }]);
      send(key);
    }
  }, [send]);

  /** Takes a file off the tray: cancels its upload, or deletes what was already uploaded. */
  const remove = useCallback((key: number) => {
    const p = latest.current.find((x) => x.key === key);
    aborts.current.get(key)?.();
    held.current.delete(key);
    if (p?.ref) void api.deleteFile(p.ref.id, false).catch(() => undefined);
    if (p?.preview) URL.revokeObjectURL(p.preview);
    setPending((all) => all.filter((x) => x.key !== key));
  }, []);

  /** Empties the tray once the message took the files. */
  const clear = useCallback(() => {
    for (const p of latest.current) if (p.preview) URL.revokeObjectURL(p.preview);
    held.current.clear();
    setPending([]);
  }, []);

  useEffect(() => () => aborts.current.forEach((abort) => abort()), []);

  const ready = pending.flatMap((p) => (p.ref ? [p.ref] : []));
  const busy = pending.some((p) => !p.ref && !p.error);
  const saved = ready.map((r) => r.id).join();
  useEffect(() => {
    if (!draftKey) return;
    writeDraft(`files:${draftKey}`, latest.current.flatMap((p) => (p.ref ? [p.ref] : [])));
    markBusy(`files:${draftKey}`, 'draft', saved !== ''); // files in the tray are part of the message being written
    markBusy(`upload:${draftKey}`, 'uploading', busy);
    return () => {
      markBusy(`files:${draftKey}`, 'draft', false);
      markBusy(`upload:${draftKey}`, 'uploading', false);
    };
  }, [draftKey, saved, busy]);
  const failed = pending.some((p) => p.error);
  return { pending, add, remove, retry: send, clear, ready, busy, failed };
}
