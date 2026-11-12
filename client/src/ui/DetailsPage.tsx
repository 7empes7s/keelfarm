import { useState, type ReactNode } from 'react';
import { useStore, type Agent } from '../store';
import { Icon } from './Icon';
import type { IconName } from './icons';
import { Markdown } from './Markdown';
import { checkTally, groupChecks, type ChipTone, type StatusRow } from './detailsRules';
import type { QaCheck } from '../../../shared/types';
import './charter.css'; // the stat cards (docs/design.md)
import './details.css';

// The details pages' parts (#155): a header card, sections as cards, stat tiles that tap through to their section,
// a QA report's checks as disclosure cards, status rows and real buttons. CardView.tsx and pocket's Approvals use
// them so every details page looks the same; the rules are pure in detailsRules.ts.

const GLYPH: Record<QaCheck['result'], IconName | null> = { pass: 'check', fail: 'x', skip: null };

/** The card at the top: an eyebrow (PR #12 · floor), the title wrapping to two lines, chips, then who and when. */
export function DetailsHeader({ eyebrow, title, chips, children }: { eyebrow: ReactNode; title: string; chips?: ReactNode; children?: ReactNode }) {
  return (
    <header className="dp-card dp-head">
      <div className="dp-eyebrow">{eyebrow}</div>
      <h3 className="dp-title" title={title}>
        {title}
      </h3>
      {chips && <div className="dp-chips">{chips}</div>}
      {children}
    </header>
  );
}

export function Chip({ tone = 'plain', children }: { tone?: ChipTone; children: ReactNode }) {
  return <span className={`dp-chip dp-chip-${tone}`}>{children}</span>;
}

/** An agent as a chip that opens their window. */
export function AgentChip({ agent, role }: { agent: Agent; role: string }) {
  return (
    <button type="button" className="dp-agent" onClick={() => useStore.getState().openOverlay({ kind: 'terminal', agentId: agent.id })} aria-label={`${role} ${agent.name}: open their window`}>
      <span className="dot" style={{ background: agent.color }} aria-hidden />
      <span className="dp-agent-role">{role}</span> <b>{agent.name}</b>
    </button>
  );
}

/** A section as a card with a heading. `id` lets a stat tile scroll to it. */
export function Section({ id, title, tone, className, children }: { id?: string; title: ReactNode; tone?: 'bad' | 'warn'; className?: string; children: ReactNode }) {
  return (
    <section id={id} className={`dp-card dp-section${tone ? ` dp-${tone}` : ''}${className ? ` ${className}` : ''}`}>
      <h4 className="dp-h">{title}</h4>
      {children}
    </section>
  );
}

/** One number in the insight strip (the Charter tab's stat card); tapping it scrolls to what it counts. */
export function Stat({ title, value, note, tone, to }: { title: string; value: ReactNode; note?: string; tone?: 'warn' | 'good'; to?: string }) {
  const go = () => document.getElementById(to ?? '')?.scrollIntoView({ block: 'start' });
  return (
    <button type="button" className={`cs-stat${tone ? ` cs-${tone}` : ''}`} onClick={go} disabled={!to}>
      <span className="cs-stat-title">{title}</span>
      <span className="cs-stat-value">
        {value}
        {note && <small>{note}</small>}
      </span>
    </button>
  );
}

/** Checks passed out of all of them, as a ring. */
function Ring({ done, total }: { done: number; total: number }) {
  const share = total ? done / total : 0;
  const c = 2 * Math.PI * 7;
  return (
    <svg className="dp-ring" viewBox="0 0 18 18" aria-hidden>
      <circle cx="9" cy="9" r="7" className="dp-ring-track" />
      <circle cx="9" cy="9" r="7" className="dp-ring-done" strokeDasharray={`${share * c} ${c}`} transform="rotate(-90 9 9)" />
    </svg>
  );
}

export function StatStrip({ children }: { children: ReactNode }) {
  return <div className="cs-grid dp-strip">{children}</div>;
}

/** The QA checks stat: passed out of all, with its ring. */
export function ChecksStat({ checks, to, empty = 'no report yet' }: { checks: readonly QaCheck[]; to: string; empty?: string }) {
  const t = checkTally(checks);
  return (
    <Stat
      title="Checks"
      to={to}
      tone={t.failed ? 'warn' : t.total ? 'good' : undefined}
      value={
        <span className="dp-ring-value">
          <Ring done={t.passed} total={t.total} />
          {t.passed}/{t.total}
        </span>
      }
      note={t.total ? `${t.failed} failed · ${t.skipped} skipped` : empty}
    />
  );
}

/** A check as a card: its glyph and title, tapped open for the details (an iOS disclosure row). */
function CheckCard({ check, open: start }: { check: QaCheck; open: boolean }) {
  const [open, setOpen] = useState(start);
  return (
    <li className={`dp-check dp-check-${check.result}`}>
      <button type="button" className="dp-check-row" aria-expanded={open} onClick={() => setOpen(!open)} disabled={!check.details}>
        <b className="dp-glyph" aria-label={check.result === 'pass' ? 'passed' : check.result === 'fail' ? 'failed' : 'skipped'}>
          {GLYPH[check.result] ? <Icon name={GLYPH[check.result]!} /> : '–'}
        </b>
        <span className="dp-check-name">{check.name}</span>
        {check.details && <span className="dp-chev" aria-hidden />}
      </button>
      {open && check.details && <div className="dp-check-details">{check.details}</div>}
    </li>
  );
}

/** A QA report's checks: charter violations as red cards naming the standard, then Failed → Skipped → Passed. */
export function ChecksList({ checks }: { checks: readonly QaCheck[] }) {
  const { charter, groups } = groupChecks(checks);
  return (
    <>
      {charter.map((v, i) => (
        <div key={i} className="dp-charter" role="note">
          <b>Breaks a charter standard</b>
          <div className="dp-charter-standard">{v.standard}</div>
          {v.why && <div className="small">{v.why}</div>}
        </div>
      ))}
      {groups.map((g) => (
        <div key={g.id} className="dp-group">
          <div className="dp-group-h">
            {g.label} · {g.rows.length}
          </div>
          <ul className="dp-checks">
            {g.rows.map((r, i) => (
              <CheckCard key={`${r.name}:${i}`} check={r} open={r.open} />
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

/** QA's verdict in a line or two, and when it failed, what has to change. */
export function Verdict({ summary, fix, failed }: { summary: string | null; fix?: string | null; failed: boolean }) {
  return (
    <>
      {summary && <Markdown text={summary} className="dp-verdict" />}
      {failed && fix && (
        <div className="dp-fix" role="note">
          <b>What has to change</b>
          <Markdown text={fix} />
        </div>
      )}
    </>
  );
}

/** Status rows: an icon in its state's colour, a label and a short note; a row with a link opens it. */
export function StatusRows({ rows }: { rows: StatusRow[] }) {
  return (
    <ul className="dp-rows">
      {rows.map((r) => {
        const inner = (
          <>
            <b className={`dp-row-icon dp-tone-${r.tone}`} aria-hidden>
              {r.icon ? <Icon name={r.icon} /> : '–'}
            </b>
            <span className="dp-row-main">
              <span className="dp-row-label">{r.label}</span>
              {r.detail && <span className="dp-row-detail">{r.detail}</span>}
            </span>
            {r.url && <Icon name="external-link" />}
          </>
        );
        return (
          <li key={r.key}>
            {r.url ? (
              <a className="dp-row" href={r.url} target="_blank" rel="noreferrer">
                {inner}
              </a>
            ) : (
              <div className="dp-row">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The page's actions as 44 px buttons, and a keyboard hint only a hardware keyboard and pointer see. */
export function Actions({ children, keys }: { children: ReactNode; keys?: ReactNode }) {
  return (
    <div className="dp-actions">
      <div className="dp-buttons">{children}</div>
      {keys && <div className="dp-keys muted small">{keys}</div>}
    </div>
  );
}

export function LinkButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="ds-btn" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}
