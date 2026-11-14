// Company → Comms (#668): the shared mailboxes' threads, drafts waiting for the manager's Approve (Edit, or Discard in
// the ⋯), what was sent, and the lead list, phone first; a thread opens as a sheet. Settings: each mailbox's
// auto-replies, the floors whose agents have the mail tools, the outreach cap. Rules in shared/comms.ts.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { LEAD_STAGES, MAIL_LABELS, type CommsView, type Lead, type MailDraft, type MailLabel, type MailThread } from '../../../shared/comms';
import { Sheet } from './ChatArtifacts';
import { confirmDialog } from './Confirm';
import { Icon } from './Icon';
import { Menu } from './Menu';
import { pushLayer } from './backStack';
import './comms.css';

type Tab = 'inbox' | 'waiting' | 'sent' | 'leads' | 'settings';

const when = (t: number) => {
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};
const local = (a: string) => a.split('@')[0];
const pill = (on: boolean) => `btn btn-small ${on ? '' : 'btn-ghost'}`;

export function CommsPage() {
  const c = useStore((s) => s.comms);
  const [tab, setTab] = useState<Tab>('waiting');
  const [box, setBox] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  if (!c) return <p className="muted cn-one">Loading…</p>;
  const waiting = c.drafts.filter((d) => d.status === 'waiting');
  const tabs: { id: Tab; label: string; n?: number }[] = [
    { id: 'waiting', label: 'Waiting for you', n: waiting.length },
    { id: 'inbox', label: 'Inbox', n: c.threads.filter((t) => t.unread).length },
    { id: 'sent', label: 'Sent' },
    { id: 'leads', label: 'Leads', n: c.leads.length },
    { id: 'settings', label: 'Settings' },
  ];
  return (
    <div className="cn-one cm-page">
      {!c.connected && (
        <p className="cm-note">
          <Icon name="mail" /> Mail isn't set up yet. Ask the CEO to "set up mail for the shared mailboxes": one card for you to approve, and the office does the rest.
        </p>
      )}
      <div className="cm-tabs" role="tablist" aria-label="Comms">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={pill(tab === t.id)} onClick={() => setTab(t.id)}>
            {t.label}
            {!!t.n && <span className="count">{t.n}</span>}
          </button>
        ))}
      </div>
      {tab === 'waiting' && <Drafts list={waiting} empty="Nothing waiting. Emails and posts the team wants to send come here for your Approve." />}
      {tab === 'inbox' && (
        <>
          <div className="cm-tabs" role="group" aria-label="Mailbox">
            <button type="button" className={pill(box === null)} aria-pressed={box === null} onClick={() => setBox(null)}>
              All
            </button>
            {c.settings.mailboxes.map((m) => (
              <button key={m.address} type="button" className={pill(box === m.address)} aria-pressed={box === m.address} onClick={() => setBox(m.address)}>
                {m.name}
              </button>
            ))}
          </div>
          <Threads list={c.threads.filter((t) => !box || t.mailbox === box)} onOpen={setOpen} />
        </>
      )}
      {tab === 'sent' && <Drafts list={c.drafts.filter((d) => d.status === 'sent' || d.status === 'approved' || d.status === 'failed')} empty="Nothing sent yet." />}
      {tab === 'leads' && <Leads list={c.leads} />}
      {tab === 'settings' && <Settings c={c} />}
      {open && <ThreadSheet id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Threads({ list, onOpen }: { list: MailThread[]; onOpen: (id: string) => void }) {
  if (!list.length) return <p className="muted small">No emails here yet.</p>;
  return (
    <ul className="cm-list">
      {list.map((t) => {
        const last = t.messages.at(-1);
        return (
          <li key={t.id}>
            <button type="button" className={`cm-card cm-thread${t.unread ? ' unread' : ''}`} onClick={() => onOpen(t.id)}>
              <span className="cm-avatar" aria-hidden="true">
                {(t.withName ?? t.with).charAt(0).toUpperCase()}
              </span>
              <span className="cm-main">
                <span className="cm-row">
                  <strong className="cm-who">{t.withName ?? t.with}</strong>
                  <span className="muted small">{when(t.last)}</span>
                </span>
                <span className="cm-subject">{t.subject}</span>
                <span className="cm-preview muted small">{last?.text.split('\n').find((l) => l.trim()) ?? ''}</span>
                <span className="cm-row cm-tags">
                  <span className="cm-chip">{local(t.mailbox)}@</span>
                  {t.label && <span className={`cm-chip cm-${t.label}`}>{t.label}</span>}
                  {t.unread && <span className="cm-dot" aria-label="unread" />}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ThreadSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useStore((s) => s.comms?.threads.find((x) => x.id === id));
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => pushLayer(() => close.current()), []); // Back closes it
  const label = (l: MailLabel | null) => void api.labelThread(id, l).catch(() => undefined);
  return (
    <Sheet label={<><Icon name="mail" /> {t?.subject ?? 'Email'}</>} onClose={onClose} className="cm-sheet ds-screen">
      <div className="artifact-body cm-body">
        {!t ? (
          <p className="muted">This thread is no longer kept.</p>
        ) : (
          <>
            <p className="muted small">
              {t.withName ? `${t.withName} · ` : ''}
              {t.with} · in {t.mailbox}
            </p>
            <div className="cm-tabs" role="group" aria-label="Label">
              {MAIL_LABELS.map((l) => (
                <button key={l} type="button" className={pill(t.label === l)} aria-pressed={t.label === l} onClick={() => label(t.label === l ? null : l)}>
                  {l}
                </button>
              ))}
            </div>
            {t.messages.map((m) => (
              <article key={m.id} className={`cm-msg${m.out ? ' out' : ''}`}>
                <header className="cm-row">
                  <strong>{m.out ? `Us (${local(m.from)}@)` : (m.fromName ?? m.from)}</strong>
                  <span className="muted small">{when(m.at)}</span>
                </header>
                <p className="cm-text">{m.text}</p>
              </article>
            ))}
            <p className="muted small">To answer, ask the CEO or the Comms floor to draft a reply: it comes back here for your Approve.</p>
          </>
        )}
      </div>
    </Sheet>
  );
}

function Drafts({ list, empty }: { list: MailDraft[]; empty: string }) {
  if (!list.length) return <p className="muted small">{empty}</p>;
  return (
    <ul className="cm-list">
      {list.map((d) => (
        <li key={d.id}>
          <DraftCard d={d} />
        </li>
      ))}
    </ul>
  );
}

function DraftCard({ d }: { d: MailDraft }) {
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(d.subject);
  const [text, setText] = useState(d.text);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await fn().catch(() => undefined);
    setBusy(false);
  };
  const edits = () => ({ subject, text });
  const discard = async () => {
    if (await confirmDialog({ tone: 'danger', title: 'Discard this draft?', body: 'It is not sent, and the team sees it was discarded.', confirm: 'Discard' })) await run(() => api.discardDraft(d.id));
  };
  const waiting = d.status === 'waiting' || d.status === 'draft';
  const head = d.channel === 'email' ? `${local(d.mailbox)}@ to ${d.to.join(', ')}` : d.channel === 'social' ? 'Social post' : 'Newsletter';
  return (
    <div className={`cm-card cm-draft cm-${d.status}`}>
      <div className="cm-row">
        <span className="cm-chip">
          <Icon name={d.channel === 'email' ? 'mail' : 'send'} /> {head}
        </span>
        <span className="muted small">
          {d.status === 'sent' && d.sentAt ? `Sent ${when(d.sentAt)}${d.auto ? ' · auto-reply' : ''}` : d.status === 'approved' ? 'Approved' : d.status === 'failed' ? 'Not sent' : `by ${d.by} · ${when(d.at)}`}
        </span>
      </div>
      {editing ? (
        <>
          {d.channel === 'email' && <input className="cm-input" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />}
          <textarea className="cm-input cm-area" value={text} onChange={(e) => setText(e.target.value)} rows={10} aria-label="Text" />
        </>
      ) : (
        <>
          {d.subject && <strong className="cm-subject">{d.subject}</strong>}
          <p className="cm-text">{d.text}</p>
        </>
      )}
      {d.why && <p className="cm-why small">{d.why}</p>}
      {(waiting || d.status === 'failed') && (
        <div className="cm-actions">
          <button type="button" className="btn" disabled={busy} onClick={() => void run(() => api.approveDraft(d.id, editing ? edits() : {}))}>
            <Icon name="send" /> {editing ? 'Save and approve' : 'Approve'}
          </button>
          {editing ? (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void run(async () => (await api.editDraft(d.id, edits()), setEditing(false)))}>
              Save
            </button>
          ) : (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          <Menu label={`More for draft ${d.id}`} title="Draft" items={[{ label: 'Discard…', danger: true, onSelect: () => void discard() }]} />
        </div>
      )}
    </div>
  );
}

function Leads({ list }: { list: Lead[] }) {
  if (!list.length) return <p className="muted small">No leads yet. New enquiries to sales@ and the agency's opportunities show up here.</p>;
  return (
    <ul className="cm-list">
      {list.map((l) => (
        <li key={l.id} className="cm-card cm-lead">
          <div className="cm-row">
            <strong className="cm-who">{l.name}</strong>
            <span className={`cm-chip cm-stage-${l.stage}`}>{l.stage}</span>
          </div>
          <span className="muted small">
            {[l.company, l.email, `from ${l.source}`, l.lastContact ? `last contact ${when(l.lastContact)}` : 'not contacted yet'].filter(Boolean).join(' · ')}
          </span>
          {l.nextStep && (
            <span className="small">
              <Icon name="arrow-right" /> {l.nextStep}
            </span>
          )}
          <label className="cm-stage small">
            Stage
            <select value={l.stage} onChange={(e) => void api.saveLead({ email: l.email, stage: e.target.value }).catch(() => undefined)}>
              {LEAD_STAGES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        </li>
      ))}
    </ul>
  );
}

function Settings({ c }: { c: CommsView }) {
  const repos = useStore((s) => s.repos);
  const [cap, setCap] = useState(String(c.settings.dailyOutreach));
  const floors = c.settings.floors;
  return (
    <div className="cm-list">
      <section className="cm-card">
        <strong>Auto-replies</strong>
        <p className="muted small">Replies from a mailbox with auto-replies on go out without your Approve. New emails always wait for you.</p>
        {c.settings.mailboxes.map((m) => (
          <label key={m.address} className="toggle block">
            <input type="checkbox" checked={m.autoReplies} onChange={(e) => void api.setCommsSettings({ mailboxes: [{ address: m.address, autoReplies: e.target.checked }] }).catch(() => undefined)} />
            <span>{m.address}</span>
          </label>
        ))}
      </section>
      <section className="cm-card">
        <strong>Floors with the mail tools</strong>
        <p className="muted small">Their agents can read the shared mailboxes and draft emails (sending still waits for you).</p>
        {repos.map((r) => (
          <label key={r.id} className="toggle block">
            <input type="checkbox" checked={floors.includes(r.id)} onChange={(e) => void api.setCommsSettings({ floors: e.target.checked ? [...floors, r.id] : floors.filter((f) => f !== r.id) }).catch(() => undefined)} />
            <span>
              Floor {r.floor} · {r.fullName.split('/')[1]}
            </span>
          </label>
        ))}
      </section>
      <section className="cm-card">
        <strong>Outreach</strong>
        <p className="muted small">
          Today {c.outreach.today} of {c.outreach.cap} (warming up: 20 a day the first week, doubling weekly). Every outreach email has an unsubscribe line; {c.suppressed} address{c.suppressed === 1 ? '' : 'es'} asked not to be emailed. No bought lists.
        </p>
        <label className="cm-stage small">
          Most a day once warmed up
          <input className="cm-input cm-num" inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value)} onBlur={() => Number(cap) !== c.settings.dailyOutreach && void api.setCommsSettings({ dailyOutreach: Number(cap) }).catch(() => setCap(String(c.settings.dailyOutreach)))} />
        </label>
      </section>
    </div>
  );
}
