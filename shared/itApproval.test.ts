import { describe, expect, it } from 'vitest';
import { approvalWords } from './itApproval.ts';

describe('approval lock-screen words', () => {
  it('names known actions without copying any arguments or arbitrary executables', () => {
    expect(approvalWords({ argv: ['journalctl', '--vacuum-size=500M'] }).text).toContain('clear old system logs');
    expect(approvalWords({ argv: ['docker', 'image', 'prune', '-af'] }).text).toContain('remove unused container images');
    expect(approvalWords({ argv: ['systemctl', 'restart', 'private-customer.service'] }).text).toContain('restart a service');
    expect(approvalWords({ argv: ['sensitive-program', '--password=private-value'] }).text).toBe('Please approve: run a machine command. Open the card to review the details.');
    expect(approvalWords({ argv: ['github', 'secret_delete', 'private-repo', 'private-secret'], pa: { keyId: 'mock', provider: 'github', op: 'secret_delete', data: { name: 'private-secret' } } }).text).toBe('Please approve: delete an Actions secret. Open the card to review the details.');
  });
});
