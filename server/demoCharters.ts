// The demo's charters (#48): every demo floor opens with one, and the todo app with a change from the CEO waiting
// for the manager (proposed through the real propose_charter tool, so approving it works as in the real office).

import type { Charter } from '../shared/charter.ts';

export interface DemoCharter {
  charter: Charter;
  /** propose_charter's arguments for a change waiting when the demo opens. */
  proposal?: { reason: string; focus?: string; standards?: string[] };
}

const TODO_STANDARDS = [
  'Every action works with the keyboard alone, focus always visible',
  'Nothing overflows or gets cut off at 375px',
  'Todos survive a reload; localStorage errors never crash the app',
  'New logic comes with tests next to it',
];

const CHARTERS: Record<string, DemoCharter> = {
  'pixel-todo': {
    charter: {
      mission: 'A cheerful todo app that is quick to use on a phone and a joy on a desktop.',
      objectives: [
        { id: 'O1', outcome: 'Capturing a todo takes one tap or one key', measure: 'new todo from anywhere in under 2 seconds' },
        { id: 'O2', outcome: 'Plan the week: due dates, order and overdue items', measure: 'due dates, reordering and an overdue highlight ship' },
        { id: 'O3', outcome: 'It never loses or miscounts a todo', measure: 'no data-loss or count bugs open' },
      ],
      standards: TODO_STANDARDS,
      nonGoals: ['Accounts, sync or a backend', 'Sharing lists with other people'],
      focus: 'O2: plan the week',
    },
    proposal: {
      reason: 'Two of the last QA rounds found the dark theme unreadable: I would make contrast a standard and put O1 in focus next to O2.',
      focus: 'O1, O2: quick capture and planning the week',
      standards: [...TODO_STANDARDS, 'Text meets WCAG AA contrast in light and dark themes'],
    },
  },
  'weather-api': {
    charter: {
      mission: 'A tiny, dependable weather REST API that small apps can call without an account.',
      objectives: [
        { id: 'O1', outcome: 'Forecasts for any city', measure: '/forecast returns 5 days for a city by name' },
        { id: 'O2', outcome: 'Self-describing', measure: 'openapi.json matches every endpoint' },
        { id: 'O3', outcome: 'Fair to everyone', measure: 'anonymous callers are rate limited with 429 and Retry-After' },
      ],
      // long unbroken paths, URLs and branch names, as real charters have them: no screen may drag sideways (#149)
      standards: [
        'Bad input is a 400 with a message, an unknown city a 404',
        'openapi.yaml changes with every endpoint change',
        'The upstream weather client is mocked in tests (src/upstream/__mocks__/openWeatherMapForecastClient.ts)',
        'Errors follow https://datatracker.ietf.org/doc/html/rfc9457#name-members-of-a-problem-details-object',
      ],
      nonGoals: ['A web front end', 'Paid plans or API keys', 'Rewriting ~/.config/weather-api/providers/openweathermap.credentials.json'],
      focus: 'O1, O3 (swarm/issue-42-forecast-by-city-name-with-five-day-rate-limited-cache)',
    },
  },
};

/** The demo floor's charter: its own, or a generic one for the big company's floors. */
export function demoCharter(fullName: string): DemoCharter {
  const name = fullName.split('/')[1] ?? fullName;
  return (
    CHARTERS[name] ?? {
      charter: {
        mission: `${name.replace(/-/g, ' ')}: a small app people enjoy using every day.`,
        objectives: [
          { id: 'O1', outcome: 'The core flows work end to end', measure: 'every backlog feature has a passing test' },
          { id: 'O2', outcome: 'Works on a phone', measure: 'every screen fits 375px' },
        ],
        standards: ['Tests and build pass on every PR', 'No errors in the browser console'],
        nonGoals: ['Native mobile apps'],
        focus: 'O1',
      },
    }
  );
}

/** The demo CEO's first charter for a floor it onboards (propose_charter's arguments): its mission and QA brief. */
export const demoDraft = (mission: string, qaBrief: string) => ({
  reason: 'A first charter from what I read, so every agent keeps the same goals in view.',
  mission,
  objectives: [
    { outcome: 'The core features work end to end', measure: 'each one has a passing test' },
    { outcome: 'Works on a phone', measure: 'every screen fits 375px' },
  ],
  standards: qaBrief.split('\n'),
});
