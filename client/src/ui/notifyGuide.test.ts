import { describe, expect, it } from 'vitest';
import { deviceLabel, guideSteps, nextStep, platformOf, secureOrigin, suggestOfficeUrl, type GuideInput } from './notifyGuide';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const PIXEL = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const WIN_EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';

const tailnet = { protocol: 'https:', hostname: 'office.tail1234.ts.net', href: 'https://office.tail1234.ts.net/?pocket=1' };

/** Everything green on an Android phone; each test changes what it's about. */
const green: GuideInput = {
  location: tailnet,
  officeUrl: 'https://office.tail1234.ts.net/',
  platform: 'android',
  standalone: false,
  pushApi: true,
  permission: 'granted',
  worker: 'active',
  workerError: '',
  subscribed: true,
  known: true,
  devices: 2,
  test: { outcome: 'delivered', message: 'The push service accepted it (HTTP 201).' },
  arrived: true,
};

const states = (i: GuideInput) => guideSteps(i).map((s) => `${s.id}:${s.state}`);

describe('the notification checklist', () => {
  it('is all green when every step is done', () => {
    expect(states(green)).toEqual(['https:done', 'permission:done', 'worker:done', 'device:done', 'test:done']);
    expect(nextStep(guideSteps(green))).toBeNull();
  });

  it('sends a plain-http page to the HTTPS office address, and everything else waits', () => {
    const steps = guideSteps({ ...green, location: { protocol: 'http:', hostname: '192.168.1.20', href: 'http://192.168.1.20:4317/' }, permission: 'default', worker: 'none', subscribed: false, known: false, test: null, arrived: null });
    expect(steps.map((s) => s.state)).toEqual(['todo', 'waiting', 'waiting', 'waiting', 'waiting']);
    expect(nextStep(steps)).toMatchObject({ id: 'https', detail: expect.stringContaining('Open the office at https://office.tail1234.ts.net/ instead'), action: { kind: 'open', href: 'https://office.tail1234.ts.net/' } });
    expect(steps.slice(1).every((s) => !s.action)).toBe(true);
    expect(steps.map((s) => s.title)).toEqual(['Open the office over HTTPS', 'Allow notifications', 'Start the background helper', 'Sign this device up', 'Send a test']);
    // Without an HTTPS office address it says how to get one, with no link.
    const bare = nextStep(guideSteps({ ...green, location: { protocol: 'http:', hostname: '192.168.1.20', href: '' }, officeUrl: 'http://192.168.1.20:4317/' }))!;
    expect(bare.detail).toMatch(/tailscale serve --bg 4317/);
    expect(bare.action).toBeUndefined();
  });

  it('counts localhost as secure', () => {
    expect(secureOrigin({ protocol: 'http:', hostname: 'localhost' })).toBe(true);
    expect(secureOrigin({ protocol: 'http:', hostname: '127.0.0.1' })).toBe(true);
    expect(secureOrigin({ protocol: 'http:', hostname: 'office.local' })).toBe(false);
    expect(guideSteps({ ...green, location: { protocol: 'http:', hostname: 'localhost', href: '' } })[0]).toMatchObject({ state: 'done', detail: expect.stringMatching(/localhost/) });
  });

  it('asks an iPhone in Safari to add the office to the home screen first', () => {
    const steps = guideSteps({ ...green, platform: 'ios', standalone: false, pushApi: false, permission: 'unsupported', worker: 'active', subscribed: false, known: false, test: null, arrived: null });
    expect(steps.map((s) => `${s.id}:${s.state}`)).toEqual(['https:done', 'homeScreen:todo', 'permission:waiting', 'worker:done', 'device:waiting', 'test:waiting']);
    expect(nextStep(steps)!.how).toEqual(expect.arrayContaining([expect.stringMatching(/Share/), expect.stringMatching(/Add to Home Screen/), expect.stringMatching(/from your home screen/)]));
    expect(states({ ...green, platform: 'ios', standalone: true })).toEqual(['https:done', 'homeScreen:done', 'permission:done', 'worker:done', 'device:done', 'test:done']);
    expect(states(green)).not.toContain('homeScreen:done'); // only iPhones have the step
  });

  it('asks for permission, or says how to unblock it', () => {
    const ask = nextStep(guideSteps({ ...green, permission: 'default', subscribed: false, known: false }))!;
    expect(ask).toMatchObject({ id: 'permission', action: { kind: 'allow', label: 'Allow notifications' } });
    const denied = nextStep(guideSteps({ ...green, permission: 'denied' }))!;
    expect(denied).toMatchObject({ id: 'permission', title: 'Notifications are blocked', action: { kind: 'reload' } });
    expect(denied.how!.join(' ')).toMatch(/Site settings/);
    expect(nextStep(guideSteps({ ...green, platform: 'ios', standalone: true, permission: 'denied' }))!.how!.join(' ')).toMatch(/Settings app.*cubefarm/);
    expect(nextStep(guideSteps({ ...green, platform: 'desktop', permission: 'denied' }))!.how!.join(' ')).toMatch(/left of the address bar/);
    expect(nextStep(guideSteps({ ...green, pushApi: false, permission: 'unsupported' }))).toMatchObject({ id: 'permission', title: "This browser can't get notifications" });
  });

  it('starts the service worker, and says why it failed', () => {
    expect(nextStep(guideSteps({ ...green, worker: 'none' }))).toMatchObject({ id: 'worker', action: { kind: 'worker' } });
    expect(nextStep(guideSteps({ ...green, worker: 'failed', workerError: "The service worker didn't start within 10 seconds." }))).toMatchObject({ detail: "The service worker didn't start within 10 seconds.", action: { label: 'Try again' } });
    expect(nextStep(guideSteps({ ...green, worker: 'dev' }))!.action).toBeUndefined();
  });

  it("signs the device up, or again when the office doesn't have it", () => {
    expect(nextStep(guideSteps({ ...green, subscribed: false, known: false, devices: 0 }))).toMatchObject({ id: 'device', detail: expect.stringContaining('0 devices signed up'), action: { kind: 'subscribe', label: 'Turn on push for this device' } });
    expect(nextStep(guideSteps({ ...green, subscribed: true, known: false, devices: 1 }))).toMatchObject({ title: "The office doesn't have this device", detail: expect.stringContaining('1 device signed up'), action: { label: 'Sign this device up again' } });
  });

  it('sends a test, shows what the push service said and asks whether it arrived', () => {
    expect(nextStep(guideSteps({ ...green, test: null, arrived: null }))).toMatchObject({ id: 'test', action: { kind: 'test', label: 'Send a test' } });
    expect(nextStep(guideSteps({ ...green, arrived: null }))).toMatchObject({ title: 'Did it arrive?', detail: 'The push service accepted it (HTTP 201).' });
    expect(nextStep(guideSteps({ ...green, arrived: false }))).toMatchObject({ title: "The test didn't show", action: { label: 'Send another test' } });
    expect(nextStep(guideSteps({ ...green, test: { outcome: 'expired', message: 'expired (HTTP 410)' }, arrived: null }))).toMatchObject({ title: 'This sign-up expired', action: { kind: 'subscribe' } });
    expect(nextStep(guideSteps({ ...green, test: { outcome: 'error', message: "It didn't go out: Push answered HTTP 500." }, arrived: null }))).toMatchObject({ detail: "It didn't go out: Push answered HTTP 500." });
  });
});

describe('the device', () => {
  it('is told apart by its user agent', () => {
    expect(platformOf(IPHONE)).toBe('ios');
    expect(platformOf(IPAD, 5)).toBe('ios');
    expect(platformOf(IPAD, 0)).toBe('desktop');
    expect(platformOf(PIXEL)).toBe('android');
    expect([deviceLabel(IPHONE), deviceLabel(IPAD, 5), deviceLabel(PIXEL), deviceLabel(WIN_EDGE)]).toEqual(['iPhone', 'iPad', 'Android · Chrome', 'Windows · Edge']);
  });
});

describe('the office address for links', () => {
  it('is suggested from an HTTPS page when it is empty', () => {
    expect(suggestOfficeUrl({ ...tailnet, origin: 'https://office.tail1234.ts.net' }, '')).toBe('https://office.tail1234.ts.net/');
    expect(suggestOfficeUrl({ ...tailnet, origin: 'https://office.tail1234.ts.net' }, 'https://other/')).toBeNull();
    expect(suggestOfficeUrl({ protocol: 'http:', hostname: 'localhost', origin: 'http://localhost:4317' }, '')).toBeNull();
    expect(suggestOfficeUrl({ protocol: 'https:', hostname: 'localhost', origin: 'https://localhost:4317' }, '')).toBeNull();
  });
});
