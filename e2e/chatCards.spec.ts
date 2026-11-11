import { expect, overflowProblems, test } from './helpers';

// One CEO message with every kind of card the chat draws (#514): markdown, a code block with Copy, a wide table, a
// chart, a dashboard, an artifact, an attachment, action and idea cards, suggestion chips, a spoken summary, the steps
// row and Redo on Opus. At a phone's width it renders whole, with nothing scrolling sideways and no console errors.

const ID = 999_999;
const wide = Array.from({ length: 8 }, (_, i) => `Column ${i + 1}`);

test('a CEO message with every card type renders at 390px without overflow (#514)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const file = await (await page.request.post('/api/files', { headers: { 'Content-Type': 'text/plain', 'X-File-Name': 'notes.txt' }, data: 'hello' })).json();
  const message = {
    id: ID,
    from: 'ceo',
    at: Date.now(),
    text: [
      '## Every card',
      'A **bold** line, a [link](https://example.com) and a list:',
      '- one\n- two',
      '```ts',
      `const longLine = '${'x'.repeat(200)}';`,
      '```',
    ].join('\n'),
    spoken: 'Every card, in one message.',
    suggestions: ['Yes, go ahead', 'Not now', 'Tell me more about the plan first'],
    artifacts: [{ id: `${ID}-0`, title: 'Milestone plan', lead: 'Three steps to the next release', markdown: '# Milestone plan\n\nThree steps.' }],
    visuals: [
      { kind: 'chart', type: 'bar', title: 'Merged by floor', unit: 'count', labels: ['Floor 1', 'Floor 2', 'Floor 3'], series: [{ name: 'Merged', values: [3, 5, 2] }] },
      { kind: 'table', title: 'A wide table', columns: wide.map((label) => ({ label, unit: '' })), rows: [wide.map((c) => `${c} has a long value`)] },
      { kind: 'dashboard', title: 'This week', tiles: [{ label: 'Merged', value: 12, unit: 'count', delta: 20 }, { label: 'Spend', value: 41.5, unit: 'usd' }], charts: [] },
    ],
    attachments: [file],
    actions: [{ tool: 'set_floor_profile', icon: '🏢', text: "Saved floor 2's profile.", ref: { kind: 'section', section: 'ceo', repoId: 'demo-co/weather-api' } }],
    idea: { kind: 'objective', title: 'Add an objective: first-round QA pass above 70%', message: 'Add the objective' },
    log: { steps: [{ label: 'Checking the floors', icon: '🏢', state: 'done', ms: 1234 }], count: 1, ms: 1234 },
    used: { skills: [], connectors: [{ name: 'Office', tools: 1 }], tools: [{ name: 'Read', count: 1 }] },
    ceoJob: { job: 9, kind: 'triage', model: 'claude-sonnet-5', usd: 0.49 },
  };
  await page.routeWebSocket(/\/ws$/, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((data) => {
      if (typeof data !== 'string') return ws.send(data);
      const ev = JSON.parse(data);
      if (ev.type === 'snapshot') ev.data.messages.push(message);
      ws.send(JSON.stringify(ev));
    });
  });
  await page.goto('/?pocket=1&tab=chat');
  const row = page.locator('.pocket .chat-log .bubble-row').filter({ hasText: 'Every card' }).last();
  await expect(row).toBeVisible();
  const log = page.locator('.pocket .chat-log');
  for (const shown of [
    row.getByRole('button', { name: /copy/i }),
    log.getByText('Merged by floor'),
    log.getByText('A wide table'),
    log.getByText('This week'),
    log.getByText('Milestone plan'),
    log.getByText('notes.txt'),
    log.getByText("Saved floor 2's profile."),
    log.locator('.idea-card'),
    log.locator('.suggestion-chip').first(),
    log.locator('.steps-row').last(),
    log.getByRole('button', { name: /Redo on/ }),
  ])
    await expect(shown).toBeVisible();
  expect(await overflowProblems(page.locator('.pocket'))).toEqual([]);
});
