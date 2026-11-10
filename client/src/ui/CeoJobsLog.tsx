// CEO → Sessions → CEO jobs (#332): one row per CEO job from the session history, newest first, filtered by kind and
// model: what started it, how it ran, what came of it, and its redo's links. A row opens its transcript; a job that ran
// on another model than the CEO's has Redo on Opus. Loaded on demand like the History tab, reloaded on `history` events.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { fmtUsd } from '../ops';
import { useStore } from '../store';
import { ceoLogRows, REPLY_LABELS, toolsLine, type CeoLogFilter } from '../../../shared/ceoJobLog';
import { modelLabel } from '../../../shared/models';
import { utcDay, type HistoryEntry } from '../../../shared/history';
import type { CeoJobKind } from '../../../shared/types';
import { askRedo, JOB_KIND_NAMES, redoable, useCeoModel } from './CeoJobRedo';
import { Icon } from './Icon';

const KINDS: [CeoJobKind, string][] = [['review', 'Reviews'], ['followup', 'Follow-ups'], ['triage', 'Triage'], ['chat', 'Chat'], ['plan', 'Plans'], ['research', 'Research'], ['onboard', 'Onboarding'], ['changes', 'Your changes']];
const time = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const tokens = (n: number | null) => (n === null ? '—' : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

export function CeoJobsLog({ onOpen }: { onOpen: (id: string) => void }) {
  const seq = useStore((s) => s.historySeq);
  const ceo = useCeoModel();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<CeoLogFilter>({ kind: '', model: '' });

  const load = useCallback((offset: number) => {
    setLoading(true);
    api
      .history({ kind: 'ceo', offset, limit: 100 })
      .then(
        (p) => {
          setEntries((now) => (offset ? [...now, ...p.entries] : p.entries));
          setMore(p.more);
        },
        () => undefined, // api() already toasted the error
      )
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => load(0), [load, seq]);

  const rows = ceoLogRows(entries, filter);
  const models = [...new Set(entries.filter((e) => e.ceo).map((e) => e.model))].sort();
  return (
    <div className="history">
      <div className="history-filters">
        <select aria-label="Job kind" value={filter.kind} onChange={(e) => setFilter({ ...filter, kind: e.target.value as CeoJobKind | '' })}>
          <option value="">Every kind of job</option>
          {KINDS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <select aria-label="Model" value={filter.model} onChange={(e) => setFilter({ ...filter, model: e.target.value })}>
          <option value="">Every model</option>
          {models.map((m) => (
            <option key={m} value={m}>
              {modelLabel(m)}
            </option>
          ))}
        </select>
      </div>
      <p className="muted small" aria-live="polite">
        {loading && !entries.length ? 'Reading the log…' : rows.length ? `${rows.length} job${rows.length === 1 ? '' : 's'} · times in UTC · kept as long as Sessions` : 'No CEO jobs logged yet.'}
      </p>
      <ul className="history-list">
        {rows.map(({ entry: e, redoneBy }) => {
          const j = e.ceo;
          const tools = toolsLine(j.tools);
          return (
            <li key={e.id} className="ceo-log-item">
              <button className="history-row ceo-log-row" onClick={() => onOpen(e.id)}>
                <span className="history-when">
                  {utcDay(e.at).slice(5)} {time(e.startedAt)}
                </span>
                <span className="history-what">
                  <b>
                    {KINDS.find(([k]) => k === j.kind)?.[1] ?? j.kind} · job #{j.job}
                  </b>
                  <span className="small">{j.trigger}</span>
                  <span className="muted small">
                    {[modelLabel(e.model), e.effort && `${e.effort} effort`, j.fresh ? 'fresh' : 'resumed', `${tokens(j.inputTokens)} in / ${tokens(j.outputTokens)} out`, e.usd > 0 && fmtUsd(e.usd), `${Math.max(0, Math.round((e.at - e.startedAt) / 60_000))}m`].filter(Boolean).join(' · ')}
                  </span>
                  {(tools || j.issues > 0) && <span className="muted small">{[tools, j.issues > 0 && `${j.issues} issue${j.issues === 1 ? '' : 's'} filed`].filter(Boolean).join(' · ')}</span>}
                  {(j.redoOf !== undefined || redoneBy !== null) && <span className="small">{j.redoOf !== undefined ? `Redo of job #${j.redoOf}` : `Redone on ${ceo.family} as job #${redoneBy}`}</span>}
                </span>
                <span className={`chip history-outcome ${j.reply === 'failed' ? 'history-bad' : j.reply === 'replied' ? 'history-good' : ''}`}>{REPLY_LABELS[j.reply]}</span>
              </button>
              {redoable({ kind: j.kind, model: e.model }, redoneBy !== null, ceo.model) && (
                <button type="button" className="btn btn-small ceo-log-redo" aria-label={`Redo ${JOB_KIND_NAMES[j.kind]} job #${j.job} on ${ceo.family}`} onClick={() => void askRedo({ job: j.job, kind: j.kind, model: e.model, usd: e.usd }, ceo)}>
                  <Icon name="refresh-cw" /> Redo on {ceo.family}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {more && (
        <button className="btn btn-small" disabled={loading} onClick={() => load(entries.length)}>
          Show older jobs
        </button>
      )}
    </div>
  );
}
