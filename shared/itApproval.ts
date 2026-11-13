// Lock-screen words come only from fixed operation labels, never a proposal's arguments, reason or diff.
import type { ItProposal } from './itDesk.ts';
import { actionOp } from './providerActions.ts';

export function approvalWords(p: Pick<ItProposal, 'argv' | 'cf' | 'pa' | 'ki'>) {
  const provider = p.pa?.provider ?? (p.cf ? 'cloudflare' : null);
  const op = p.pa?.op ?? p.cf?.op;
  const command = p.argv[0];
  const action = provider && op ? actionOp(provider, op)?.does ?? 'change provider settings'
    : p.ki ? 'install a saved key'
    : command === 'journalctl' && p.argv.some((a) => a.startsWith('--vacuum-')) ? 'clear old system logs'
    : command === 'docker' && p.argv[1] === 'image' && p.argv[2] === 'prune' ? 'remove unused container images'
    : command === 'systemctl' && p.argv[1] === 'restart' ? 'restart a service'
    : 'run a machine command';
  return { title: 'IT approval needed', text: `Please approve: ${action}. Open the card to review the details.` };
}
