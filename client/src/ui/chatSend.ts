// Sending the manager's messages to the CEO: each waits in the store's outbox (sending) until the office's copy
// arrives, or stays there as failed, with its text, until the manager retries it. The outbox is on disk before a
// message leaves (#216): after a reload or a crash its unanswered sends go again once, and the office saves each
// client id once.

import { api } from '../api';
import { drafts } from '../drafts';
import { useStore } from '../store';
import { alreadySent, nextDelivery, type OutgoingMessage } from '../../../shared/chat';
import type { FileRef } from '../../../shared/files';

let seq = 0;
const OUTBOX_KEY = 'outbox';

/** A client id for a message: random, so two tabs or a reloaded one never collide. */
const newClientId = () => (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

/** The outbox on disk, as it is now. */
const saveOutbox = () => {
  const box = useStore.getState().chatOutbox;
  return drafts.put(OUTBOX_KEY, box.length ? box : null);
};

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
  void saveOutbox();
}

/** Sends a message to the CEO, as a reply to message `replyTo` if given, with files already uploaded. */
export function sendToCeo(text: string, replyTo?: number, files: FileRef[] = []) {
  const body = text.trim();
  if (!body && !files.length) return;
  const o: OutgoingMessage = { key: ++seq, clientId: newClientId(), text: body, ...(replyTo !== undefined && { replyTo }), ...(files.length && { files }), at: Date.now(), delivery: 'sending' };
  useStore.setState((s) => ({ chatOutbox: [...s.chatOutbox, o] }));
  void saveOutbox().then(() => post(o));
}

/** Sends a failed message again. */
export function retrySend(key: number) {
  const o = useStore.getState().chatOutbox.find((x) => x.key === key);
  if (!o || o.delivery !== 'failed') return;
  update(key, 'retry');
  void post({ ...o, delivery: 'sending' });
}

let resumed = false;

/**
 * Once, after the page's first snapshot: the sends a reload or a crash interrupted go again (shown as sending), unless
 * the office already has them; the failed ones wait for their retry as before.
 */
export async function resumeOutbox() {
  if (resumed) return;
  resumed = true;
  const saved = (await drafts.load<OutgoingMessage[]>(OUTBOX_KEY)) ?? [];
  const { messages, chatOutbox } = useStore.getState();
  const left = saved.filter((o) => !alreadySent(messages, o.clientId) && !chatOutbox.some((x) => x.clientId === o.clientId));
  const back = left.map((o) => ({ ...o, key: ++seq }));
  if (back.length) useStore.setState((s) => ({ chatOutbox: [...back, ...s.chatOutbox] }));
  void saveOutbox();
  for (const o of back) if (o.delivery === 'sending') void post(o);
}
