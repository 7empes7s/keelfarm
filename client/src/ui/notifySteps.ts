// "Get notified on this phone" (docs/pocket.md), the pure part: from what this browser and the office report, the
// checklist's steps, each done or with a plain-English fix, and the one the big button does next. NotifyGuide.tsx
// reads the browser and runs the steps (pwa.ts).

export type Platform = 'ios' | 'android' | 'desktop';
export type WorkerState = 'none' | 'starting' | 'active' | 'failed' | 'dev';
export type StepId = 'https' | 'homeScreen' | 'permission' | 'worker' | 'device' | 'test';
/** done: a green tick. todo: this needs doing (the first one is next). waiting: an earlier step comes first. */
export type StepState = 'done' | 'todo' | 'waiting';
/** What the big button does for a step: open the HTTPS address, or run one of pwa.ts's steps. */
export type StepAction = 'open' | 'allow' | 'worker' | 'subscribe' | 'test' | 'reload';

export interface GuideInput {
  location: { protocol: string; hostname: string; href: string };
  /** Settings → Office address for links ('' when unset). */
  officeUrl: string;
  platform: Platform;
  /** Opened as the installed home-screen app. */
  standalone: boolean;
  /** The browser has service workers, the Push API and notifications. */
  pushApi: boolean;
  permission: NotificationPermission | 'unsupported';
  worker: WorkerState;
  workerError: string;
  /** This browser has a push subscription (null: not looked yet). */
  subscribed: boolean | null;
  /** The office has this device's subscription saved. */
  known: boolean;
  devices: number;
  test: { outcome: 'delivered' | 'expired' | 'error'; message: string } | null;
  /** The manager's answer to "Did it arrive?" (null: not answered). */
  arrived: boolean | null;
}

export interface GuideStep {
  id: StepId;
  state: StepState;
  title: string;
  /** One line under the title: what's wrong and what to do, or what's fine. */
  detail: string;
  /** Numbered instructions for what the office can't do itself (Add to Home Screen, unblocking). */
  how?: string[];
  action?: { kind: StepAction; label: string; href?: string };
}

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/;

/** HTTPS, or localhost on the office's own PC: what service workers and push need. */
export const secureOrigin = (l: { protocol: string; hostname: string }) => l.protocol === 'https:' || LOOPBACK.test(l.hostname);

/** The phone or computer this is, from its user agent (iPads say "Macintosh" but have touch). */
export function platformOf(userAgent: string, maxTouchPoints = 0): Platform {
  if (/iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(userAgent)) return 'android';
  return 'desktop';
}

/** A device's default name in the channel list, e.g. "iPhone" or "Windows · Edge". */
export function deviceLabel(userAgent: string, maxTouchPoints = 0): string {
  const p = platformOf(userAgent, maxTouchPoints);
  if (p === 'ios') return /iPad/.test(userAgent) || (maxTouchPoints > 1 && /Macintosh/.test(userAgent)) ? 'iPad' : 'iPhone';
  const browser = /Edg\//.test(userAgent) ? 'Edge' : /Firefox\//.test(userAgent) ? 'Firefox' : /Chrome\//.test(userAgent) ? 'Chrome' : /Safari\//.test(userAgent) ? 'Safari' : 'Browser';
  if (p === 'android') return `Android · ${browser}`;
  const os = /Windows/.test(userAgent) ? 'Windows' : /Mac OS X|Macintosh/.test(userAgent) ? 'Mac' : /Linux/.test(userAgent) ? 'Linux' : 'Computer';
  return `${os} · ${browser}`;
}

/** The office's own HTTPS address to fill in "Office address for links" with, when it's empty and this page has one. */
export function suggestOfficeUrl(location: { protocol: string; hostname: string; origin: string }, current: string): string | null {
  if (current.trim() || location.protocol !== 'https:' || LOOPBACK.test(location.hostname)) return null;
  return `${location.origin}/`;
}

/** How to let the office notify again after "Block", on this platform. */
export function unblockHow(platform: Platform, standalone: boolean): string[] {
  if (platform === 'ios') return ['Open the iPhone Settings app.', 'Tap Notifications, then cubefarm.', 'Turn on Allow Notifications, then come back here.'];
  if (platform === 'android') {
    return standalone
      ? ['Touch and hold the cubefarm icon on your home screen, then tap App info.', 'Tap Notifications and turn them on.', 'Come back here.']
      : ['Tap the icon left of the address (or ⋮ → Settings → Site settings).', 'Tap Notifications, then Allow.', 'Reload this page.'];
  }
  return ['Click the icon left of the address bar (the padlock or the sliders).', 'Set Notifications to Allow.', 'Reload this page.'];
}

const HOME_SCREEN_HOW = [
  'In Safari, tap Share (the square with an arrow, at the bottom).',
  'Scroll down and tap Add to Home Screen, then Add.',
  'Close Safari and open cubefarm from your home screen.',
  'There, open Settings → Notifications again and carry on.',
];

/** A step's title while an earlier one comes first: what it will be, not what's wrong with it yet. */
const WAITING: Record<StepId, string> = {
  https: 'Open the office over HTTPS',
  homeScreen: 'Add the office to your home screen',
  permission: 'Allow notifications',
  worker: 'Start the background helper',
  device: 'Sign this device up',
  test: 'Send a test',
};

/** The checklist, top to bottom. Steps after the first one that isn't done wait for it. */
export function guideSteps(i: GuideInput): GuideStep[] {
  const steps: GuideStep[] = [];
  const https = secureOrigin(i.location);
  const httpsAddress = /^https:\/\//.test(i.officeUrl) ? i.officeUrl : '';
  steps.push(
    https
      ? { id: 'https', state: 'done', title: 'Opened over HTTPS', detail: i.location.protocol === 'https:' ? 'This address is secure.' : "This is the office's own PC (localhost)." }
      : {
          id: 'https',
          state: 'todo',
          title: 'Open the office over HTTPS',
          detail: httpsAddress
            ? `Phones only allow notifications on secure addresses. Open the office at ${httpsAddress} instead.`
            : 'Phones only allow notifications on secure addresses. Open the office at its HTTPS address instead, e.g. its Tailscale Serve address (on the office PC: tailscale serve --bg 4317).',
          ...(httpsAddress ? { action: { kind: 'open' as const, label: 'Open the HTTPS address', href: httpsAddress } } : {}),
        },
  );

  if (i.platform === 'ios') {
    steps.push(
      i.standalone
        ? { id: 'homeScreen', state: 'done', title: 'Running as the home-screen app', detail: 'iPhones only allow notifications here.' }
        : { id: 'homeScreen', state: 'todo', title: 'Add the office to your home screen', detail: 'On an iPhone, only the installed app can get notifications.', how: HOME_SCREEN_HOW },
    );
  }

  if (i.permission === 'granted') steps.push({ id: 'permission', state: 'done', title: 'Notifications allowed', detail: 'This browser lets the office notify you.' });
  else if (i.permission === 'denied') {
    steps.push({ id: 'permission', state: 'todo', title: 'Notifications are blocked', detail: 'They were blocked for the office. Unblock them:', how: unblockHow(i.platform, i.standalone), action: { kind: 'reload', label: "I've unblocked them" } });
  } else if (i.permission === 'unsupported' || !i.pushApi) {
    steps.push({
      id: 'permission',
      state: 'todo',
      title: "This browser can't get notifications",
      detail: i.platform === 'ios' ? 'Open the office from its home-screen icon (iOS 16.4 or later).' : 'Use Chrome, Edge, Firefox or Safari, or try the ntfy app below.',
    });
  } else steps.push({ id: 'permission', state: 'todo', title: 'Allow notifications', detail: 'Tap the button, then Allow when the browser asks.', action: { kind: 'allow', label: 'Allow notifications' } });

  if (i.worker === 'active') steps.push({ id: 'worker', state: 'done', title: 'Background helper running', detail: "The office's service worker shows notifications while the office is closed." });
  else if (i.worker === 'dev') steps.push({ id: 'worker', state: 'todo', title: 'No background helper here', detail: 'The dev server has no service worker: use a built office (npm run build).' });
  else if (i.worker === 'failed') steps.push({ id: 'worker', state: 'todo', title: "The background helper didn't start", detail: i.workerError || 'Its service worker failed to install.', action: { kind: 'worker', label: 'Try again' } });
  else steps.push({ id: 'worker', state: 'todo', title: 'Start the background helper', detail: 'It shows notifications while the office is closed.', action: { kind: 'worker', label: i.worker === 'starting' ? 'Starting…' : 'Start the background helper' } });

  const count = `${i.devices} device${i.devices === 1 ? '' : 's'} signed up in all.`;
  if (i.subscribed && i.known) steps.push({ id: 'device', state: 'done', title: 'This device is signed up', detail: count });
  else if (i.subscribed) {
    steps.push({ id: 'device', state: 'todo', title: "The office doesn't have this device", detail: `It signed up, but the office never got it. ${count}`, action: { kind: 'subscribe', label: 'Sign this device up again' } });
  } else steps.push({ id: 'device', state: 'todo', title: 'Sign this device up', detail: `The office saves it and pushes to it. ${count}`, action: { kind: 'subscribe', label: 'Turn on push for this device' } });

  const t = i.test;
  if (!t) steps.push({ id: 'test', state: 'todo', title: 'Send a test', detail: 'One notification to this device, to be sure.', action: { kind: 'test', label: 'Send a test' } });
  else if (t.outcome === 'expired') steps.push({ id: 'test', state: 'todo', title: 'This sign-up expired', detail: t.message, action: { kind: 'subscribe', label: 'Sign this device up again' } });
  else if (t.outcome === 'error') steps.push({ id: 'test', state: 'todo', title: "The test didn't go out", detail: t.message, action: { kind: 'test', label: 'Send another test' } });
  else if (i.arrived === true) steps.push({ id: 'test', state: 'done', title: 'Test arrived', detail: "You're all set: the office notifies this device." });
  else if (i.arrived === false) {
    steps.push({
      id: 'test',
      state: 'todo',
      title: "The test didn't show",
      detail: 'The push service took it, so the device is holding it back:',
      how: ['Check Focus / Do Not Disturb is off.', `Check the ${i.platform === 'desktop' ? "system's" : "phone's"} notification settings for ${i.standalone ? 'cubefarm' : 'this browser'}.`, 'Lock the screen and wait a minute: some phones deliver late.'],
      action: { kind: 'test', label: 'Send another test' },
    });
  } else steps.push({ id: 'test', state: 'todo', title: 'Did it arrive?', detail: t.message });

  let blocked = false;
  return steps.map((s) => {
    const out = blocked && s.state !== 'done' ? { ...s, state: 'waiting' as const, title: WAITING[s.id], action: undefined, how: undefined } : s;
    if (s.state !== 'done') blocked = true;
    return out;
  });
}

/** The step the big button works on: the first one not done (null when everything is green). */
export const nextStep = (steps: readonly GuideStep[]) => steps.find((s) => s.state === 'todo') ?? null;
