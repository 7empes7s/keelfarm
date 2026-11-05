// Sending the manager's messages to the CEO: each waits in the store's outbox (sending) until the office's copy
// arrives, or stays there as failed, with its text, until the manager retries it.

import { api } from '../api';
import { useStore } from '../store';
import { nextDelivery, type OutgoingMessage } from '../../../shared/chat';
import type { FileRef } from '../../../shared/files';

let seq = 0;

const update = (key: number, ev: 'failed' | 'retry') =>
  useStore.setState((s) => ({ chatOutbox: s.chatOutbox.map((o) => (o.key === key ? { ...o, delivery: nextDelivery(o.delivery, ev) as OutgoingMessage['delivery'] } : o)) }));

async function post(o: OutgoingMessage) {
  try {
    await api.messageCeo(o.text, o.replyTo, o.files?.map((f) => f.id));
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
  const o: OutgoingMessage = { key: ++seq, text: body, ...(replyTo !== undefined && { replyTo }), ...(files.length && { files }), at: Date.now(), delivery: 'sending' };
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
