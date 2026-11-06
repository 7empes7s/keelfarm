import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { fmtUsd } from '../ops';
import { useStore, type Overlay } from '../store';
import { kindLabel, OUTCOME_LABELS, utcDay, workLabel, type HistoryDetail, type HistoryEntry, type HistoryOutcome, type HistoryUsage, type TranscriptItem } from '../../../shared/history';
import './history.css';

// The console's 📜 History (#49): every session the office ran and every PR it merged, from the session history, loaded
// on demand (never in the snapshot) and reloaded when a `history` event says there's a new one. Filters by floor,
// agent, kind and outcome, a search, and a session opened with its summary and its transcript (tool calls collapsed).
// Also Settings' daily log card: where the log goes, how long transcripts are kept, and the disk they take.

const KINDS: [string, string][] = [
  ['', 'All kinds'],
  ['issue', 'Building an issue'],
  ['qa', 'QA'],
  ['fix', 'Fixes'],
  ['ceo', 'The CEO'],
  ['merge', 'Merges'],
];
const GOOD = new Set<HistoryOutcome>(['pr', 'commit', 'qa-pass', 'merged', 'ceo-acted', 'done']);
const BAD = new Set<HistoryOutcome>(['error', 'qa-fail', 'watchdog', 'limited', 'no-pr', 'no-commit']);
const tone = (o: HistoryOutcome) => (GOOD.has(o) ? 'history-good' : BAD.has(o) ? 'history-bad' : '');

const time = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const dayTitle = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const minutes = (e: HistoryEntry) => Math.max(0, Math.round((e.at - e.startedAt) / 60_000));
const bytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} kB`);

/** The History tab opened from an agent's desk or a PR: what it starts filtered to. */
export type HistoryFocus = NonNullable<Extract<Overlay, { kind: 'manager' }>['history']>;

/** Opens the console's History filtered to an agent, or to a floor's PR. */
const openHistory = (history: HistoryFocus) => useStore.getState().openOverlay({ kind: 'manager', tab: 'history', history });

/** The History button an agent's desk and a PR card show. */
export function HistoryButton({ focus, label }: { focus: HistoryFocus; label: string }) {
  return (
    <button className="btn btn-small btn-ghost" title={label} onClick={() => openHistory(focus)}>
      📜 History
    </button>
  );
}

export function HistoryTab({ focus }: { focus?: HistoryFocus }) {
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const seq = useStore((s) => s.historySeq);
  const [repoId, setRepoId] = useState(focus?.repoId ?? '');
  const [agent, setAgent] = useState(focus?.agent ?? '');
  const [pr, setPr] = useState<number | undefined>(focus?.pr);
  const [kind, setKind] = useState('');
  const [outcome, setOutcome] = useState('');
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(typed), 300);
    return () => clearTimeout(t);
  }, [typed]);

  const load = useCallback(
    (offset: number) => {
      setLoading(true);
      api
        .history({ repoId: repoId || undefined, agent: agent || undefined, pr, kind: kind || undefined, outcome: outcome || undefined, q: q || undefined, offset })
        .then(
          (p) => {
            setEntries((now) => (offset ? [...now, ...p.entries] : p.entries));
            setTotal(p.total);
          },
          () => undefined, // api() already toasted the error
        )
        .finally(() => setLoading(false));
    },
    [repoId, agent, pr, kind, outcome, q],
  );
  useEffect(() => load(0), [load, seq]);

  const repo = (id: string) => repos.find((r) => r.id === id);
  if (open) return <HistorySession id={open} back={() => setOpen(null)} />;

  const days: [string, HistoryEntry[]][] = [];
  for (const e of entries) {
    const d = utcDay(e.at);
    if (days.at(-1)?.[0] === d) days.at(-1)![1].push(e);
    else days.push([d, [e]]);
  }
  const team = Object.values(agents).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="history">
      <div className="history-filters">
        <input type="search" aria-label="Search titles and outcomes" placeholder="Search titles and outcomes" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <select aria-label="Floor" value={repoId} onChange={(e) => setRepoId(e.target.value)}>
          <option value="">All floors</option>
          {repos.map((r) => (
            <option key={r.id} value={r.id}>
              Floor {r.floor} · {r.fullName.split('/')[1]}
            </option>
          ))}
        </select>
        <select aria-label="Agent" value={agent} onChange={(e) => setAgent(e.target.value)}>
          <option value="">Everyone</option>
          {agent && !agents[agent] && <option value={agent}>{agent}</option>}
          {team.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <select aria-label="Outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          <option value="">Any outcome</option>
          {(Object.entries(OUTCOME_LABELS) as [HistoryOutcome, string][]).map(([k, label]) => (
            <option key={k} value={k}>
              {label[0].toUpperCase() + label.slice(1)}
            </option>
          ))}
        </select>
        {pr !== undefined && (
          <button className="chip history-chip" title="Show every PR" onClick={() => setPr(undefined)}>
            PR #{pr} ✕
          </button>
        )}
      </div>
      <p className="muted small" aria-live="polite">
        {loading && !entries.length ? 'Reading the history…' : total ? `${total} session${total === 1 ? '' : 's'} · times in UTC` : 'No sessions match. Every session the office runs is written down here when it ends.'}
      </p>
      {days.map(([day, list]) => (
        <section key={day} aria-label={dayTitle(day)}>
          <h3 className="history-day">{dayTitle(day)}</h3>
          <ul className="history-list">
            {list.map((e) => (
              <li key={e.id} style={{ ['--accent' as string]: repo(e.repoId)?.color ?? 'var(--ds-line-strong)' }}>
                <button className="history-row" onClick={() => setOpen(e.id)}>
                  <span className="history-when">{e.kind === 'merge' ? time(e.at) : `${time(e.startedAt)}–${time(e.at)}`}</span>
                  <span className="history-what">
                    <b>{workLabel(e)}</b>
                    <span className="muted small">
                      {e.agent} · {kindLabel(e.kind)}
                      {e.floor !== null ? ` · floor ${e.floor}` : ''}
                      {e.kind !== 'merge' ? ` · ${minutes(e)}m` : ''}
                      {e.usd > 0 ? ` · ${fmtUsd(e.usd)}` : ''}
                    </span>
                  </span>
                  <span className={`chip history-outcome ${tone(e.outcome)}`}>{OUTCOME_LABELS[e.outcome]}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {entries.length < total && (
        <button className="btn btn-small" disabled={loading} onClick={() => load(entries.length)}>
          Show older sessions
        </button>
      )}
    </div>
  );
}

/** One session: its summary, then its transcript with tool calls and results collapsed. */
function HistorySession({ id, back }: { id: string; back: () => void }) {
  const repos = useStore((s) => s.repos);
  const [detail, setDetail] = useState<HistoryDetail | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api.historyEntry(id).then(setDetail, () => setFailed(true));
  }, [id]);
  const e = detail?.entry;
  const base = e?.repo ? `https://github.com/${e.repo}` : null;
  return (
    <div className="history">
      <button className="btn btn-small btn-ghost" onClick={back}>
        ← All sessions
      </button>
      {!e ? (
        <p className="muted small">{failed ? 'This session is no longer in the history.' : 'Opening the session…'}</p>
      ) : (
        <>
          <div className="card history-summary" style={{ ['--accent' as string]: repos.find((r) => r.id === e.repoId)?.color ?? 'var(--ds-line-strong)' }}>
            <h3>{workLabel(e)}</h3>
            <p>
              <span className={`chip history-outcome ${tone(e.outcome)}`}>{OUTCOME_LABELS[e.outcome]}</span> {e.note && <span>{e.note}</span>}
            </p>
            <dl className="history-facts small">
              <dt>When</dt>
              <dd>
                {utcDay(e.at)} {e.kind === 'merge' ? time(e.at) : `${time(e.startedAt)}–${time(e.at)} (${minutes(e)} min)`} UTC
              </dd>
              <dt>Who</dt>
              <dd>
                {e.agent} · {kindLabel(e.kind)}
              </dd>
              <dt>Where</dt>
              <dd>
                {e.repo ? `${e.repo}${e.floor !== null ? ` (floor ${e.floor})` : ''}` : 'The company'}
                {base && e.issue !== null && (
                  <>
                    {' · '}
                    <a href={`${base}/issues/${e.issue}`} target="_blank" rel="noreferrer">
                      issue #{e.issue} ↗
                    </a>
                  </>
                )}
                {base && e.pr !== null && (
                  <>
                    {' · '}
                    <a href={`${base}/pull/${e.pr}`} target="_blank" rel="noreferrer">
                      PR #{e.pr} ↗
                    </a>
                  </>
                )}
              </dd>
              {e.kind !== 'merge' && (
                <>
                  <dt>Ran</dt>
                  <dd>{[e.model, e.effort && `${e.effort} effort`, e.usd > 0 && fmtUsd(e.usd), e.tokens && `${e.tokens.toLocaleString()} tokens`].filter(Boolean).join(' · ') || '—'}</dd>
                </>
              )}
              {e.sessionId && (
                <>
                  <dt>Session</dt>
                  <dd>
                    <code>{e.sessionId}</code>
                  </dd>
                </>
              )}
            </dl>
          </div>
          {detail.transcript ? (
            <Transcript items={detail.transcript} cut={detail.cut} />
          ) : (
            e.kind !== 'merge' && <p className="muted small">No transcript was kept for this session: only Claude Code sessions on this computer leave one.</p>
          )}
        </>
      )}
    </div>
  );
}

function Transcript({ items, cut }: { items: TranscriptItem[]; cut: boolean }) {
  return (
    <section aria-label="Transcript">
      <h3 className="history-day">Transcript</h3>
      <ol className="history-transcript">
        {items.map((it, i) => (
          <li key={i} className={`history-item history-${it.role}`}>
            {it.role === 'user' || it.role === 'assistant' ? (
              <>
                <span className="history-who small">{it.role === 'user' ? 'Prompt' : 'Claude'}</span>
                <div className="history-text">{it.text}</div>
              </>
            ) : (
              <details>
                <summary>
                  <span className="history-who small">{it.role === 'tool' ? `🔧 ${it.tool}` : it.role === 'error' ? '⚠️ Error' : '↳ Result'}</span>
                  <span className="history-peek">{it.text.split('\n')[0]}</span>
                </summary>
                <pre className="history-text">{it.text}</pre>
              </details>
            )}
          </li>
        ))}
      </ol>
      {cut && <p className="muted small">The transcript goes on: only its first {items.length} steps are shown.</p>}
    </section>
  );
}

/** Settings → Daily log & history: the log's folder, how long transcripts are kept, and the disk they take. */
export function HistorySettings() {
  const settings = useStore((s) => s.settings);
  const [usage, setUsage] = useState<HistoryUsage | null>(null);
  useEffect(() => {
    api.historyUsage().then(setUsage, () => undefined);
  }, [settings.dailyLogDir, settings.historyDays]);
  const set = (p: Parameters<typeof api.updateSettings>[0]) => void api.updateSettings(p).catch(() => undefined); // api() already toasted the error
  return (
    <div className="card">
      <h3>📜 Daily log & history</h3>
      <p className="muted small">After every session, the office adds an entry to the day's log file and keeps a copy of the session's transcript, so it outlives Claude Code's own cleanup.</p>
      <label className="field">
        <span>Daily log folder (empty: the machine's /opt/ai-vault/daily if it has one, else the office's own)</span>
        <input key={settings.dailyLogDir} defaultValue={settings.dailyLogDir} placeholder={usage?.dailyDir ?? ''} onBlur={(e) => e.target.value.trim() !== settings.dailyLogDir && set({ dailyLogDir: e.target.value })} />
      </label>
      <label className="field">
        <span>Keep transcripts for (days, 0 = forever)</span>
        <input key={settings.historyDays} type="number" min={0} max={3650} defaultValue={settings.historyDays} onBlur={(e) => e.target.value !== '' && Number(e.target.value) !== settings.historyDays && set({ historyDays: Number(e.target.value) })} />
      </label>
      <details className="small">
        <summary>Details</summary>
        {usage ? (
          <p className="small">
            Writing to <code>{usage.dailyDir}</code>. {usage.sessions} session{usage.sessions === 1 ? '' : 's'} in the history; {usage.files} transcript{usage.files === 1 ? '' : 's'} take {bytes(usage.bytes)} in <code>{usage.historyDir}</code>.
          </p>
        ) : (
          <p className="muted small">Measuring the history…</p>
        )}
      </details>
    </div>
  );
}
