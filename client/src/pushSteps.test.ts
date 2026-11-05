import { describe, expect, it, vi } from 'vitest';
import { askPermission, ensureWorker, fromB64u, StepError, subscribe, type WorkerContainer } from './pushSteps';

/** A push manager that, like Safari's, only subscribes while the tap that asked is being handled. */
function safariPush() {
  const gesture = { on: false };
  const calls: unknown[] = [];
  const sub = (key: Uint8Array) =>
    ({ endpoint: 'https://web.push.apple.com/abc', options: { applicationServerKey: key.buffer }, toJSON: () => ({ endpoint: 'https://web.push.apple.com/abc' }), unsubscribe: vi.fn(async () => true) }) as unknown as PushSubscription;
  const reg = {
    pushManager: {
      subscribe: (opts: { applicationServerKey: Uint8Array }) => {
        calls.push(opts);
        return gesture.on ? Promise.resolve(sub(opts.applicationServerKey)) : Promise.reject(Object.assign(new Error('Subscribing for push requires a user gesture'), { name: 'NotAllowedError' }));
      },
    },
  } as unknown as ServiceWorkerRegistration;
  /** Runs `fn` as a tap's handler: the gesture lasts for its synchronous part only. */
  const tap = <T>(fn: () => Promise<T>) => {
    gesture.on = true;
    try {
      return fn();
    } finally {
      gesture.on = false;
    }
  };
  return { reg, tap, calls, sub };
}

const KEY = new Uint8Array(65).fill(4);

describe('signing up for push', () => {
  it('subscribes within the tap, before anything else is awaited', async () => {
    const { reg, tap } = safariPush();
    const saved: unknown[] = [];
    const sub = await tap(() => subscribe(reg, KEY, null, async (s) => saved.push(s)));
    expect(sub.endpoint).toBe('https://web.push.apple.com/abc');
    expect(saved).toEqual([{ endpoint: 'https://web.push.apple.com/abc' }]);
  });

  it('fails on Safari when permission, the worker and the key are awaited first in the same tap (the old sign-up)', async () => {
    const { reg, tap } = safariPush();
    const old = async () => {
      await askPermission(async () => 'granted');
      await Promise.resolve(reg); // navigator.serviceWorker.ready
      await new Promise((r) => setTimeout(r, 5)); // GET /api/notify/push/key
      return subscribe(reg, KEY, null, async () => undefined);
    };
    await expect(tap(old)).rejects.toMatchObject({ step: 'subscribe', message: expect.stringMatching(/refused.*NotAllowedError.*Tap the button again/) });
  });

  it('keeps a subscription made with the same key and replaces one made with another', async () => {
    const { reg, tap, calls, sub } = safariPush();
    const same = sub(KEY);
    expect(await tap(() => subscribe(reg, KEY, same, async () => undefined))).toBe(same);
    expect(calls).toHaveLength(0);
    const other = sub(new Uint8Array(65).fill(9));
    (reg.pushManager as unknown as { subscribe: unknown }).subscribe = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('different applicationServerKey'), { name: 'InvalidStateError' }))
      .mockResolvedValueOnce(sub(KEY));
    await subscribe(reg, KEY, other, async () => undefined);
    expect(other.unsubscribe).toHaveBeenCalled();
  });

  it("says when the office didn't save the device", async () => {
    const { reg, tap } = safariPush();
    const err = await tap(() => subscribe(reg, KEY, null, async () => Promise.reject(new Error('413 Payload Too Large')))).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StepError);
    expect(err).toMatchObject({ step: 'save', message: "This device signed up, but the office didn't save it: 413 Payload Too Large" });
  });

  it('says when notifications are blocked', async () => {
    await expect(askPermission(async () => 'denied')).rejects.toMatchObject({ step: 'permission', message: /blocked/ });
    expect(await askPermission(async () => 'granted')).toBe('granted');
  });

  it('reads the key', () => {
    expect([...fromB64u('AAEC-_8')]).toEqual([0, 1, 2, 251, 255]);
  });
});

/** A worker that changes state when told to. */
function worker(state: ServiceWorkerState) {
  const listeners: (() => void)[] = [];
  const w = { state, addEventListener: (_: string, fn: () => void) => listeners.push(fn) };
  return { w: w as unknown as ServiceWorker, become: (s: ServiceWorkerState) => ((w.state = s), listeners.forEach((fn) => fn())) };
}

describe('the service worker step', () => {
  it('registers the worker when the page has none and waits for it to activate', async () => {
    const installing = worker('installing');
    const reg = { active: null, installing: installing.w, waiting: null } as unknown as ServiceWorkerRegistration;
    const sw: WorkerContainer = { getRegistration: async () => undefined, register: vi.fn(async () => reg) };
    const ready = ensureWorker(sw);
    await Promise.resolve();
    await Promise.resolve();
    installing.become('activated');
    expect(await ready).toBe(reg);
    expect(sw.register).toHaveBeenCalledWith('/sw.js', { updateViaCache: 'none' });
  });

  it("gives up instead of waiting forever when it doesn't start (navigator.serviceWorker.ready never resolves then)", async () => {
    vi.useFakeTimers();
    const reg = { active: null, installing: worker('installing').w, waiting: null } as unknown as ServiceWorkerRegistration;
    const ready = ensureWorker({ getRegistration: async () => reg, register: async () => reg }, 10_000).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await ready).toMatchObject({ step: 'worker', message: "The service worker didn't start within 10 seconds. Reload the page and try again." });
    vi.useRealTimers();
  });

  it('says when it failed to install, or could not be registered', async () => {
    const broken = worker('installing');
    const reg = { active: null, installing: broken.w, waiting: null } as unknown as ServiceWorkerRegistration;
    const ready = ensureWorker({ getRegistration: async () => reg, register: async () => reg });
    await Promise.resolve();
    broken.become('redundant');
    await expect(ready).rejects.toMatchObject({ step: 'worker', message: /failed to install/ });
    await expect(ensureWorker({ getRegistration: async () => undefined, register: async () => Promise.reject(new TypeError('bad MIME type')) })).rejects.toMatchObject({
      message: "The service worker couldn't be registered: TypeError: bad MIME type",
    });
  });
});
