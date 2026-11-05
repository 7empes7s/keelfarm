import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { OFFICE_PLAYBOOK_MAX } from '../../../shared/officePlaybook';

// The CEO tab's "Every project" playbook (#50): the office-wide rules above each floor's playbook in every build, fix
// and QA prompt. Every session pays for it, so the count shows as you type and warns near the cap.

export function OfficePlaybook() {
  const saved = useStore((s) => s.settings.officePlaybook);
  const [text, setText] = useState<string | null>(null);
  const value = text ?? saved;
  const n = value.trim().length;
  const over = n > OFFICE_PLAYBOOK_MAX;
  const near = !over && n > OFFICE_PLAYBOOK_MAX * 0.8;
  const save = async () => {
    if (text === null || text === saved || over) return;
    try {
      await api.updateSettings({ officePlaybook: text });
      setText(null);
    } catch {
      // api() already toasted the error; the text stays for another try
    }
  };
  return (
    <details className="small">
      <summary>Every project's playbook{saved ? '' : ' (none)'}</summary>
      <textarea
        rows={5}
        value={value}
        aria-describedby="office-playbook-count"
        placeholder="Small, proven rules for every agent on every floor, above each floor's own playbook."
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void save()}
      />
      <p id="office-playbook-count" className={over || near ? 'chip-warn' : 'muted'} role={over ? 'alert' : undefined}>
        {n} / {OFFICE_PLAYBOOK_MAX} characters.{' '}
        {over ? 'Too long to save: every build, fix and QA session pays for it.' : near ? 'Nearly at the cap: every build, fix and QA session pays for it.' : 'In every build, fix and QA prompt, on every floor.'}
      </p>
    </details>
  );
}
