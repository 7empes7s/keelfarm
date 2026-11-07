// Sending the manager's messages to the CEO: each waits in the store's outbox (sending) until the office's copy
// arrives, or stays there as failed, with its text, until the manager retries it. The outbox is saved as it changes
// (#216): after a reload or crash, what the office didn't get comes back, and sends cut off go again once, under the
// same client id so the office takes each once.

import { api } from '../api';
import { useStore } from '../store';
import { nextDelivery, restoreOutbox, type OutgoingMessage } from '../../../shared/chat';
import { readDraft, writeDraft } from '../drafts';
import type { FileRef } from '../../../shared/files';

let seq = 0;

const update = (key: number, ev: 'failed' | 'retry') =>
  useStore.setState((s) => ({ chatOutbox: s.chatOutbox.map((o) => (o.key === key ? { ...o, delivery: nextDelivery(o.delivery, ev) as OutgoingMessage['delivery'] } : o)) }));

async function post(o: OutgoingMessage) {
  try {
    await api.messageCeo(o.text, o.replyTo, o.files?.map((f) => f.id), o.clientId);
    // Usually the office's copy came first over the websocket and settled it; if not, it's in the office now.
    useStore.setState((s) => ({ chatOutbox: s.chatOutbox.filter((x) => x.key !== o.key) }));
  } catch {
    update(o.key, 'failed');
  }
}

/** Sends a message to the CEO, as a reply to message `replyTo` if given, with files already uploaded. */
export function sendToCeo(text: string, replyTo?: number, files: FileRef[] = []) {
  const body = text.trim();
  if (!body && !files.length) return;
  const o: OutgoingMessage = { key: ++seq, clientId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`, text: body, ...(replyTo !== undefined && { replyTo }), ...(files.length && { files }), at: Date.now(), delivery: 'sending' };
  useStore.setState((s) => ({ chatOutbox: [...s.chatOutbox, o] }));
  void post(o);
}

/** Sends a failed message again. */
export function retrySend(key: number) {
  const o = useStore.getState().chatOutbox.find((x) => x.key === key);
  if (!o || o.delivery !== 'failed') return;
  update(key, 'retry');
  void post({ ...o, delivery: 'sending' });
}

const OUTBOX_KEY = 'outbox';

/** Saves the outbox as it changes and, once the first snapshot is in, brings back what a reload or crash cut off. */
export function keepOutbox() {
  const saved = readDraft<OutgoingMessage[]>(OUTBOX_KEY) ?? [];
  let restored = !saved.length;
  useStore.subscribe((s, prev) => {
    if (!restored && s.loaded) {
      restored = true;
      const { outbox, resend } = restoreOutbox(saved, s.messages);
      seq = Math.max(seq, ...outbox.map((o) => o.key));
      useStore.setState({ chatOutbox: [...outbox, ...s.chatOutbox.filter((o) => !outbox.some((x) => x.key === o.key))] });
      for (const o of resend) void post(o);
      return;
    }
    if (s.chatOutbox !== prev.chatOutbox) writeDraft(OUTBOX_KEY, s.chatOutbox);
  });
}
