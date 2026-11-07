// Settings → Notifications, the parts that get a device set up (docs/pocket.md): the "Get notified on this device"
// checklist with one button that does the next step (notifySteps.ts decides, pwa.ts does), one-tap ntfy with its QR
// code, and each channel's last send, where push devices are renamed and removed.
import { useCallback, useEffect, useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { api } from '../api';
import { useStore } from '../store';
import { NTFY_APPS, ntfyLinks } from '../../../shared/ntfy';
import type { NotifyHealth, PushTestView } from '../../../shared/types';
import { allowNotifications, currentPush, enablePush, preparePush, pushSupport, startWorker, workerState, type PushPrep } from '../pwa';
import { confirmDialog } from './Confirm';
import { Menu } from './Menu';
import { EmptyState } from './EmptyState';
import { Icon } from './Icon';
import { deviceLabel, guideSteps, nextStep, platformOf, type GuideInput, type StepAction, type WorkerState } from './notifySteps';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** What this browser says about itself, read again after every step. */
function readBrowser() {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    platform: platformOf(nav.userAgent, nav.maxTouchPoints),
    standalone: nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true,
    pushApi: 'serviceWorker' in nav && 'PushManager' in window && typeof Notification !== 'undefined',
    permission: (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission) as GuideInput['permission'],
  };
}

const MARK = { todo: '!', waiting: '·' } as const;

/** "Get notified on this device": the live checklist and its one button. */
export function NotifyGuide() {
  const channels = useStore((s) => s.notifyChannels);
  const officeUrl = useStore((s) => s.settings.notify.officeUrl);
  const [browser, setBrowser] = useState(readBrowser);
  const support = pushSupport();
  const [worker, setWorker] = useState<WorkerState>(support === 'dev' ? 'dev' : 'none');
  const [workerError, setWorkerError] = useState('');
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [prep, setPrep] = useState<PushPrep | null>(null);
  const [test, setTest] = useState<PushTestView | null>(null);
  const [arrived, setArrived] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Looks at the worker, the subscription and whether the office knows it; fetches the key the subscribe tap needs.
  const refresh = useCallback(async () => {
    setBrowser(readBrowser());
    if (support !== 'ok') return;
    try {
      const w = await workerState();
      setWorker((old) => (old === 'failed' && w !== 'active' ? old : w));
      const sub = await currentPush();
      setSubscribed(!!sub);
      setMyId(sub ? (await api.pushWhois(sub.endpoint)).id : null);
      setPrep(w === 'active' ? await preparePush() : null);
    } catch (err) {
      setError(errorText(err));
    }
  }, [support]);
  const deviceCount = channels.devices.length;
  useEffect(() => void refresh(), [refresh, deviceCount]);

  const known = !!myId && channels.devices.some((d) => d.id === myId);
  const steps = guideSteps({ location, officeUrl, ...browser, worker, workerError, subscribed, known, devices: deviceCount, test, arrived });
  const next = nextStep(steps);

  const finish = (p: Promise<unknown>) => {
    p.catch((err: unknown) => setError(errorText(err))).finally(() => {
      setBusy(false);
      void refresh();
    });
  };

  /** One tap: the next step. Nothing is awaited before a step that needs the tap's gesture (permission, subscribe). */
  const run = (kind: StepAction) => {
    setError('');
    if (kind === 'reload') return location.reload();
    setBusy(true);
    if (kind === 'allow') return finish(allowNotifications());
    if (kind === 'worker') {
      setWorker('starting');
      return finish(
        startWorker().then(
          () => setWorker('active'),
          (err: unknown) => {
            setWorker('failed');
            setWorkerError(errorText(err));
          },
        ),
      );
    }
    if (kind === 'subscribe') {
      if (!prep) return finish(Promise.reject(new Error("The office's push key hasn't loaded yet: tap again in a moment.")));
      return finish(
        enablePush(prep, deviceLabel(navigator.userAgent, navigator.maxTouchPoints)).then((id) => {
          setMyId(id);
          setTest(null);
          setArrived(null);
        }),
      );
    }
    if (kind === 'test' && myId) {
      setArrived(null);
      return finish(api.testPushDevice(myId).then(setTest));
    }
    setBusy(false);
  };

  const asking = test?.outcome === 'delivered' && arrived === null;
  return (
    <div className="notify-guide" aria-live="polite">
      <b>
        <Icon name="smartphone" /> Get notified on this device
      </b>
      <ol className="guide-steps">
        {steps.map((s) => (
          <li key={s.id} className={`guide-step guide-${s.state}`}>
            <span className="guide-mark" aria-label={s.state === 'done' ? 'Done' : s.state === 'todo' ? 'To do' : 'Waiting'}>
              {s.state === 'done' ? <Icon name="check" /> : MARK[s.state]}
            </span>
            <div className="grow">
              <div className="guide-title">{s.title}</div>
              {s.state !== 'waiting' && <div className="small muted">{s.detail}</div>}
              {s.how && (
                <ol className="guide-how small">
                  {s.how.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ol>
              )}
            </div>
          </li>
        ))}
      </ol>
      {asking && (
        <div className="row wrap guide-ask">
          <span className="grow">Did the test notification arrive?</span>
          <button className="btn btn-small btn-good" onClick={() => setArrived(true)}>
            Yes
          </button>
          <button className="btn btn-small" onClick={() => setArrived(false)}>
            No
          </button>
        </div>
      )}
      {next?.action?.href ? (
        <a className="btn btn-good guide-go" href={next.action.href}>
          {next.action.label}
        </a>
      ) : next?.action ? (
        <button className="btn btn-good guide-go" disabled={busy} onClick={() => run(next.action!.kind)}>
          {busy ? 'Working…' : next.action.label}
        </button>
      ) : (
        !next && (
          <p className="notify-ok">
            <Icon name="check" /> All set: the office notifies this device.
          </p>
        )
      )}
      {error && (
        <div className="term-error small" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

/** A QR code as an SVG data URL. */
function qrSrc(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(5, 2);
}

/** "Use the ntfy app instead": a new private topic, its subscribe links and QR code, and a test. */
export function NtfyQuick() {
  const view = useStore((s) => s.notifyChannels.webhooks.ntfy);
  const [made, setMade] = useState<{ url: string; test: { ok: boolean; message: string } } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [arrived, setArrived] = useState<boolean | null>(null);
  const links = useMemo(() => (made ? ntfyLinks(made.url) : null), [made]);
  const qr = useMemo(() => (links ? qrSrc(links.app) : ''), [links]);
  const create = async () => {
    if (view.set && !(await confirmDialog({ title: 'Make a new ntfy topic?', body: 'The office stops sending to the old one: subscribe to the new one in the ntfy app.', confirm: 'Make a new topic' }))) return;
    setBusy(true);
    setError('');
    try {
      setMade(await api.quickNtfy());
      setArrived(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const retest = async () => {
    setBusy(true);
    try {
      await api.testNotify('ntfy');
      setMade((m) => m && { ...m, test: { ok: true, message: 'Another test went to the topic.' } });
    } catch (err) {
      setMade((m) => m && { ...m, test: { ok: false, message: errorText(err) } });
    } finally {
      setArrived(null);
      setBusy(false);
    }
  };
  return (
    <div className="notify-hook ntfy-quick">
      <b>
        <Icon name="bell" /> Use the ntfy app instead
      </b>
      <p className="muted small">Works on any phone with no setup on this device: the office makes a private topic and the free ntfy app subscribes to it.</p>
      {!made && (
        <button className="btn btn-good" disabled={busy} onClick={() => void create()}>
          {busy ? 'Setting up…' : view.set ? 'Make a new ntfy topic' : 'Set up ntfy'}
        </button>
      )}
      {made && links && (
        <div className="ntfy-made">
          <ol className="guide-how small">
            <li>
              Get the ntfy app: <a href={NTFY_APPS.ios}>App Store</a> · <a href={NTFY_APPS.android}>Google Play</a>
            </li>
            <li>On this phone, tap the button. On another, scan the code with its camera.</li>
          </ol>
          <div className="row wrap ntfy-links">
            <img className="ntfy-qr" src={qr} alt={`QR code for ${links.app}`} width={150} height={150} />
            <div className="grow">
              <a className="btn btn-good" href={links.app}>
                Subscribe in the ntfy app
              </a>
              <p className="small muted">
                Or open <a href={links.web}>{links.web.replace(/^https:\/\//, '')}</a>, or add the topic <code>{links.topic}</code> in the app by hand. It's shown only now.
              </p>
            </div>
          </div>
          <p className={`small ${made.test.ok ? 'notify-ok' : 'term-error'}`} role="status">
            {made.test.ok ? (
              <>
                <Icon name="check" /> {made.test.message}
              </>
            ) : (
              made.test.message
            )}
          </p>
          {arrived === null ? (
            <div className="row wrap">
              <span className="grow small">Once you've subscribed, did the test show in the app?</span>
              <button className="btn btn-small btn-good" onClick={() => setArrived(true)}>
                Yes
              </button>
              <button className="btn btn-small" onClick={() => setArrived(false)}>
                No
              </button>
            </div>
          ) : arrived ? (
            <p className="notify-ok small">
              <Icon name="check" /> All set: the office notifies you through ntfy.
            </p>
          ) : (
            <div className="row wrap">
              <span className="grow small">Check the app subscribed to {links.topic} on ntfy.sh, and that its notifications are on.</span>
              <button className="btn btn-small" disabled={busy} onClick={() => void retest()}>
                Send another test
              </button>
            </div>
          )}
        </div>
      )}
      {error && (
        <div className="term-error small" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

function ago(at: number, now: number) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

function Health({ last }: { last: NotifyHealth | null }) {
  if (!last) return <span className="small muted">Nothing sent since the office started</span>;
  const when = ago(last.at, Date.now());
  return last.ok ? (
    <span className="small notify-ok">
      <Icon name="check" /> Sent {when}
    </span>
  ) : (
    <span className="small term-error">
      <Icon name="x" /> {when}: {last.error}
    </span>
  );
}

/** Each channel's last send; push devices can be tested, renamed and removed from here. */
export function ChannelHealth() {
  const channels = useStore((s) => s.notifyChannels);
  const [results, setResults] = useState<Record<string, string>>({});
  const [thisDevice, setThisDevice] = useState<string | null>(null);
  const count = channels.devices.length;
  useEffect(() => {
    if (pushSupport() === 'ok') void currentPush().then((sub) => (sub ? api.pushWhois(sub.endpoint).then((r) => setThisDevice(r.id)) : setThisDevice(null)), () => undefined);
  }, [count]);
  const rename = async (id: string, name: string) => {
    const next = window.prompt('Name this device', name);
    if (next?.trim()) await api.renamePushDevice(id, next.trim()).catch(() => undefined);
  };
  const remove = async (id: string, name: string) => {
    if (await confirmDialog({ tone: 'danger', title: `Remove ${name}?`, body: 'The office stops pushing to it. Sign it up again from that device to get it back.', confirm: 'Remove' })) await api.removePushDevice(id).catch(() => undefined);
  };
  const test = async (id: string) => {
    setResults((r) => ({ ...r, [id]: 'Sending…' }));
    const out = await api.testPushDevice(id).catch((err: unknown) => ({ message: errorText(err) }));
    setResults((r) => ({ ...r, [id]: out.message }));
  };
  return (
    <ul className="notify-health">
      <li>
        <b>Desktop</b> <span className="small muted">(open office tabs)</span>
        <div>
          <Health last={channels.desktop} />
        </div>
      </li>
      {count === 0 && (
        <li>
          <EmptyState kind="devices" compact />
        </li>
      )}
      {channels.devices.map((d) => (
        <li key={d.id}>
          <div className="row wrap">
            <b className="grow">
              <Icon name="smartphone" /> {d.name}
              {d.id === thisDevice && <span className="small muted"> (this device)</span>}
            </b>
            <button className="btn btn-small" onClick={() => void test(d.id)}>
              Test
            </button>
            <Menu
              label={`More for ${d.name}`}
              title={d.name}
              items={[
                { label: 'Rename…', onSelect: () => void rename(d.id, d.name) },
                { label: 'Remove this device…', hint: 'The office stops pushing to it', danger: true, onSelect: () => void remove(d.id, d.name) },
              ]}
            />
          </div>
          <Health last={d.last} />
          {results[d.id] && (
            <div className="small" role="status">
              {results[d.id]}
            </div>
          )}
        </li>
      ))}
      {channels.webhooks.ntfy.set && (
        <li>
          <b>ntfy</b> <code className="small">{channels.webhooks.ntfy.hint}</code>
          <div>
            <Health last={channels.webhooks.ntfy.last} />
          </div>
        </li>
      )}
      {channels.telegram.linked && (
        <li>
          <b>Telegram</b> <code className="small">@{channels.telegram.bot}</code>
          <div>
            {channels.telegram.on ? <Health last={channels.telegram.last} /> : <span className="small muted">Off: nothing is sent</span>}
          </div>
        </li>
      )}
    </ul>
  );
}
