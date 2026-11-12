import { describe, expect, it } from 'vitest';
import { hasAttribution, squashBody, stripAttribution } from './attribution.ts';

const COMMIT = `Fix the merge loop

It retried forever.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;

const PR_BODY = `Closes #12

## Try it
1. Open the board.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
`;

describe('stripAttribution (#599)', () => {
  it('removes the trailer from a commit message', () => {
    expect(stripAttribution(COMMIT)).toBe('Fix the merge loop\n\nIt retried forever.');
  });

  it('removes the trailer and the Generated with line from a PR body', () => {
    expect(stripAttribution(PR_BODY)).toBe('Closes #12\n\n## Try it\n1. Open the board.');
  });

  it("removes Codex's, in any case, and leaves people's trailers and other text alone", () => {
    const msg = 'Add it\n\nGenerated with Codex.\nco-authored-by: Codex <noreply@openai.com>\nCo-authored-by: Ada <ada@example.com>';
    expect(stripAttribution(msg)).toBe('Add it\n\nCo-authored-by: Ada <ada@example.com>');
    expect(hasAttribution('Mentions Claude Code and Generated with care')).toBe(false);
    expect(stripAttribution('Plain\n\n\nspacing ')).toBe('Plain\n\n\nspacing ');
  });
});

describe('squashBody (#599)', () => {
  const author = [{ name: 'Codex CLI', email: 'codex@local' }];

  it("keeps GitHub's default when no commit carries attribution", () => {
    expect(squashBody([{ messageHeadline: 'Fix', messageBody: 'Body', authors: author }])).toBeNull();
  });

  it('writes the squash body without the trailer, keeping the authors', () => {
    const body = squashBody([{ messageHeadline: 'Fix the merge loop', messageBody: 'It retried forever.\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>', authors: author }]);
    expect(body).toBe('It retried forever.\n\nCo-authored-by: Codex CLI <codex@local>');
  });

  it('lists several commits as bullets, once per co-author', () => {
    const body = squashBody([
      { messageHeadline: 'One', messageBody: 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>', authors: author },
      { messageHeadline: 'Two', messageBody: 'Why.\n\nCo-authored-by: Codex CLI <codex@local>', authors: author },
    ]);
    expect(body).toBe('* One\n\n* Two\n\nWhy.\n\nCo-authored-by: Codex CLI <codex@local>');
    expect(hasAttribution(body ?? '')).toBe(false);
  });
});
