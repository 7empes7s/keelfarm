// One step of a checklist (#612): the tick (done or not), its details in light markdown, values to copy with one tap,
// the secret field (saved straight to Providers: the step shows only "saved · ends …ab12"), "Not needed" with a
// reason, and the manager's comments with a photo. Everything goes to the office, which sends the checklist back.
import { useRef, useState } from 'react';
import { api } from '../api';
import { attachmentProblem } from '../../../shared/files';
import type { Checklist, ChecklistStep } from '../../../shared/checklists';
import { copyText } from './clipboard';
import { uploadFile } from './chatUpload';
import { Icon } from './Icon';
import { Markdown } from './Markdown';
import { agoText } from './peekFacts';

const act = (c: Checklist, s: ChecklistStep, body: Parameters<typeof api.checklistStep>[2]) => api.checklistStep(c.id, s.id, body).catch(() => undefined);

function CopyBox({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="cl-copy">
      <div className="cl-copy-text">
        {label && <span className="cl-copy-label">{label}</span>}
        <code className="cl-copy-value">{value}</code>
      </div>
      <button
        type="button"
        className="btn btn-small"
        aria-label={`${copied ? 'Copied' : 'Copy'} ${label || 'the value'}`}
        onClick={() => void copyText(value).then((ok) => {
          setCopied(ok);
          if (ok) setTimeout(() => setCopied(false), 2000);
        })}
      >
        <Icon name={copied ? 'check' : 'copy'} /> {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function SecretField({ c, s }: { c: Checklist; s: ChecklistStep }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const secret = s.secret!;
  if (secret.saved)
    return (
      <p className="cl-secret-saved">
        <Icon name="key-round" /> {secret.label} saved · ends …{secret.saved.hint}
      </p>
    );
  return (
    <form
      className="cl-secret"
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim() || busy) return;
        setBusy(true);
        void api.checklistSecret(c.id, s.id, value).then(() => setValue(''), () => undefined).finally(() => setBusy(false));
      }}
    >
      <label className="cl-secret-label">
        <span>
          <Icon name="lock" /> {secret.label}
        </span>
        <input type="password" autoComplete="off" spellCheck={false} placeholder={`Paste ${secret.label.toLowerCase()}`} value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <button type="submit" className="btn btn-small btn-good" disabled={!value.trim() || busy}>
        <Icon name="save" /> {busy ? 'Saving…' : 'Save to Providers'}
      </button>
    </form>
  );
}

function NotNeeded({ c, s, onDone }: { c: Checklist; s: ChecklistStep; onDone: () => void }) {
  const [reason, setReason] = useState('');
  return (
    <form
      className="cl-inline"
      onSubmit={(e) => {
        e.preventDefault();
        void act(c, s, { action: 'skip', reason }).then(onDone);
      }}
    >
      <input type="text" placeholder="Why not? (optional)" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Why it's not needed" />
      <button type="submit" className="btn btn-small">Not needed</button>
      <button type="button" className="btn btn-small btn-ghost" onClick={onDone}>Cancel</button>
    </form>
  );
}

function Comment({ c, s, onDone }: { c: Checklist; s: ChecklistStep; onDone: () => void }) {
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<{ name: string; id?: string; error?: string } | null>(null);
  const pick = useRef<HTMLInputElement>(null);
  const attach = (file: File | undefined) => {
    if (!file) return;
    const problem = attachmentProblem([file]);
    if (problem) return setPhoto({ name: file.name, error: problem });
    setPhoto({ name: file.name });
    uploadFile(file, () => undefined).done.then((ref) => setPhoto({ name: file.name, id: ref.id }), (err: Error) => setPhoto({ name: file.name, error: err.message }));
  };
  const uploading = !!photo && !photo.id && !photo.error;
  return (
    <form
      className="cl-comment-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (uploading || (!text.trim() && !photo?.id)) return;
        void act(c, s, { action: 'comment', text, fileId: photo?.id }).then(onDone);
      }}
    >
      <textarea rows={2} placeholder="What happened? The CEO reads it." value={text} onChange={(e) => setText(e.target.value)} aria-label="Comment" maxLength={1000} />
      {photo && <p className={`small ${photo.error ? 'cl-error' : 'muted'}`}>{photo.error ?? (photo.id ? `Photo: ${photo.name}` : `Uploading ${photo.name}…`)}</p>}
      <div className="cl-actions">
        <input ref={pick} type="file" accept="image/*" hidden onChange={(e) => attach(e.target.files?.[0])} />
        <button type="button" className="btn btn-small btn-ghost" onClick={() => pick.current?.click()}>
          <Icon name="camera" /> {photo?.id ? 'Change photo' : 'Add photo'}
        </button>
        <button type="button" className="btn btn-small btn-ghost" onClick={onDone}>Cancel</button>
        <button type="submit" className="btn btn-small" disabled={uploading || (!text.trim() && !photo?.id)}>
          <Icon name="send" /> Send
        </button>
      </div>
    </form>
  );
}

export function StepRow({ c, s, n }: { c: Checklist; s: ChecklistStep; n: number }) {
  const [open, setOpen] = useState(s.state === 'open');
  const [form, setForm] = useState<'skip' | 'comment' | null>(null);
  const done = s.state !== 'open';
  const now = Date.now();
  return (
    <li className={`cl-step cl-step-${s.state}`} data-step={s.id}>
      <div className="cl-step-head">
        <button
          type="button"
          className="cl-tick"
          aria-pressed={s.state === 'done'}
          aria-label={s.state === 'open' ? `Mark step ${n} done` : `Open step ${n} again`}
          onClick={() => void act(c, s, { action: s.state === 'open' ? 'tick' : 'untick' })}
        >
          <Icon name={s.state === 'done' ? 'check' : s.state === 'skipped' ? 'ban' : 'square'} />
        </button>
        <button type="button" className="cl-step-title" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="cl-step-n">{n}.</span> <span className="cl-step-name">{s.title}</span>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} />
        </button>
      </div>
      {s.state === 'skipped' && <p className="cl-note small muted">Not needed{s.reason ? `: ${s.reason}` : ''}</p>}
      {open && (
        <div className="cl-step-body">
          {s.details && <Markdown text={s.details} className="cl-details" />}
          {s.copy.map((x, i) => (
            <CopyBox key={i} label={x.label} value={x.value} />
          ))}
          {s.secret && <SecretField c={c} s={s} />}
          {s.comments.length > 0 && (
            <ul className="cl-comments" aria-label="Comments">
              {s.comments.map((m) => (
                <li key={m.id} className="cl-comment">
                  {m.text && <p>{m.text}</p>}
                  {m.fileId && (
                    <a href={`/api/files/${m.fileId}`} target="_blank" rel="noopener">
                      <img className="cl-photo" src={`/api/files/${m.fileId}`} alt="Photo with the comment" loading="lazy" />
                    </a>
                  )}
                  <span className="small muted">{agoText(m.at, now)}</span>
                </li>
              ))}
            </ul>
          )}
          {form === 'skip' ? <NotNeeded c={c} s={s} onDone={() => setForm(null)} />
            : form === 'comment' ? <Comment c={c} s={s} onDone={() => setForm(null)} />
            : (
              <div className="cl-actions">
                {!done && (
                  <button type="button" className="btn btn-small btn-ghost" onClick={() => setForm('skip')}>
                    <Icon name="ban" /> Not needed
                  </button>
                )}
                <button type="button" className="btn btn-small btn-ghost" onClick={() => setForm('comment')}>
                  <Icon name="message-circle" /> Comment
                </button>
              </div>
            )}
        </div>
      )}
    </li>
  );
}
