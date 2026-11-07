import type { ReactNode } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { PRACTICES_OFF, type PracticeOverrides, type Practices } from '../../../shared/practices';
import { holdReason } from '../../../shared/conflicts';
import type { RepoView } from '../../../shared/types';
import { Icon } from './Icon';
import type { IconName } from './icons';

// The version-control practices (#24): Settings → Every project's defaults, each floor's overrides (Floors tab), the
// floor's leases, held-back issues and hot files, and the lease chip on a held issue's Kanban card. Every switch is
// off until the lab proves it; a proven variant becomes every project's default from its experiment's results.

type Switch = 'upToDate' | 'leases' | 'autoRebase' | 'busyFiles';

const SWITCHES: { key: Switch; icon: IconName; label: string; hint: string }[] = [
  { key: 'upToDate', icon: 'git-merge', label: 'Up to date before merge', hint: "Before auto-merge, merge the base into the PR and wait for CI on that result; a PR that only fails then goes back as a conflict" },
  { key: 'leases', icon: 'lock', label: 'File leases', hint: "Agents declare the files they'll touch; issues overlapping work in flight wait (at most 45 minutes)" },
  { key: 'autoRebase', icon: 'repeat', label: 'Auto-rebase', hint: 'A PR waiting for QA or its merge that conflicts after main moves goes straight to a developer to update' },
  { key: 'busyFiles', icon: 'flame', label: 'Conflict-aware scheduling', hint: "Issues touching files 2+ PRs or builds already touch wait for one that doesn't (nobody idles over it; a priority label skips the wait); the PR on the hottest files merges first. Area lines in the floor playbook (area chat: client/src/ui/Chat*) help predict files" },
];

/** api() already toasted the error. */
const attempt = (fn: () => Promise<unknown>) => fn().catch(() => undefined);

const files = (text: string) => [...new Set(text.split(/[\n,]+/).map((f) => f.trim()).filter(Boolean))];

/** The switches and lists, as Every project's (plain values) or a floor's (each one can inherit). */
function Fields({ value, inherit, set }: { value: Practices; inherit?: { from: Practices; own: PracticeOverrides }; set: (patch: Record<string, unknown>) => void }) {
  const own = inherit?.own;
  const listField = (key: 'generated' | 'appendOnly', label: string, placeholder: string) => (
    <label className="field">
      <span>
        {label}
        {own && own[key] === undefined && <span className="muted small"> (Every project's)</span>}
      </span>
      <textarea
        key={value[key].join('\n')}
        rows={2}
        defaultValue={value[key].join('\n')}
        placeholder={placeholder}
        onBlur={(e) => {
          const next = files(e.target.value);
          if (next.join('\n') !== value[key].join('\n')) set({ [key]: next });
        }}
      />
    </label>
  );
  return (
    <>
      <div className={inherit ? undefined : 'ds-switches'}>
        {SWITCHES.map((s) =>
          inherit ? (
            <label key={s.key} className="field" title={s.hint}>
              <span>
                <Icon name={s.icon} /> {s.label}
              </span>
              <select
                aria-label={s.label}
                value={own?.[s.key] === undefined ? '' : own[s.key] ? 'on' : 'off'}
                onChange={(e) => set({ [s.key]: e.target.value === '' ? null : e.target.value === 'on' })}
              >
                <option value="">Every project's ({inherit.from[s.key] ? 'on' : 'off'})</option>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </label>
          ) : (
            <label key={s.key} className="toggle" title={s.hint}>
              <input type="checkbox" checked={value[s.key]} onChange={(e) => set({ [s.key]: e.target.checked })} /> <Icon name={s.icon} /> {s.label}
            </label>
          ),
        )}
      </div>
      {listField('generated', 'Generated files: regenerate, never hand-merge', 'docs/coverage.md')}
      {listField('appendOnly', 'Append-only files: keep both sides on a conflict', 'STATE.md')}
      <label className="field">
        <span>
          PR budget in lines, 0 for none
          {own && own.diffBudget === undefined && <span className="muted small"> (Every project's)</span>}
        </span>
        <input
          key={value.diffBudget}
          type="number"
          min={0}
          defaultValue={value.diffBudget || ''}
          placeholder="none"
          onBlur={(e) => Number(e.target.value || 0) !== value.diffBudget && set({ diffBudget: Number(e.target.value || 0) })}
        />
      </label>
    </>
  );
}

/** Settings → Every project: the defaults every floor inherits unless it overrides them. */
export function EveryProjectCard() {
  const every = useStore((s) => s.settings.everyProject);
  const set = (patch: Partial<typeof every>) => void attempt(() => api.updateSettings({ everyProject: { ...every, ...patch } }));
  return (
    <div className="card">
      <h3>
        <Icon name="hard-hat" /> Every project
      </h3>
      <p className="muted small">
        What every floor runs with unless it overrides it (Floors tab). Each practice is off until an experiment proves it: Mission control → Experiments has a starter for each, and a
        proven variant becomes the default here with one tap. The playbook for every project is in the CEO tab's project briefs; skills for everyone are under Tools &amp; skills → Everyone.
      </p>
      <Fields value={every.practices} set={(p) => set({ practices: { ...every.practices, ...p } as Practices })} />
    </div>
  );
}

/** A floor's practices in the Floors tab: its overrides, and what leases see on it. */
export function FloorPractices({ repo }: { repo: RepoView }) {
  const every = useStore((s) => s.settings.everyProject.practices);
  const value = repo.practices ?? PRACTICES_OFF;
  const on = SWITCHES.filter((s) => value[s.key]).map((s) => s.label);
  const leases = repo.leases ?? [];
  const holds = repo.leaseHolds ?? [];
  const hot = repo.hotFiles ?? [];
  return (
    <details className="small preview-details">
      <summary>
        <Icon name="compass" /> Version control · {on.length ? on.join(', ') : 'office defaults'}
      </summary>
      <Fields value={value} inherit={{ from: every, own: repo.practiceOverrides ?? {} }} set={(practices) => void attempt(() => api.updateRepo(repo.id, { practices }))} />
      {leases.length > 0 && (
        <div className="ds-row-meta">
          <Icon name="lock" /> Leases:{' '}
          {leases.map((l) => (
            <span key={l.issue} className="chip" title={l.files.join('\n')}>
              {l.issue > 0 ? `#${l.issue}` : `PR #${l.pr}`} · {l.files.length} file{l.files.length === 1 ? '' : 's'} ({l.source})
            </span>
          ))}
        </div>
      )}
      {holds.length > 0 && (
        <div className="ds-row-meta">
          <Icon name="pause" /> Held back:{' '}
          {holds.map((h) => (
            <span key={h.issue} className="chip" title={h.files.join('\n')}>
              #{h.issue} overlaps {h.by.issue > 0 ? `#${h.by.issue}` : `PR #${h.by.pr}`}
            </span>
          ))}
        </div>
      )}
      {hot.length > 0 && (
        <div className="ds-row-meta">
          <Icon name="flame" /> Hot files:{' '}
          {hot.map((f) => (
            <code key={f.path} title={`${f.conflicts} conflict fix${f.conflicts === 1 ? '' : 'es'}, score ${f.score}`}>
              {f.path}
            </code>
          )).reduce<ReactNode[]>((out, x, i) => (i ? [...out, ' ', x] : [x]), [])}
        </div>
      )}
    </details>
  );
}

/** On a backlog card: the issue waits because its files overlap work in flight. */
export function LeaseChip({ repo, issue }: { repo: RepoView; issue: number }) {
  const h = repo.leaseHolds?.find((x) => x.issue === issue);
  if (!h) return null;
  const busy = repo.practices?.busyFiles;
  const by = h.by.issue > 0 ? `#${h.by.issue}` : `PR #${h.by.pr}`;
  // Conflict-aware scheduling (#256) says which files; file leases keep their short chip.
  return busy ? (
    <span className="chip" title={`Both touch ${h.files.join(', ')}. It starts when no other ready issue avoids those files, or once ${by} is done.`}>
      <Icon name="flame" /> {holdReason(h)}
    </span>
  ) : (
    <span className="chip" title={`Waits for ${by}: both touch ${h.files.join(', ')}. It starts anyway after 45 minutes.`}>
      <Icon name="lock" /> waits for {by}
    </span>
  );
}
