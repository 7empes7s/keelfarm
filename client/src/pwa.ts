// The installable app (docs/pocket.md): the service worker the office serves at /sw.js (server/pwa.ts), and Web Push
// for this device. Push needs a secure context: HTTPS, or localhost on the office's own PC.
import { api } from './api';
import { askPermission, ensureWorker, fromB64u, StepError, subscribe } from './pushSteps';
import { mountOf } from './socketUrl';

/**
 * Registers the worker in a built office (the dev server has none). A new office version waits for clientUpdate.ts. Not
 * in an office seen through another's preview gateway: its /sw.js is that office's, and the preview worker runs it.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext || mountOf(location.pathname)) return;
  navigator.serviceWorker
    .register('/sw.js', { updateViaCache: 'none' })
    // a version left waiting by an earlier page takes over now: this page just loaded, so nothing is lost (#216)
    .then((reg) => reg.waiting?.postMessage({ type: 'skipWaiting' }))
    .catch((err: unknown) => {
      console.warn('no service worker:', err);
      void api.pushReport('worker', `The service worker couldn't be registered: ${err instanceof Error ? err.message : String(err)}`).catch(() => undefined);
    });
  // A tapped notification asks the open office to show what it's about.
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent<{ type?: string; url?: string }>) => {
    if (e.data?.type === 'cubefarm:open') window.dispatchEvent(new CustomEvent('cubefarm:open', { detail: e.data.url }));
  });
}

/** ok, or why this browser can't get push: no HTTPS, no Push API, or the dev server (no worker). */
export type PushSupport = 'ok' | 'insecure' | 'unsupported' | 'dev';

export function pushSupport(): PushSupport {
  if (!window.isSecureContext) return 'insecure';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') return 'unsupported';
  return import.meta.env.PROD ? 'ok' : 'dev';
}

/** This device's push subscription, if it has one. */
export async function currentPush(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

/** The worker's state for the checklist, without starting it. */
export async function workerState(): Promise<'none' | 'starting' | 'active'> {
  const reg = await navigator.serviceWorker.getRegistration();
  return !reg ? 'none' : reg.active ? 'active' : 'starting';
}

/** A step failed: the office's log hears where and why, and the error goes on to the settings. */
async function reported<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const step = err instanceof StepError ? err.step : 'unknown';
    void api.pushReport(step, err instanceof Error ? err.message : String(err)).catch(() => undefined);
    throw err;
  }
}

/** Registers the worker if needed and waits (10 s at most) for it to run. */
export const startWorker = () => reported(() => ensureWorker(navigator.serviceWorker));

/** Asks to show notifications: a tap of its own, so the next tap can subscribe within its gesture (pushSteps.ts). */
export const allowNotifications = () => reported(() => askPermission(() => Notification.requestPermission()));

/** What the subscribe tap needs ready beforehand: the worker, the office's key and the current subscription. */
export interface PushPrep {
  reg: ServiceWorkerRegistration;
  key: Uint8Array;
  existing: PushSubscription | null;
}

export async function preparePush(): Promise<PushPrep | null> {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg?.active) return null;
  const [key, existing] = await Promise.all([api.pushKey().then((k) => fromB64u(k.publicKey)), reg.pushManager.getSubscription()]);
  return { reg, key, existing };
}

/** Subscribes this device and saves it on the office as `name`; call it straight from a tap. Returns its id there. */
export function enablePush(prep: PushPrep, name: string): Promise<string> {
  let id = '';
  return reported(() =>
    subscribe(prep.reg, prep.key, prep.existing, async (sub) => {
      id = (await api.pushSubscribe(sub, name)).id;
    }),
  ).then(() => id);
}

export async function disablePush(): Promise<void> {
  const sub = await currentPush();
  if (!sub) return;
  await api.pushUnsubscribe(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe();
}
