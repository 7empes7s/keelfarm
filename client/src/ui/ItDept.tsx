// The IT department (#524): its chat with the IT lead (the CEO chat's bubbles, suggestions, voice input, and the IT
// desk's Run / Not now cards inline), and its setup: on/off, the lead's name, coding agent, account, model and effort
// (the same pickers as the CEO's), and its own Telegram bot; its health checks (#525, ItHealth.tsx). Console → The CEO →
// IT department.
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { IT_NAME_MAX, type ItDeptSettings } from '../../../shared/itDept';
import { suggestionsFor } from '../../../shared/chatParts';
import { CEO_CLIS } from '../../../shared/ceoRunsOn';
import { CLI_NAMES } from '../../../shared/sessionRun';
import type { EffortLevel } from '../../../shared/types';
import { Bubble } from './ChatBubble';
import { DaySeparator } from './ChatCards';
import { ItDeskCards } from './ItDeskCards';
import { ItAutoApprove, ItAutoUndo } from './ItAutoApprove';
import { ItHealth, ItRecCards } from './ItHealth';
import { ItTickets } from './ItTickets';
import { ItImprove, ItImproveCards } from './ItImprove';
import { MessageBox } from './MessageBox';
import { MicButton } from './MicButton';
import { ModelPicker } from './ModelPicker';
import { SecretInput } from './SecretInput';
import { confirmDialog } from './Confirm';
import { Menu } from './Menu';
import { Icon } from './Icon';
import { attempt, Avatar } from './phoneParts';
import './itDept.css';

const NONE: never[] = [];
const EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const noop = () => undefined;
const plain = (t: string) => t;
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function ItChat() {
  const s = useStore((x) => x.settings.itDept);
  const messages = useStore((x) => x.it?.messages ?? NONE);
  const busy = useStore((x) => x.it?.busy ?? false);
  const [text, setText] = useState('');
  const log = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, busy]);
  const send = (t: string, replyTo?: number) => {
    const body = t.trim();
    if (!body) return;
    setText('');
    void attempt(() => api.messageIt(body, replyTo));
  };
  const offer = suggestionsFor(messages);
  return (
    <section className="card it-chat" aria-label={`IT chat with ${s.name}`}>
      <div className="it-chat-head">
        <Avatar name={s.name} color="#2a9d8f" size={28} />
        <div className="grow">
          <b>{s.name}</b> <span className="muted small">IT · {!s.on ? 'off' : busy ? 'working…' : 'available'}</span>
        </div>
      </div>
      <div className="chat-log it-chat-log" ref={log} tabIndex={0} aria-label={`Messages with ${s.name}`}>
        {messages.length === 0 && (
          <p className="muted small phone-empty">
            Ask {s.name} about this machine: how much disk is free, what's using memory, what can be cleaned up. Any change comes to you as a card with Run / Not now, and {s.name} checks the result after.
          </p>
        )}
        {messages.map((m, i) => (
          <Fragment key={m.id}>
            <DaySeparator prev={messages[i - 1]?.at} at={m.at} />
            <Bubble item={{ m }} ceoName={s.name} quoted={undefined} highlight={false} linked={plain} onFloor={noop} onQuote={noop} onReply={noop} onActions={noop} onArtifact={noop} onFile={noop} />
            <ItAutoUndo m={m} />
            {m.id === offer?.id && (
              <div className="suggestions" role="group" aria-label={`Suggested replies to ${s.name}`}>
                {offer.suggestions!.map((x) => (
                  <button key={x} type="button" className="suggestion-chip" onClick={() => send(x, offer.id)}>
                    <Icon name="reply" /> {x}
                  </button>
                ))}
              </div>
            )}
          </Fragment>
        ))}
        <ItDeskCards />
        <ItRecCards />
        <ItImproveCards />
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <MessageBox value={text} onChange={setText} placeholder={s.on ? `Message ${s.name}…` : 'The IT department is off'} aria-label={`Message ${s.name}`} disabled={!s.on} title="Enter sends · Shift+Enter adds a new line" />
        <MicButton kind="phone" value={text} onChange={setText} onSend={(t) => send(t)} disabled={!s.on} />
        <button className="btn btn-small btn-good" disabled={!s.on || !text.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}

function ItSetup() {
  const id = useId();
  const s = useStore((x) => x.settings.itDept);
  const accounts = useStore((x) => x.accounts.accounts);
  const [name, setName] = useState(s.name);
  useEffect(() => setName(s.name), [s.name]);
  const save = (patch: Partial<ItDeptSettings>) => void api.updateSettings({ itDept: { ...s, ...patch } }).catch(() => undefined); // api() already toasted the error
  const mine = accounts.filter((a) => a.cli === s.cli && !a.removing);
  const tags = [...new Set(mine.flatMap((a) => a.tags))];
  return (
    <section className="card it-setup" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`}>
        <Icon name="monitor" /> The IT department
      </h3>
      <p className="muted small">IT owns this machine's health: it looks with read-only commands and puts every change on a card for you to run. It sleeps between messages, so it costs nothing while quiet.</p>
      <label className="row it-switch">
        <input type="checkbox" checked={s.on} onChange={(e) => save({ on: e.target.checked })} />
        <span>IT department on</span>
      </label>
      <label className="field" htmlFor={`${id}-name`}>
        <span>Name</span>
        <input id={`${id}-name`} value={name} maxLength={IT_NAME_MAX} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name.trim() !== s.name && save({ name })} />
      </label>
      <label className="field" htmlFor={`${id}-cli`}>
        <span>Coding agent</span>
        <select id={`${id}-cli`} value={s.cli} onChange={(e) => save({ cli: e.target.value as ItDeptSettings['cli'], account: '', model: '' })}>
          {CEO_CLIS.map((c) => (
            <option key={c} value={c}>
              {CLI_NAMES[c]}
            </option>
          ))}
        </select>
      </label>
      <label className="field" htmlFor={`${id}-account`}>
        <span>Account</span>
        <select id={`${id}-account`} value={s.account} onChange={(e) => save({ account: e.target.value })}>
          <option value="">Rotation (default)</option>
          {tags.map((t) => (
            <option key={`t-${t}`} value={t}>
              Any “{t}” account
            </option>
          ))}
          {mine.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
              {a.enabled ? '' : ' (paused)'}
            </option>
          ))}
          {s.account && !mine.some((a) => a.id === s.account) && !tags.includes(s.account) && <option value={s.account}>{s.account} (gone: runs on the rotation)</option>}
        </select>
      </label>
      <div className="field">
        <span id={`${id}-model`}>Model</span>
        <ModelPicker cli={s.cli} value={s.model} resolvedDefault="" label="IT's model" onChange={(model) => save({ model })} />
      </div>
      <label className="field" htmlFor={`${id}-effort`}>
        <span>Effort</span>
        <select id={`${id}-effort`} value={s.effort} onChange={(e) => save({ effort: e.target.value as EffortLevel })}>
          {EFFORTS.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </label>
      <ItAutoApprove />
      <ItTelegram />
    </section>
  );
}

/** IT's own Telegram bot: a second BotFather token, linked with a Start code. Without one, IT's alerts go on the CEO's bot. */
function ItTelegram() {
  const view = useStore((x) => x.it?.telegram);
  const ceoBot = useStore((x) => x.notifyChannels.telegram.linked);
  const demo = useStore((x) => x.demo);
  const [token, setToken] = useState('');
  const [startUrl, setStartUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (view?.linked) setStartUrl(null);
  }, [view?.linked]);
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
  const remove = async () => {
    if (await confirmDialog({ tone: 'danger', title: "Remove IT's Telegram bot?", body: "The office forgets its token and your chat. IT's alerts go on the CEO's bot again, if you have one.", confirm: 'Remove' })) await act(() => api.removeItTelegram());
  };
  return (
    <div className="it-telegram">
      <h4>
        <Icon name="send" /> IT's Telegram bot
      </h4>
      {view?.linked ? (
        <p className="small notify-ok" role="status">
          <Icon name="check" /> @{view.bot} is linked to {view.chat}. Messages there go to IT; Run / Not now buttons come with each proposal.
        </p>
      ) : (
        <p className="muted small">{ceoBot ? "Until IT has its own bot, its alerts and buttons come on the CEO's bot, starting with “IT:”." : 'Make a second bot with BotFather and paste its token here.'}</p>
      )}
      {!view?.set && (
        <form
          className="row wrap"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              const r = await api.setItTelegram(token);
              setToken('');
              setStartUrl(r.startUrl);
            });
          }}
        >
          <label className="field grow">
            <span>IT bot token</span>
            <SecretInput name="it-telegram-token" value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456789:AAE…" aria-invalid={!!error} />
          </label>
          <button className="btn btn-small btn-good" disabled={busy || !token.trim()}>
            {busy ? 'Checking…' : 'Check and save'}
          </button>
        </form>
      )}
      {view?.set && !view.linked && (
        <div className="row wrap">
          {startUrl && view.linking ? (
            <a className="btn btn-good" href={startUrl} target="_blank" rel="noreferrer">
              Open @{view.bot} and press Start
            </a>
          ) : (
            <button type="button" className="btn btn-good" disabled={busy} onClick={() => void act(async () => setStartUrl((await api.itTelegramLink()).startUrl))}>
              Make a Start link
            </button>
          )}
          {demo && startUrl && view.linking && (
            <button type="button" className="btn btn-small btn-ghost" onClick={() => void act(() => api.itTelegramDemo('start'))}>
              Demo: press Start
            </button>
          )}
        </div>
      )}
      {view?.set && <Menu label="More for IT's Telegram bot" title="IT's Telegram bot" items={[{ label: 'Remove the IT bot…', danger: true, disabled: busy, onSelect: () => void remove() }]} />}
      {error && (
        <div className="term-error small" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

/** Console → The CEO → IT department: the chat beside its health checks and setup (stacked when narrow), its tickets (#542) and improvements (#543) under them. */
export function ItDept() {
  return (
    <div className="it-dept">
      <div className="it-dept-grid">
        <ItChat />
        <div className="it-side">
          <ItHealth />
          <ItSetup />
        </div>
      </div>
      <ItTickets />
      <ItImprove />
    </div>
  );
}
