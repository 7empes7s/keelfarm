// The demo's checklist (#612): the YouTube app steps the CEO gives the manager, two of them done, a value to copy and a
// secret field, pinned on the first floor. Made-up URLs; the secret saves to the demo's Providers like any other key.
import { applyStep, createChecklist, type ChecklistsState, type StepInput } from '../shared/checklists.ts';

export const SAMPLE_STEPS: StepInput[] = [
  { title: 'Open Google Cloud and pick the project', details: 'Go to [console.cloud.google.com](https://console.cloud.google.com) and pick **office-videos** (or make it).' },
  { title: 'Turn on the YouTube Data API v3', details: 'APIs & Services → Library → search **YouTube Data API v3** → Enable.' },
  { title: 'Add the redirect URI to the OAuth client', details: 'Credentials → your OAuth client → Authorised redirect URIs → Add URI, then Save.', copy: [{ label: 'Redirect URI', value: 'https://office.example.com/api/providers/oauth/google/callback' }] },
  { title: 'Add yourself as a test user', details: 'OAuth consent screen → Test users → Add users: the Google account that owns the channel.' },
  { title: 'Paste the API key', details: 'Credentials → Create credentials → API key, restricted to the YouTube Data API.', secret: { label: 'API key', provider: 'gemini' } },
];

export function checklistSample(s: ChecklistsState, repoId: string | null, now: number) {
  const c = createChecklist(s, { title: 'YouTube app · main Google account', repoId, steps: SAMPLE_STEPS }, now - 20 * 60_000);
  applyStep(c, 's1', { kind: 'tick', done: true }, now - 15 * 60_000);
  applyStep(c, 's2', { kind: 'tick', done: true }, now - 12 * 60_000);
  applyStep(c, 's3', { kind: 'comment', text: 'The Save button was greyed out until I added a second URI. Is that fine?' }, now - 8 * 60_000);
  return c;
}
