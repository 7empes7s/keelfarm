// Who a chat item is really from (#679): the header of anything the CEO didn't write itself (the Researcher, IT, a
// background job, an agent's question) and the research job's card. The rules are pure, in shared/chatSender.ts.
import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import type { ChatOrigin, PhoneMessage } from '../../../shared/types';
import { askerName, briefSummary, researchState, senderLook, type SenderLook } from '../../../shared/chatSender';
import { RESEARCHER_NAME } from '../../../shared/research';
import { speechText } from '../../../shared/speech';
import { excerpt } from '../../../shared/chat';
import { Icon } from './Icon';
import type { IconName } from './icons';
import './chatSender.css';

/** A sender's header look, with this office's names. */
export function useSenderLook(m: PhoneMessage | undefined, origin: ChatOrigin | 'manager', ceoName: string): SenderLook | null {
  const it = useStore((s) => s.settings.itDept.name);
  if (!m || origin === 'manager' || origin === 'ceo') return null;
  return senderLook(origin, { ceo: ceoName, researcher: RESEARCHER_NAME, it, agent: askerName(m.text) });
}

/** The glyph, the name and the role: "🔭 Sage · Research". */
export function SenderHead({ look, children }: { look: SenderLook; children?: ReactNode }) {
  return (
    <span className="src-head">
      <span className={`src-glyph src-glyph-${look.tone}`} aria-hidden>
        <Icon name={look.icon as IconName} />
      </span>
      <span className="src-name">{look.name}</span>
      {look.role && <span className="src-role">· {look.role}</span>}
      {children}
    </span>
  );
}

const STATE_LABEL = { queued: 'Queued', running: 'Running', done: 'Done', partial: 'Partial' } as const;

/** Minutes since `at`, ticking every 30 s while shown. */
function useMinutesSince(at: number | undefined, live: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [live]);
  return at ? Math.max(0, Math.round((now - at) / 60_000)) : 0;
}

/**
 * A research job's card: the topic, a Queued / Running / Done chip, elapsed (live while it runs), cost, a few lines of
 * the brief and Open brief (its artifact full-screen, else the whole brief below). Queued and running cards are the
 * same message, updated in place; the brief replaces it.
 */
export function ResearchCard({ m, onOpen, children }: { m: PhoneMessage; onOpen: (artifactId: string) => void; children: (open: boolean) => ReactNode }) {
  const r = m.research!;
  const state = researchState(r);
  const going = state === 'queued' || state === 'running';
  const since = useMinutesSince(r.startedAt, state === 'running');
  const [open, setOpen] = useState(false);
  const meta = [
    state === 'running' ? `${since} min` : !going && r.minutes !== undefined ? `${r.minutes} min` : null,
    r.usd !== undefined ? `$${r.usd.toFixed(2)}` : null,
    going && r.budget ? `up to ${r.budget} min` : null,
  ].filter(Boolean);
  const summary = going ? (state === 'queued' ? 'Waiting its turn at the Researcher’s desk.' : 'Reading and comparing sources. The brief lands here.') : excerpt(speechText(briefSummary(m.text), 600), 320);
  const artifact = m.artifacts?.[0];
  return (
    <div className="research-card">
      <div className="research-card-top">
        <span className="research-card-topic">{r.topic}</span>
        <span className={`research-chip research-chip-${state}`}>
          {state === 'running' && <Icon name="loader-circle" className="research-spin" />}
          {STATE_LABEL[state]}
        </span>
      </div>
      {meta.length > 0 && <div className="research-card-meta">{meta.join(' · ')}</div>}
      {summary && <p className="research-card-summary">{summary}</p>}
      {!going && (
        <button type="button" className="btn ds-btn research-card-open" aria-expanded={artifact ? undefined : open} onClick={() => (artifact ? onOpen(artifact.id) : setOpen(!open))}>
          <Icon name="file-text" /> {artifact || !open ? 'Open brief' : 'Hide brief'}
        </button>
      )}
      {children(open)}
    </div>
  );
}
