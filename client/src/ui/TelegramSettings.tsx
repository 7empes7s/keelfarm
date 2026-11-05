// Settings → Notifications → Telegram (docs/pocket.md): the manager's own bot. BotFather's token goes in once and only
// the bot's name comes back; pressing Start with the one-time link links their chat. Then the On switch, mirroring the
// CEO chat, a test and Remove; the demo office adds buttons that play the manager on Telegram.
import { useEffect, useId, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { confirmDialog } from './Confirm';
import { BOTFATHER, telegramSteps } from './telegramSteps';

const MARK = { done: '✓', todo: '!', waiting: '·' } as const;
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function TelegramSettings() {
  const view = useStore((s) => s.notifyChannels.telegram);
  const notify = useStore((s) => s.settings.notify);
  const demo = useStore((s) => s.demo);
  const [token, setToken] = useState('');
  const [startUrl, setStartUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [demoText, setDemoText] = useState('');
  const errorId = useId();
  useEffect(() => {
    if (view.linked) setStartUrl(null);
  }, [view.linked]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const saveToken = () =>
    act(async () => {
      const r = await api.setTelegram(token);
      setToken(''); // never kept or shown again once saved
      setStartUrl(r.startUrl);
    });
  const newLink = () => act(async () => setStartUrl((await api.telegramLink()).startUrl));
  const test = () =>
    act(async () => {
      setResult(null);
      try {
        await api.testNotify('telegram');
        setResult({ ok: true, text: '✓ Sent: check Telegram' });
      } catch (err) {
        setResult({ ok: false, text: errorText(err) });
      }
    });
  const remove = async () => {
    if (await confirmDialog({ tone: 'danger', title: 'Remove Telegram?', body: "The office forgets the bot's token and your chat. Nothing more is sent there, and messages to the bot no longer reach the CEO.", confirm: 'Remove' })) {
      await act(async () => {
        await api.removeTelegram();
        setStartUrl(null);
        setResult(null);
      });
    }
  };
  const save = (patch: Partial<typeof notify>) => void api.updateSettings({ notify: { ...notify, ...patch } }).catch(() => undefined);

  const steps = telegramSteps(view, startUrl);
  return (
    <div className="notify-hook telegram">
      <div className="row wrap">
        <b className="grow">✈️ Telegram</b>
        {view.linked && (
          <label className="toggle small">
            <input type="checkbox" checked={notify.channels.telegram} onChange={(e) => save({ channels: { ...notify.channels, telegram: e.target.checked } })} /> On
          </label>
        )}
      </div>
      <p className="muted small">Notifications in Telegram, and the CEO chat right there: write to your bot and the CEO answers.</p>
      <ol className="guide-steps" aria-live="polite">
        {steps.map((s, i) => (
          <li key={s.id} className={`guide-step guide-${s.state}`}>
            <span className="guide-mark" aria-label={s.state === 'done' ? 'Done' : s.state === 'todo' ? 'To do' : 'Waiting'}>
              {s.state === 'done' ? MARK.done : i + 1}
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
              {s.id === 'bot' && s.state === 'todo' && (
                <a className="btn btn-small telegram-go" href={BOTFATHER} target="_blank" rel="noreferrer">
                  Open @BotFather
                </a>
              )}
              {s.id === 'token' && s.state !== 'done' && (
                <form
                  className="notify-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveToken();
                  }}
                >
                  <label className="field">
                    <span>Bot token</span>
                    <input
                      type="password"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder="123456789:AAE…"
                      autoComplete="off"
                      spellCheck={false}
                      aria-invalid={!!error}
                      aria-describedby={error ? errorId : undefined}
                    />
                  </label>
                  <button className="btn btn-small btn-good" disabled={busy || !token.trim()}>
                    {busy ? 'Checking…' : 'Check and save'}
                  </button>
                </form>
              )}
              {s.id === 'start' && s.state === 'todo' && (
                <div className="row wrap">
                  {startUrl && view.linking ? (
                    <a className="btn btn-good telegram-go" href={startUrl} target="_blank" rel="noreferrer">
                      Open @{view.bot} and press Start
                    </a>
                  ) : (
                    <button className="btn btn-good" disabled={busy} onClick={() => void newLink()}>
                      Make a Start link
                    </button>
                  )}
                  {demo && startUrl && view.linking && (
                    <button className="btn btn-small btn-ghost" onClick={() => void act(() => api.telegramDemo('start'))}>
                      Demo: press Start
                    </button>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
      {view.set && view.polling === 'retrying' && (
        <p className="small term-error" role="status">
          Can't read the bot's messages right now: {view.error}. Retrying.
        </p>
      )}
      {view.linked && (
        <>
          <label className="toggle block small">
            <input type="checkbox" checked={notify.telegramMirror} onChange={(e) => save({ telegramMirror: e.target.checked })} />
            <span>Mirror the whole CEO chat to Telegram (otherwise the CEO answers there only when you wrote from there)</span>
          </label>
          <div className="row wrap">
            <button className="btn btn-small" disabled={busy} onClick={() => void test()}>
              Send test
            </button>
            <button className="btn btn-small btn-ghost" disabled={busy} onClick={() => void newLink()}>
              Link another chat
            </button>
            {result && (
              <span className={`small ${result.ok ? 'notify-ok' : 'term-error'}`} role="status">
                {result.text}
              </span>
            )}
          </div>
          {startUrl && view.linking && (
            <p className="small">
              <a href={startUrl} target="_blank" rel="noreferrer">
                Open @{view.bot} in the other chat and press Start
              </a>
              : it replaces this one.
            </p>
          )}
        </>
      )}
      {view.set && (
        <button className="btn btn-small btn-ghost" disabled={busy} onClick={() => void remove()}>
          Remove Telegram
        </button>
      )}
      {error && (
        <div id={errorId} className="term-error small" role="alert">
          {error}
        </div>
      )}
      {demo && view.linked && (
        <details className="telegram-demo">
          <summary className="small">Demo: play the manager on Telegram</summary>
          <form
            className="row wrap"
            onSubmit={(e) => {
              e.preventDefault();
              void act(() => api.telegramDemo('message', demoText)).then(() => setDemoText(''));
            }}
          >
            <input className="grow" value={demoText} onChange={(e) => setDemoText(e.target.value)} placeholder="A message to the CEO" aria-label="A message from Telegram" />
            <button className="btn btn-small" disabled={!demoText.trim()}>
              Send from Telegram
            </button>
          </form>
          <div className="row wrap">
            <button className="btn btn-small btn-ghost" onClick={() => void act(() => api.telegramDemo('approve'))}>
              Press ✅ on the last team change
            </button>
            <button className="btn btn-small btn-ghost" onClick={() => void act(() => api.telegramDemo('decline'))}>
              Press ✋
            </button>
          </div>
        </details>
      )}
    </div>
  );
}
