import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { serviceWorkerSource, swVersion } from './pwa.ts';

describe('the service worker version', () => {
  it('changes with every office update: a new build, a new package version or a new commit', () => {
    const v = swVersion('<html>a</html>', '0.3.14', 'abc1234');
    expect(v).toMatch(/^[0-9a-f]{12}$/);
    expect(swVersion('<html>a</html>', '0.3.14', 'abc1234')).toBe(v);
    expect(swVersion('<html>b</html>', '0.3.14', 'abc1234')).not.toBe(v);
    expect(swVersion('<html>a</html>', '0.3.15', 'abc1234')).not.toBe(v);
    expect(swVersion('<html>a</html>', '0.3.14', 'def5678')).not.toBe(v);
    expect(swVersion('<html>a</html>', '0.3.14', null)).not.toBe(v);
  });
});

/** Runs the worker in a sandbox and returns its fetch handler, which reports what it would do with a request. */
function fetchHandler() {
  const handlers: Record<string, (e: unknown) => void> = {};
  const self = { addEventListener: (type: string, fn: (e: unknown) => void) => (handlers[type] = fn), location: { origin: 'https://office.example' } };
  const caches = { match: async () => undefined, has: async () => true, open: async () => ({ put: async () => undefined, match: async () => undefined }) };
  vm.runInNewContext(serviceWorkerSource('v1'), { self, URL, caches, fetch: () => new Promise(() => undefined), Response: { error: () => null } });
  return (url: string, init: { method?: string; mode?: string } = {}) => {
    let handled = false;
    handlers.fetch({ request: { url, method: init.method ?? 'GET', mode: init.mode ?? 'cors' }, respondWith: () => (handled = true), waitUntil: () => undefined });
    return handled;
  };
}

describe('the service worker', () => {
  it('names its cache by version, so an update drops the old one', () => {
    const src = serviceWorkerSource('0123456789ab');
    expect(src).toContain('const VERSION = "0123456789ab";');
    expect(src).toContain("k.startsWith('cubefarm-shell-') && k !== CACHE");
    expect(() => new vm.Script(src)).not.toThrow();
  });

  it('caches only the app shell: never the API, the websockets or anything else', () => {
    const handles = fetchHandler();
    expect(handles('https://office.example/', { mode: 'navigate' })).toBe(true);
    expect(handles('https://office.example/assets/index-abc123.js')).toBe(true);
    expect(handles('https://office.example/icons/icon-192.png')).toBe(true);
    expect(handles('https://office.example/manifest.webmanifest')).toBe(true);
    expect(handles('https://office.example/api/state')).toBe(false);
    expect(handles('https://office.example/api/voice/messages/3?cached=1')).toBe(false);
    expect(handles('https://office.example/api/agents/a1/screen')).toBe(false);
    expect(handles('https://office.example/ws')).toBe(false);
    expect(handles('https://office.example/sw.js')).toBe(false);
    expect(handles('https://office.example/assets/index-abc123.js', { method: 'POST' })).toBe(false);
    expect(handles('https://fonts.googleapis.com/css2?family=Fredoka')).toBe(false);
  });
});

describe('a bundle answered with the page (#650)', () => {
  /** What the worker keeps for a bundle whose network answer has this Content-Type. */
  async function kept(type: string) {
    const handlers: Record<string, (e: unknown) => void> = {};
    const put: string[] = [];
    const self = { addEventListener: (t: string, fn: (e: unknown) => void) => (handlers[t] = fn), location: { origin: 'https://office.example' } };
    const caches = { match: async () => undefined, has: async () => true, open: async () => ({ put: async (req: { url: string }) => void put.push(req.url) }) };
    const res = { ok: true, headers: new Map([['content-type', type]]), clone: () => res };
    vm.runInNewContext(serviceWorkerSource('v1'), { self, URL, caches, fetch: async () => res, Response: { error: () => null } });
    const waits: Promise<unknown>[] = [];
    let answer: Promise<unknown> = Promise.resolve();
    handlers.fetch({ request: { url: 'https://office.example/assets/agentCallEngine-old.js', method: 'GET', mode: 'cors' }, respondWith: (p: Promise<unknown>) => (answer = p), waitUntil: (p: Promise<unknown>) => void waits.push(p) });
    await answer;
    await Promise.all(waits);
    return put;
  }

  it('is never kept as that bundle; a real one is', async () => {
    expect(await kept('text/html; charset=utf-8')).toEqual([]);
    expect(await kept('text/javascript; charset=utf-8')).toEqual(['https://office.example/assets/agentCallEngine-old.js']);
  });
});

/** Runs the worker's push handler with these office windows open; returns the notifications it shows and closes. */
async function push(data: object, windows: { visibilityState: string; focused: boolean }[], showing: string[] = []) {
  const handlers: Record<string, (e: unknown) => void> = {};
  const shown: { title: string; tag: string }[] = [];
  const closed: string[] = [];
  const registration = {
    showNotification: async (title: string, o: { tag: string }) => void shown.push({ title, tag: o.tag }),
    getNotifications: async ({ tag }: { tag: string }) => showing.filter((t) => t === tag).map((t) => ({ close: () => closed.push(t) })),
  };
  const self = { addEventListener: (type: string, fn: (e: unknown) => void) => (handlers[type] = fn), location: { origin: 'https://office.example' }, registration, clients: { matchAll: async () => windows } };
  vm.runInNewContext(serviceWorkerSource('v1'), { self, URL, caches: {}, fetch: () => undefined, Response: {} });
  let done: Promise<unknown> = Promise.resolve();
  handlers.push({ data: { json: () => data }, waitUntil: (p: Promise<unknown>) => (done = p) });
  await done;
  return { shown, closed };
}

describe('push in the service worker (#210)', () => {
  const note = { title: '💬 Mimoun: 3 new messages', body: 'Latest', tag: 'cubefarm-ceoMessage', url: '/?tab=chat' };

  it('shows a push with its thread tag, unless an office window here is on screen and focused', async () => {
    expect((await push(note, [])).shown).toEqual([{ title: note.title, tag: 'cubefarm-ceoMessage' }]);
    expect((await push(note, [{ visibilityState: 'hidden', focused: false }])).shown).toHaveLength(1);
    expect((await push(note, [{ visibilityState: 'visible', focused: false }])).shown).toHaveLength(1);
    expect((await push(note, [{ visibilityState: 'hidden', focused: false }, { visibilityState: 'visible', focused: true }])).shown).toEqual([]);
  });

  it("closes a thread's notification when it was read on another device, and shows nothing for it", async () => {
    const r = await push({ type: 'clear', tag: 'cubefarm-ceoMessage' }, [], ['cubefarm-ceoMessage', 'cubefarm-merge']);
    expect(r).toEqual({ shown: [], closed: ['cubefarm-ceoMessage'] });
  });
});

it('routes an approval click to the exact card in an existing window or a newly opened office', async () => {
  for (const existing of [true, false]) {
    const handlers: Record<string, (e: unknown) => void> = {};
    const opened: string[] = [], messages: unknown[] = [];
    let focused = false, closed = false;
    const url = 'https://office.example/?tab=approvals&note=it-abc-1';
    const self = {
      addEventListener: (type: string, fn: (e: unknown) => void) => (handlers[type] = fn),
      location: { origin: 'https://office.example' },
      clients: {
        matchAll: async () => existing ? [{ url: 'https://office.example/', postMessage: (m: unknown) => messages.push(m), focus: async () => { focused = true; } }] : [],
        openWindow: async (u: string) => { opened.push(u); },
      },
    };
    vm.runInNewContext(serviceWorkerSource('test'), { self, URL });
    let done: Promise<unknown> | undefined;
    handlers.notificationclick({ notification: { data: { url }, close: () => { closed = true; } }, waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;
    expect(closed).toBe(true);
    expect(opened).toEqual(existing ? [] : [url]);
    expect(messages).toEqual(existing ? [{ type: 'cubefarm:open', url }] : []);
    expect(focused).toBe(existing);
  }
});
