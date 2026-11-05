// The office-wide playbook's limits and starting text (#50), shared by the server, its tests and the settings UI.

/** The longest the office-wide playbook may be (#50): it is in every builder's, fixer's and QA's prompt, on every floor. */
export const OFFICE_PLAYBOOK_MAX = 1200;

/** The office-wide playbook a new office starts with: small rules the prompts don't already say. */
export const DEFAULT_OFFICE_PLAYBOOK = [
  '- A fix comes with a test that fails without it.',
  "- Don't reformat, rename or move code you aren't changing.",
  '- Never run, edit or restart anything outside your worktree and reserved port: no live services, no other desks.',
].join('\n');
