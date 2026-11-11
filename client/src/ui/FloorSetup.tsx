// The setup advisor on screen (#366): a floor's use case (the office's guess, changed in one tap), its setup gaps as
// cards with the recommended action first and Not now, the recommended setup for its kind of project, and the new
// floor's checklist sheet (SetupChecklist, mounted once in App.tsx). Rules are in shared/setup.ts and shared/useCases.ts.
import { useState } from 'react';
import { create } from 'zustand';
import { api } from '../api';
import { useStore } from '../store';
import { USE_CASES, caseDef } from '../../../shared/useCases';
import type { FloorSetupView, RepoView, SetupAction, SetupGap, SetupSheet, UseCase } from '../../../shared/types';
import { go } from './goTo';
import { Icon } from './Icon';
import type { IconName } from './icons';
import { Sheet } from './Sheet';
import './floorSetup.css';

/** The guide Settings → Guides shows (null: the list). */
export const useGuide = create<{ open: UseCase | null }>(() => ({ open: null }));

/** A floor not guessed yet: the server leaves its empty setup out of the snapshot. */
const NOT_GUESSED: FloorSetupView = { useCase: null, guessed: false, guessWhy: '', gaps: [], snoozed: 0, review: false };

export const caseIcon = (u: UseCase) => caseDef(u).icon as IconName;

/** Where an action's sheet is: the exact section, with the floor where it has one. */
function openSheet(sheet: SetupSheet, repo: RepoView, gap: SetupGap, agentId?: string) {
  switch (sheet) {
    case 'providers':
    case 'accounts':
    case 'tools':
      return go({ kind: 'section', section: sheet });
    case 'terminal':
      return agentId && go({ kind: 'overlay', overlay: { kind: 'terminal', agentId } });
    case 'guide':
      useGuide.setState({ open: repo.setup?.useCase ?? null });
      return go({ kind: 'section', section: 'guides' });
    case 'floor': // the QA brief is under the CEO's project briefs; the preview on the floor's card
      return go({ kind: 'section', section: gap.id === 'qa-brief' ? 'ceo' : 'floors', repoId: repo.id });
  }
}

async function run(repo: RepoView, gap: SetupGap, a: SetupAction, i: number) {
  if ('open' in a) return openSheet(a.open, repo, gap, a.agentId);
  await api.applySetup(repo.id, gap.id, i).catch(() => undefined); // errors are toasts
}

/** One gap: what's missing and why, the recommended action highlighted, the others, Not now. */
function GapCard({ repo, gap, onAct }: { repo: RepoView; gap: SetupGap; onAct?: (a: SetupAction) => void }) {
  const [busy, setBusy] = useState(false);
  const act = (a: SetupAction, i: number) => {
    setBusy(true);
    onAct?.(a);
    void run(repo, gap, a, i).finally(() => setBusy(false));
  };
  return (
    <div className={`fs-gap ${gap.blocks?.length ? 'fs-gap-blocks' : ''}`}>
      <div className="fs-gap-text">
        <b>{gap.title}</b>
        <span className="ds-row-meta">{gap.why}</span>
      </div>
      <div className="fs-gap-actions">
        {gap.actions.map((a, i) => (
          <button key={a.label} className={`btn btn-small ${i === 0 ? 'btn-good' : ''}`} disabled={busy} onClick={() => act(a, i)}>
            {a.label}
          </button>
        ))}
        <button className="btn btn-small btn-ghost" disabled={busy} onClick={() => void api.snoozeSetup(repo.id, gap.id).catch(() => undefined)} title="Hide it for a week">
          Not now
        </button>
      </div>
    </div>
  );
}

/** The floor's use case, and the sheet to change it. */
function UseCaseRow({ repo }: { repo: RepoView }) {
  const [picking, setPicking] = useState(false);
  const s = repo.setup ?? NOT_GUESSED;
  return (
    <div className="fs-usecase">
      {s.useCase ? (
        <span className="fs-kind">
          <Icon name={caseIcon(s.useCase)} /> {caseDef(s.useCase).label}
          {s.guessed && <small className="ds-row-meta"> · guessed from {s.guessWhy}</small>}
        </span>
      ) : (
        <span className="ds-row-meta">Kind of project not known yet</span>
      )}
      <button className="btn btn-small btn-ghost" onClick={() => setPicking(true)}>
        Change
      </button>
      {picking && <UseCasePicker repo={repo} onClose={() => setPicking(false)} />}
    </div>
  );
}

function UseCasePicker({ repo, onClose }: { repo: RepoView; onClose: () => void }) {
  const pick = (u: UseCase) => {
    onClose();
    void api.setUseCase(repo.id, u).catch(() => undefined);
  };
  return (
    <Sheet title={`What is ${repo.fullName.split('/')[1]}?`} onClose={onClose} className="fs-sheet">
      <div className="fs-picks">
        {USE_CASES.map((u) => (
          <button key={u.id} className={`fs-pick ${repo.setup?.useCase === u.id ? 'fs-pick-on' : ''}`} aria-pressed={repo.setup?.useCase === u.id} onClick={() => pick(u.id)}>
            <Icon name={u.icon as IconName} />
            <span>
              <b>{u.label}</b>
              <small>{u.blurb}</small>
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/** What the use case recommends, ticked where the floor has it. */
export function RecommendedSetup({ useCase, repo }: { useCase: UseCase; repo?: RepoView }) {
  const def = caseDef(useCase);
  const jobs: [string, (typeof def.jobs)['build']][] = [['Build', def.jobs.build], ['QA', def.jobs.qa], ['Small fixes', def.jobs.fixes], ['Docs', def.jobs.docs]];
  const has = (id: string) => (repo ? !repo.setup?.gaps.some((g) => g.id === id) : null);
  const tick = (ok: boolean | null) => (ok === null ? null : <Icon name={ok ? 'circle-check' : 'circle-alert'} label={ok ? 'in place' : 'missing'} />);
  return (
    <div className="fs-rec">
      <div className="fs-rec-grid">
        {jobs.map(([job, p]) => (
          <div key={job} className="fs-rec-item">
            <small>{job}</small>
            <b>{p.label}</b>
            <span className="ds-row-meta">{p.why}</span>
          </div>
        ))}
      </div>
      <ul className="fs-rec-list">
        <li>
          <Icon name="users" /> Team of {def.team} to start
        </li>
        {def.needsPreview && (
          <li>
            <Icon name="monitor" /> Preview: <code>{def.preview ?? 'npm run dev'}</code> {tick(has('preview'))}
          </li>
        )}
        {def.browserLab && (
          <li>
            <Icon name="globe" /> Browser testing and the Test lab {tick(repo ? has('browser') && has('test-lab') : null)}
          </li>
        )}
        <li>
          <Icon name="clipboard-list" /> QA checks: {def.qaChecks.map((c) => c.label.toLowerCase()).join('; ')} {tick(has('qa-brief'))}
        </li>
        {def.skills.map((k) => (
          <li key={k}>
            <Icon name="toolbox" /> Skill: {k} {tick(has(`skill:${k}`))}
          </li>
        ))}
        {def.providers.map((c) => (
          <li key={c}>
            <Icon name="plug" /> A {c} provider {tick(has(`provider:${c}`))}
          </li>
        ))}
      </ul>
      <p className="ds-row-meta">{def.why}</p>
    </div>
  );
}

/** The floor's card in Floors & repos: its use case, then its open gaps (or that it's set up). */
export function FloorSetupCard({ repo }: { repo: RepoView }) {
  const s = repo.setup ?? NOT_GUESSED;
  return (
    <section className="fs-card" aria-label={`Floor ${repo.floor} setup`}>
      <h4>
        <Icon name="compass" /> Setup
      </h4>
      <UseCaseRow repo={repo} />
      {s.useCase && !s.gaps.length && (
        <p className="ds-row-meta">
          <Icon name="circle-check" /> Set up as recommended{s.snoozed ? ` · ${s.snoozed} hidden for now` : ''}
        </p>
      )}
      {s.gaps.map((g) => (
        <GapCard key={g.id} repo={repo} gap={g} />
      ))}
      {s.useCase && (
        <details className="small">
          <summary>Recommended setup</summary>
          <RecommendedSetup useCase={s.useCase} repo={repo} />
        </details>
      )}
    </section>
  );
}

/** A new floor (or a new use case) with gaps: the checklist before its agents start, until the manager closes it. */
export function SetupChecklist() {
  const repo = useStore((s) => s.repos.find((r) => r.setup?.review && r.setup.useCase && r.setup.gaps.length));
  if (!repo?.setup?.useCase) return null;
  const close = () => void api.closeSetupReview(repo.id).catch(() => undefined);
  const def = caseDef(repo.setup.useCase);
  return (
    <Sheet title={`Set up floor ${repo.floor}`} onClose={close} className="fs-sheet">
      <UseCaseRow repo={repo} />
      <h4>Missing ({repo.setup.gaps.length})</h4>
      {repo.setup.gaps.map((g) => (
        <GapCard key={g.id} repo={repo} gap={g} onAct={(a) => 'open' in a && close()} />
      ))}
      <h4>Recommended setup</h4>
      <RecommendedSetup useCase={def.id} repo={repo} />
      <div className="fs-done">
        <button className="btn" onClick={close}>
          Done
        </button>
      </div>
    </Sheet>
  );
}
