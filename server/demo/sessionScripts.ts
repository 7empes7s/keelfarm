// The demo's fake sessions' scripts (#257): what a builder, QA and a fixer appear to do, step by step.
import path from 'node:path';
import type { LogEntry, SessionCallbacks, SessionOptions } from '../agentRunner.ts';
import { demoQaPage } from '../demoMap.ts';
import { BLOCKED_DEMO, demoPrompts } from '../demoPrompts.ts';

function screenshotSvg(title: string, url: string, hue: number) {
  const safe = (s: string) => s.replace(/[<>&"]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">
  <rect width="640" height="400" fill="hsl(${hue},60%,97%)"/>
  <rect width="640" height="56" fill="hsl(${hue},70%,55%)"/>
  <text x="24" y="37" font-family="Segoe UI, Arial" font-size="22" font-weight="700" fill="#fff">${safe(title)}</text>
  <text x="620" y="36" text-anchor="end" font-family="Segoe UI, Arial" font-size="13" fill="#fff">${safe(url)}</text>
  ${[0, 1, 2, 3]
    .map(
      (i) => `<rect x="24" y="${84 + i * 70}" width="592" height="56" rx="10" fill="#fff" stroke="hsl(${hue},40%,85%)"/>
  <circle cx="54" cy="${112 + i * 70}" r="11" fill="none" stroke="hsl(${hue},60%,55%)" stroke-width="3"/>
  <rect x="80" y="${104 + i * 70}" width="${180 + ((i * 97) % 220)}" height="14" rx="7" fill="hsl(${hue},25%,80%)"/>`,
    )
    .join('\n')}
</svg>`;
}

export type Step = LogEntry[] | (() => void);

export function issueScript(opts: SessionOptions, cb: SessionCallbacks, issueNumber: number, issueTitle: string): Step[] {
  const branch = path.basename(opts.cwd);
  const hue = (issueNumber * 67) % 360;
  const file = ['src/App.tsx', 'src/components/TodoList.tsx', 'src/api/routes.ts', 'src/styles.css'][issueNumber % 4];
  const port = 5200 + (issueNumber % 50);
  return [
    [{ kind: 'text', text: `● I'll start by getting familiar with the codebase for "${issueTitle}".` }],
    [{ kind: 'tool', tool: 'Glob', text: '⏺ Glob src/**/*.{ts,tsx}' }, { kind: 'result', text: '  ⎿ Found 23 files' }],
    [{ kind: 'tool', tool: 'Read', text: `⏺ Read ${file}` }, { kind: 'result', text: '  ⎿ Read 184 lines' }],
    [{ kind: 'thinking', text: '✻ Thinking…' }],
    [
      { kind: 'tool', tool: 'TodoWrite', text: '⏺ Update todo list' },
      { kind: 'result', text: '  ◐ Understand current behaviour' },
      { kind: 'result', text: '  ☐ Implement the change' },
      { kind: 'result', text: '  ☐ Add tests' },
      { kind: 'result', text: '  ☐ Verify in the browser' },
    ],
    [{ kind: 'tool', tool: 'Grep', text: '⏺ Grep "useTodos"' }, { kind: 'result', text: '  ⎿ Found 6 matches in 4 files' }],
    [{ kind: 'text', text: "● The state lives in a single hook. I'll extend it and keep the API backwards compatible." }],
    [{ kind: 'tool', tool: 'Edit', text: `⏺ Edit ${file}` }, { kind: 'result', text: '  ⎿ Updated' }],
    ...(issueNumber % 3 === 0 ? [demoPrompts(opts.cwd)] : []), // now and then, the prompts the office answers for them
    // and, rarer, one it couldn't: blocked for a moment (the desk's ⛔ sign), until the manager answers it
    ...(issueNumber % 5 === 0 ? [() => cb.blocked?.(BLOCKED_DEMO), [{ kind: 'error' as const, text: `⛔ Blocked: ${BLOCKED_DEMO}. Open the terminal to answer it.` }], () => cb.blocked?.(null)] : []),
    [{ kind: 'tool', tool: 'Write', text: '⏺ Write src/__tests__/feature.test.ts' }, { kind: 'result', text: '  ⎿ Saved' }],
    [{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm test -- --run' }],
    [
      { kind: 'result', text: '  ⎿ ✓ src/__tests__/feature.test.ts (4 tests) 38ms' },
      { kind: 'result', text: '    Test Files  7 passed (7)' },
    ],
    [{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm run typecheck' }, { kind: 'result', text: '  ⎿ (no output)' }],
    [{ kind: 'tool', tool: 'Bash', text: `⏺ $ npm run dev -- --port ${port} &` }, { kind: 'result', text: '  ⎿ VITE ready in 412 ms' }],
    // Odd issues screenshot a page they never navigated to, so their browser card shows "address unknown" (#230).
    () => issueNumber % 2 || cb.browserUrl(`http://localhost:${port}/`),
    issueNumber % 2
      ? [{ kind: 'tool', tool: 'mcp__playwright__browser_wait_for', text: '⏺ 🌐 wait_for "Ready"' }, { kind: 'result', text: '  ⎿ Waited for Ready' }]
      : [{ kind: 'tool', tool: 'mcp__playwright__browser_navigate', text: `⏺ 🌐 navigate http://localhost:${port}/` }, { kind: 'result', text: `  ⎿ Page URL: http://localhost:${port}/` }],
    () => cb.screenshot(Buffer.from(screenshotSvg(issueTitle, `localhost:${port}`, hue)), 'image/svg+xml'),
    [{ kind: 'tool', tool: 'mcp__playwright__browser_take_screenshot', text: '⏺ 🌐 take_screenshot' }, { kind: 'result', text: '  ⎿ Took a screenshot of the current page' }],
    [{ kind: 'text', text: '● Looks right in the browser. A production build, then the PR.' }],
    [{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm run build' }, { kind: 'result', text: '  ⎿ ✓ built in 1.62s' }],
    [{ kind: 'tool', tool: 'Bash', text: `⏺ $ git commit -am "feat: ${issueTitle.toLowerCase()}"` }, { kind: 'result', text: `  ⎿ [${branch} 3f2a91c] feat: ${issueTitle.toLowerCase()}` }],
    [{ kind: 'tool', tool: 'Bash', text: '⏺ $ git push -u origin HEAD' }, { kind: 'result', text: '  ⎿ branch set up to track origin' }],
    [{ kind: 'tool', tool: 'Bash', text: `⏺ $ gh pr create --title "${issueTitle}" --body "Closes #${issueNumber}"` }],
  ];
}

export function qaScript(cb: SessionCallbacks, pr: number, title: string, round: number, checks: string): Step[] {
  const port = 5600 + (pr % 50);
  const hue = (pr * 41) % 360;
  // With GitHub checks on the PR, QA reads what they cover instead of re-running the suite.
  const verify: Step[] = checks.endsWith(': none')
    ? [
        [{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm ci && npm test -- --run' }],
        [
          { kind: 'result', text: '  ⎿ Test Files  8 passed (8)' },
          { kind: 'result', text: '    Tests  41 passed (41)' },
        ],
        [{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm run lint && npm run build' }, { kind: 'result', text: '  ⎿ ✓ built in 1.84s' }],
      ]
    : [
        [{ kind: 'tool', tool: 'Read', text: '⏺ Read .github/workflows/ci.yml' }, { kind: 'result', text: '  ⎿ Read 41 lines' }],
        [{ kind: 'text', text: '● CI already runs the tests, lint and build, so I only need a build to start the app.' }],
        [{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm ci && npm run build' }, { kind: 'result', text: '  ⎿ ✓ built in 1.84s' }],
      ];
  return [
    [{ kind: 'text', text: `● Testing PR #${pr} "${title}" (round ${round}). ${checks}. First, the acceptance criteria from the issue.` }],
    [{ kind: 'tool', tool: 'Bash', text: '⏺ $ git diff origin/main...HEAD --stat' }, { kind: 'result', text: '  ⎿  3 files changed, 82 insertions(+), 9 deletions(-)' }],
    ...verify,
    [{ kind: 'tool', tool: 'Bash', text: `⏺ $ npm run preview -- --port ${port} &` }, { kind: 'result', text: `  ⎿ Local: http://localhost:${port}/` }],
    () => cb.browserUrl(`http://localhost:${port}/`),
    [{ kind: 'tool', tool: 'mcp__playwright__browser_navigate', text: `⏺ 🌐 navigate http://localhost:${port}/` }, { kind: 'result', text: `  ⎿ Page URL: http://localhost:${port}/` }],
    () => cb.screenshot(Buffer.from(screenshotSvg(`QA · ${title}`, `localhost:${port}`, hue)), 'image/svg+xml'),
    [{ kind: 'tool', tool: 'mcp__playwright__browser_take_screenshot', text: '⏺ 🌐 take_screenshot' }, { kind: 'result', text: '  ⎿ Took a screenshot of the current page' }],
    () => cb.browserUrl(`http://localhost:${port}${demoQaPage(pr)}`),
    [{ kind: 'tool', tool: 'mcp__playwright__browser_navigate', text: `⏺ 🌐 navigate http://localhost:${port}${demoQaPage(pr)}` }, { kind: 'result', text: `  ⎿ Page URL: http://localhost:${port}${demoQaPage(pr)}` }],
    [{ kind: 'tool', tool: 'mcp__playwright__browser_resize', text: '⏺ 🌐 resize 375x740' }, { kind: 'result', text: '  ⎿ Resized' }],
    () => cb.screenshot(Buffer.from(screenshotSvg(`QA · mobile · ${demoQaPage(pr)}`, `localhost:${port}${demoQaPage(pr)}`, (hue + 40) % 360)), 'image/svg+xml'),
    [{ kind: 'tool', tool: 'mcp__playwright__browser_take_screenshot', text: '⏺ 🌐 take_screenshot' }, { kind: 'result', text: '  ⎿ Took a screenshot of the current page' }],
    [{ kind: 'tool', tool: 'mcp__playwright__browser_console_messages', text: '⏺ 🌐 console_messages' }, { kind: 'result', text: '  ⎿ No errors' }],
  ];
}

export function fixScript(pr: number, pushes: boolean, nudged: boolean): Step[] {
  if (nudged) {
    return [
      [{ kind: 'text', text: `● Checking whether PR #${pr} still needs a change.` }],
      pushes
        ? [{ kind: 'tool', tool: 'Bash', text: '⏺ $ git commit -am "fix: wrap toolbar on narrow screens" && git push origin HEAD' }, { kind: 'result', text: '  ⎿ pushed' }]
        : [{ kind: 'tool', tool: 'Bash', text: '⏺ $ git fetch origin && git diff origin/main --stat -- src/styles.css' }, { kind: 'result', text: '  ⎿ (no differences)' }],
    ];
  }
  return [
    [{ kind: 'text', text: `● Reading the QA report for PR #${pr}. The toolbar overflows on phones; I'll let it wrap.` }],
    [{ kind: 'tool', tool: 'Read', text: '⏺ Read src/styles.css' }, { kind: 'result', text: '  ⎿ Read 212 lines' }],
    [{ kind: 'tool', tool: 'Edit', text: '⏺ Edit src/styles.css' }, { kind: 'result', text: '  ⎿ Updated' }],
    [{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm test -- --run' }, { kind: 'result', text: '  ⎿ Test Files  8 passed (8)' }],
    pushes
      ? [{ kind: 'tool', tool: 'Bash', text: '⏺ $ git commit -am "fix: wrap toolbar on narrow screens" && git push origin HEAD' }, { kind: 'result', text: '  ⎿ pushed' }]
      : [{ kind: 'tool', tool: 'Bash', text: '⏺ $ git status --short' }, { kind: 'result', text: '  ⎿  M src/styles.css' }],
    ...(pushes ? [[{ kind: 'tool', tool: 'Bash', text: `⏺ $ gh pr checks ${pr} --watch` }, { kind: 'result', text: '  ⎿ All checks were successful' }] as LogEntry[]] : []),
  ];
}

/** The PR a fix prompt is about ("QA passed pull request #6…", "Pull request #6 (url) conflicts…"), and its title if given. */
export function fixPromptPull(prompt: string): { number: number; title?: string } {
  const m = prompt.match(/pull request #(\d+)(?::\s*(.+))?/i);
  return { number: Number(m?.[1] ?? 0), title: m?.[2]?.trim() };
}
