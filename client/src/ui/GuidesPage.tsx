// Settings → Guides (#366): what the company mainly makes (its main use cases), one short guide per kind of project
// (the recommended setup as cards, from shared/useCases.ts), what each coding agent is good at, searchable. The long
// form of each guide is docs/guides/<use case>.md.
import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { AGENT_NOTES, guideUrl, USE_CASES, caseDef } from '../../../shared/useCases';
import type { UseCase } from '../../../shared/types';
import { RecommendedSetup, caseIcon, useGuide } from './FloorSetup';
import { Icon } from './Icon';
import './floorSetup.css';

const words = (u: (typeof USE_CASES)[number]) => [u.label, u.blurb, u.why, ...u.qaChecks.map((c) => c.label), ...Object.values(u.jobs).map((j) => j.label), ...u.skills, ...u.providers].join(' ').toLowerCase();

const NONE: UseCase[] = [];

function CompanyUseCases() {
  const company = useStore((s) => s.settings.companyUseCases) ?? NONE;
  const toggle = (u: UseCase) => void api.setCompanyUseCases(company.includes(u) ? company.filter((x) => x !== u) : [...company, u]).catch(() => undefined);
  return (
    <div className="card">
      <h4>What the company mainly makes</h4>
      <p className="ds-row-meta">A floor of another kind gets a checklist of what it needs.</p>
      <div className="fs-chips">
        {USE_CASES.map((u) => (
          <button key={u.id} className={`btn btn-small ${company.includes(u.id) ? 'btn-good' : 'btn-ghost'}`} aria-pressed={company.includes(u.id)} onClick={() => toggle(u.id)}>
            <Icon name={caseIcon(u.id)} /> {u.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Guide({ id }: { id: UseCase }) {
  const def = caseDef(id);
  const floors = useStore((s) => s.repos).filter((r) => r.setup?.useCase === id);
  return (
    <div className="fs-guide">
      <button className="btn btn-small btn-ghost" onClick={() => useGuide.setState({ open: null })}>
        <Icon name="chevron-left" /> All guides
      </button>
      <h3>
        <Icon name={caseIcon(id)} /> {def.label}
      </h3>
      <p className="ds-row-meta">{def.blurb}</p>
      {floors.length > 0 && <p className="ds-row-meta">Your floors of this kind: {floors.map((r) => `${r.floor} · ${r.fullName.split('/')[1]}`).join(', ')}</p>}
      <div className="card">
        <h4>Recommended setup</h4>
        <RecommendedSetup useCase={id} />
      </div>
      <div className="card">
        <h4>Getting it ready</h4>
        <ol className="fs-steps">
          {def.providers.length > 0 && <li>Add a {def.providers.join(' and a ')} provider in Settings → Providers, with its key, and Test it.</li>}
          {def.needsPreview && <li>Check the floor's app preview starts{def.preview ? <> (<code>{def.preview}</code>)</> : ''}.</li>}
          <li>Sign in the coding agents above in Settings → Providers & accounts.</li>
          {def.browserLab && <li>Turn on browser testing on the floor and the Test lab in Mission control.</li>}
          {def.skills.length > 0 && <li>Switch on {def.skills.join(', ')} in Tools & skills.</li>}
          <li>Let the setup card on the floor add the QA checks.</li>
        </ol>
      </div>
      <a className="btn btn-small" href={guideUrl(id)} target="_blank" rel="noreferrer">
        <Icon name="external-link" /> The full guide
      </a>
    </div>
  );
}

export function GuidesPage() {
  const open = useGuide((s) => s.open);
  const [q, setQ] = useState('');
  if (open) return <Guide id={open} />;
  const find = q.trim().toLowerCase();
  const shown = USE_CASES.filter((u) => !find || words(u).includes(find));
  return (
    <div className="fs-guides">
      <CompanyUseCases />
      <input className="fs-search" type="search" placeholder="Search the guides" aria-label="Search the guides" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="fs-picks">
        {shown.map((u) => (
          <button key={u.id} className="fs-pick" onClick={() => useGuide.setState({ open: u.id })}>
            <Icon name={caseIcon(u.id)} />
            <span>
              <b>{u.label}</b>
              <small>{u.why}</small>
            </span>
          </button>
        ))}
        {!shown.length && <p className="ds-row-meta">No guide mentions "{q}".</p>}
      </div>
      <h4>What each coding agent is good at</h4>
      <div className="fs-rec-grid">
        {AGENT_NOTES.filter((n) => !find || `${n.name} ${n.good} ${n.use}`.toLowerCase().includes(find) ).map((n) => (
          <div key={n.name} className="fs-rec-item">
            <b>{n.name}</b>
            <span>{n.good}</span>
            <span className="ds-row-meta">{n.use}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
