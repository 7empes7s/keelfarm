// Prompt weight (#18): every session pays for the office's prompts, so their size per kind is printed and capped. A cap
// that fails means a prompt grew: trim it, or raise the cap on purpose in the same PR.
import { describe, expect, it } from 'vitest';
import { ceoJobPrompt, ceoSystemPrompt, type CeoJob } from './ceo.ts';
import { devBranch, devSystemPrompt, qaBranch, qaSystemPrompt } from './prompts.ts';
import { DEFAULT_OFFICE_PLAYBOOK, OFFICE_PLAYBOOK_MAX } from '../shared/types.ts';

const repo = { fullName: 'acme/shop', defaultBranch: 'main', autoMerge: true, browserTesting: true, summary: 'A shop that sells socks online', mission: 'Sell socks', qaBrief: 'Check the cart', playbook: '' };
const agent = { name: 'Margaret' };
const linked = [{ fullName: 'acme/api', dir: '/clones/acme/api/main' }];
const pr = { number: 42, title: 'Add socks', headRefName: devBranch(7, 'margaret'), url: 'https://github.com/acme/shop/pull/42' };
const officePlaybook = DEFAULT_OFFICE_PLAYBOOK; // every builder, fixer and QA pays for it (#50)
const dev = { agent, repo, port: 5839, cwd: '/desk/m', branch: devBranch(7, 'margaret'), linked, officePlaybook };
const floor = { floor: 2, fullName: 'acme/shop', clone: '/clones/acme/shop/main', mission: 'Sell socks', backlog: 5 };
const job = (kind: CeoJob['kind'], o: Partial<CeoJob> = {}): CeoJob => ({ kind, at: 0, ...o });

/** Characters, roughly 4 per token. Today's sizes plus about 10%. */
const PROMPTS: [string, string, number][] = [
  ['issue (system)', devSystemPrompt(dev), 3450], // +100: the default office playbook (#50)
  ['fix (system)', devSystemPrompt({ ...dev, fixing: { pr: 42, headRef: pr.headRefName } }), 3300], // +100: the default office playbook (#50)
  ['qa (system)', qaSystemPrompt({ agent, repo, port: 5839, cwd: '/desk/q', branch: qaBranch(42, 'margaret'), pr, officePlaybook }), 3550], // +100 for the BLOCKED line (#54), +250 for the default office playbook (#50)
  ['ceo (system)', ceoSystemPrompt({ name: 'Luna', company: 'Acme', manager: 'Sam', notesFile: '/notes.md', sessionLimit: 4, maxAgents: 10, scaling: 'approve' }), 7950], // +150 for the waiting tools' line (#28), +280 for the idea cards (#108), +50 for react and reply (#118)
  ['ceo-review (job)', ceoJobPrompt(job('review'), null), 900],
  ['ceo-chat (job)', ceoJobPrompt(job('chat', { text: 'How is floor 2 doing?' }), null), 150],
  ['ceo-plan (job)', ceoJobPrompt(job('plan', { repoId: 'acme/shop' }), floor), 1150], // +200 for objective tags (#48)
  ['ceo-research (job)', ceoJobPrompt(job('research', { repoId: 'acme/shop', topic: 'Gift wrapping at checkout' }), floor), 1450],
  ['ceo-onboard (job)', ceoJobPrompt(job('onboard', { repoId: 'acme/shop' }), floor), 900],
];

describe('prompt weight', () => {
  it('prints each prompt’s size and keeps it under its cap', () => {
    console.log(PROMPTS.map(([kind, text, cap]) => `${kind.padEnd(18)} ${String(text.length).padStart(5)} chars ≈ ${Math.round(text.length / 4)} tokens (cap ${cap})`).join('\n'));
    for (const [kind, text, cap] of PROMPTS) expect({ kind, size: text.length }).toEqual({ kind, size: Math.min(text.length, cap) });
  });

  it('keeps the default office playbook well under its cap', () => {
    expect(DEFAULT_OFFICE_PLAYBOOK.length).toBeLessThanOrEqual(OFFICE_PLAYBOOK_MAX / 2);
  });
});
