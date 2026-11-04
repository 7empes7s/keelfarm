// Web Push sign-up, one step per tap (docs/pocket.md), on the browser's objects passed in so tests can fake them.
// Safari only lets a page subscribe while it handles the tap that asked for it (WebKit forwards a tap's "user gesture"
// for about a second), so `subscribe` calls pushManager.subscribe first, with the office's key fetched beforehand,
// and asking for permission is a tap of its own. Every step throws a StepError that says where it stopped.

/** Where a sign-up stopped, for the settings and the server's log. */
export class StepError extends Error {
  constructor(
    readonly step: 'worker' | 'permission' | 'subscribe' | 'save',
    message: string,
  ) {
    super(message);
  }
}

const reason = (err: unknown) => (err instanceof Error ? `${err.name !== 'Error' ? `${err.name}: ` : ''}${err.message}` : String(err));

/** The parts of navigator.serviceWorker the steps use. */
export interface WorkerContainer {
  getRegistration(): Promise<ServiceWorkerRegistration | undefined>;
  register(url: string, options?: RegistrationOptions): Promise<ServiceWorkerRegistration>;
}

/** This page's worker registration, registered now if there's none, once it has an active worker. Never waits forever. */
export async function ensureWorker(sw: WorkerContainer, timeoutMs = 10_000): Promise<ServiceWorkerRegistration> {
  let reg: ServiceWorkerRegistration | undefined;
  try {
    reg = (await sw.getRegistration()) ?? (await sw.register('/sw.js', { updateViaCache: 'none' }));
  } catch (err) {
    throw new StepError('worker', `The service worker couldn't be registered: ${reason(err)}`);
  }
  if (reg.active) return reg;
  const worker = reg.installing ?? reg.waiting;
  if (!worker) throw new StepError('worker', 'The service worker has no worker installing. Reload the page and try again.');
  const r = reg;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new StepError('worker', `The service worker didn't start within ${Math.round(timeoutMs / 1000)} seconds. Reload the page and try again.`)), timeoutMs);
    const check = () => {
      if (worker.state === 'activated' || r.active) {
        clearTimeout(timer);
        resolve(r);
      } else if (worker.state === 'redundant') {
        clearTimeout(timer);
        reject(new StepError('worker', "The service worker failed to install (the office's app files didn't load). Reload the page and try again."));
      }
    };
    worker.addEventListener('statechange', check);
    check();
  });
}

/** Asks to show notifications. Call it straight from a tap. */
export async function askPermission(request: () => Promise<NotificationPermission>): Promise<NotificationPermission> {
  let p: NotificationPermission;
  try {
    p = await request();
  } catch (err) {
    throw new StepError('permission', `The browser didn't ask: ${reason(err)}`);
  }
  if (p === 'denied') throw new StepError('permission', 'Notifications are blocked for the office in this browser.');
  return p;
}

const sameKey = (sub: PushSubscription, key: Uint8Array) => {
  const k = sub.options.applicationServerKey;
  return !!k && k.byteLength === key.length && new Uint8Array(k).every((b, i) => b === key[i]);
};

/**
 * Subscribes this browser with the office's `key` and hands the subscription to `save` (the office). Call it straight
 * from a tap: pushManager.subscribe runs before anything else is awaited. `existing` is this browser's current
 * subscription, looked up before the tap; one made for another key is replaced after subscribing fails on it.
 */
export async function subscribe(reg: ServiceWorkerRegistration, key: Uint8Array, existing: PushSubscription | null, save: (sub: PushSubscriptionJSON) => Promise<unknown>): Promise<PushSubscription> {
  let sub: PushSubscription;
  try {
    if (existing && sameKey(existing, key)) sub = existing;
    else {
      const first = reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource });
      sub = await first.catch(async (err: unknown) => {
        if (!existing) throw err;
        // Made for another office's key: a browser keeps one subscription, so it goes first.
        await existing.unsubscribe();
        return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource });
      });
    }
  } catch (err) {
    const why = reason(err);
    throw new StepError(
      'subscribe',
      /NotAllowed|gesture/i.test(why) ? `The browser refused to sign up (${why}). Tap the button again.` : `The browser couldn't sign up with its push service: ${why}`,
    );
  }
  try {
    await save(sub.toJSON());
  } catch (err) {
    throw new StepError('save', `This device signed up, but the office didn't save it: ${reason(err)}`);
  }
  return sub;
}

/** "AAEC-_w" (base64url) as bytes. */
export const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
