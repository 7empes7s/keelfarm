import { describe, expect, it } from 'vitest';
import {
  ACTIVE_MS,
  due,
  GRACE_MS,
  group,
  inApp,
  nextDue,
  note,
  noteText,
  ntfyPayload,
  ntfyTarget,
  parseAttention,
  parseWebhook,
  plainText,
  queue,
  read,
  readNotes,
  redact,
  secretValues,
  STUCK_ERROR_MS,
  stuckAgents,
  THREAD_GAP_MS,
  webhookHint,
  type Note,
  type Step,
  type Threads,
} from './notify.ts';

const merge = (n: number) => note('merge', `Merged PR #${n}`, `pixel-todo: Change ${n}`, `pixel-todo #${n} Change ${n}`);
const said = (n: number) => note('ceoMessage', 'Mimoun', `Line ${n}`, `Mimoun: Line ${n}`, undefined, `m${n}`);

/** Queues every note at its time (the manager in the app when `present` says so), running the timer every second up to `until`. */
function run(notes: [number, Note][], until: number, present: (t: number) => boolean = () => false, reads: [number, string[]][] = []) {
  let threads: Threads = {};
  const sent: [number, Note][] = [];
  const skipped: Note[] = [];
  const cleared: [number, string][] = [];
  const take = (t: number, r: Step) => {
    threads = r.threads;
    for (const n of r.send) sent.push([t, n]);
    skipped.push(...r.skipped);
    for (const e of r.clear) cleared.push([t, e]);
  };
  for (let t = 0; t <= until; t += 1000) {
    for (const [at, n] of notes) if (at >= t - 1000 && at < t) take(at, queue(threads, n, at, present(at)));
    for (const [at, events] of reads) if (at >= t - 1000 && at < t) take(at, read(threads, events));
    take(t, due(threads, t, present(t)));
  }
  return { sent, skipped, cleared, threads };
}

describe('quiet while in the app (#210)', () => {
  it('sends nothing to any device while the manager is in the app on one of them', () => {
    const { sent, skipped } = run([[100, said(1)], [200, merge(1)]], 10 * 60_000, () => true);
    expect(sent).toEqual([]);
    expect(skipped.map((n) => n.title)).toEqual(['💬 Mimoun', '🔀 Merged PR #1']);
  });

  it('knows "in the app" as a tab on screen and used in the last minute, on any device', () => {
    expect(inApp([], 0)).toBe(false);
    expect(inApp([{ visible: false, at: 1000 }], 1000)).toBe(false); // a hidden tab (the phone in a pocket)
    expect(inApp([{ visible: true, at: 0 }], ACTIVE_MS)).toBe(false); // on screen but left alone for a minute
    expect(inApp([{ visible: false, at: 0 }, { visible: true, at: 5000 }], ACTIVE_MS)).toBe(true);
  });

  it('sends one notification after the grace when nobody is in the app', () => {
    const { sent } = run([[0, said(1)]], 5 * 60_000);
    expect(sent.map(([t, n]) => [t, n.title, n.body])).toEqual([[GRACE_MS, '💬 Mimoun', 'Line 1']]);
  });

  it('cancels a note read on a device within the grace, and clears nothing it never sent', () => {
    const { sent, cleared } = run([[0, said(1)]], 5 * 60_000, () => false, [[5_000, ['ceoMessage']]]);
    expect(sent).toEqual([]);
    expect(cleared).toEqual([]);
  });

  it('skips what waits if the manager opens the app during the grace', () => {
    const { sent, skipped } = run([[0, said(1)]], 5 * 60_000, (t) => t >= 10_000);
    expect(sent).toEqual([]);
    expect(skipped.map((n) => n.id)).toEqual(['m1']);
  });

  it('turns a burst of 10 messages into one notification with a count of 10 and the latest line', () => {
    const burst: [number, Note][] = Array.from({ length: 10 }, (_, i) => [i * 500, said(i + 1)]);
    const { sent } = run(burst, 10 * 60_000);
    expect(sent).toHaveLength(1);
    expect(sent[0][1]).toMatchObject({ title: '💬 Mimoun: 10 new messages', body: 'Line 10', count: 10, id: 'm10' });
  });

  it('sends at most one per thread every two minutes while unread, the count going up in place', () => {
    const steady: [number, Note][] = Array.from({ length: 30 }, (_, i) => [i * 10_000, said(i + 1)]);
    const { sent } = run(steady, 10 * 60_000);
    const times = sent.map(([t]) => t);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(THREAD_GAP_MS);
    expect(sent.at(-1)![1].count).toBe(30); // nothing read: every message is still in the count
  });

  it('keeps each event its own thread', () => {
    const { sent } = run([[0, merge(1)], [10, note('needsHuman', 'PR #4 needs you', 'x')], [20, merge(2)]], 60_000);
    expect(sent.map(([, n]) => n.title)).toEqual(['🔀 2 merges', '⚠️ PR #4 needs you']);
    expect(sent[0][1].body).toBe('• pixel-todo #2 Change 2\n• pixel-todo #1 Change 1');
  });

  it('clears a sent notification on every device once it is read on one', () => {
    const { sent, cleared, threads } = run([[0, said(1)]], 60_000, () => false, [[30_000, ['ceoMessage']]]);
    expect(sent).toHaveLength(1);
    expect(cleared).toEqual([[30_000, 'ceoMessage']]);
    expect(threads.ceoMessage).toBeUndefined();
  });

  it('reads a thread once all its notices are read', () => {
    let threads = queue({}, said(1), 0, false).threads;
    threads = queue(threads, said(2), 1, false).threads;
    threads = due(threads, GRACE_MS, false).threads;
    expect(readNotes(threads, ['m1']).clear).toEqual([]);
    expect(readNotes(threads, ['m1', 'm2']).clear).toEqual(['ceoMessage']);
  });

  it('knows when the next thread is due', () => {
    let threads: Threads = {};
    expect(nextDue(threads)).toBeNull();
    threads = queue(threads, merge(1), 1000, false).threads;
    expect(nextDue(threads)).toBe(1000 + GRACE_MS);
    threads = due(threads, 1000 + GRACE_MS, false).threads;
    expect(nextDue(threads)).toBeNull();
    threads = queue(threads, merge(2), 20_000, false).threads;
    expect(nextDue(threads)).toBe(1000 + GRACE_MS + THREAD_GAP_MS);
  });

  it('keeps counting what it had no room to keep', () => {
    let threads: Threads = {};
    for (let i = 1; i <= 80; i++) threads = queue(threads, merge(i), i, false).threads;
    const [s] = due(threads, GRACE_MS + 100, false).send;
    expect(s.title).toBe('🔀 80 merges');
    expect(s.body).toMatch(/^• pixel-todo #80 Change 80\n[\s\S]*…and 75 more$/);
  });

  it("reads a tab's attention from /ws and ignores anything else", () => {
    expect(parseAttention(JSON.stringify({ type: 'attention', visible: true }))).toEqual({ type: 'attention', visible: true });
    expect(parseAttention(JSON.stringify({ type: 'attention', visible: 'yes' }))).toBeNull();
    expect(parseAttention(JSON.stringify({ type: 'lines', floor: 1 }))).toBeNull();
    expect(parseAttention('not json')).toBeNull();
  });
});

describe('what a note says', () => {
  const n = note('needsHuman', 'PR #12 needs you', 'pixel-todo: Add login. Stuck because it failed QA 3 times.');

  it('reads the same everywhere, short, with the link to the office when there is one', () => {
    expect(noteText(n)).toBe('⚠️ PR #12 needs you\npixel-todo: Add login. Stuck because it failed QA 3 times.');
    expect(noteText(n, 'https://office.example.ts.net/')).toBe('⚠️ PR #12 needs you\npixel-todo: Add login. Stuck because it failed QA 3 times.\nhttps://office.example.ts.net/');
    expect(note('merge', 'x', 'y'.repeat(1000)).body.length).toBeLessThanOrEqual(300);
  });

  it('fits ntfy', () => {
    expect(ntfyPayload(n, 'my-topic', 'https://o.example/')).toEqual({ topic: 'my-topic', title: n.title, message: n.body, priority: 4, click: 'https://o.example/' });
    expect(ntfyPayload(note('merge', 'm', 'b'), 't')).toEqual({ topic: 't', title: '🔀 m', message: 'b', priority: 3 });
  });

  it("turns a CEO's markdown into one plain line", () => {
    expect(plainText('## Update\n- **Ada** shipped [#12](https://github.com/x/y/pull/12)\n- `npm test` passes')).toBe('Update Ada shipped #12 npm test passes');
    expect(plainText('Both are *easy to get wrong* for _keyboard_ users; snake_case stays.')).toBe('Both are easy to get wrong for keyboard users; snake_case stays.');
  });

  it('groups a thread, and leaves a single note alone', () => {
    const one = merge(1);
    expect(group([one])).toBe(one);
    expect(group([said(1), said(2)])).toEqual({ event: 'ceoMessage', title: '💬 Mimoun: 2 new messages', body: 'Line 2', line: 'Mimoun: Line 2', count: 2, id: 'm2' });
  });
});

describe('chat app settings', () => {
  it('takes real-looking topic URLs and refuses the rest', () => {
    expect(parseWebhook('ntfy', { url: ' https://ntfy.sh/my-office-a8f3/ ' })).toEqual({ url: 'https://ntfy.sh/my-office-a8f3' });
    expect(parseWebhook('ntfy', { url: 'http://ntfy.lan/office', token: 'tk_abcdefgh123' })).toEqual({ url: 'http://ntfy.lan/office', token: 'tk_abcdefgh123' });
    expect(() => parseWebhook('ntfy', { url: 'https://ntfy.sh/' })).toThrow(/topic URL/);
    expect(() => parseWebhook('ntfy', { url: 'ftp://ntfy.sh/office' })).toThrow(/ntfy topic URL/);
    expect(() => parseWebhook('ntfy', { url: 'not a url' })).toThrow(/ntfy topic URL/);
    expect(() => parseWebhook('ntfy', { url: 'https://ntfy.sh/office', token: 'no spaces allowed' })).toThrow(/access token/);
  });

  it('removes a chat app with an empty url or token', () => {
    expect(parseWebhook('ntfy', { url: '' })).toBeNull();
    expect(parseWebhook('ntfy', {})).toBeNull();
    expect(parseWebhook('ntfy', null)).toBeNull();
  });

  it('publishes to the ntfy server root with the topic in the body', () => {
    expect(ntfyTarget('https://ntfy.sh/my-office')).toEqual({ root: 'https://ntfy.sh/', topic: 'my-office' });
  });

  it('hints at a saved webhook without giving it away', () => {
    const secrets = { ntfy: { url: 'https://ntfy.sh/secret-topic-q7r8', token: 'tk_secret_token_1' } };
    expect(webhookHint('ntfy', secrets.ntfy)).toBe('ntfy.sh/…q7r8 · with a token');
    expect(webhookHint('ntfy', { url: 'https://ntfy.sh/secret-topic-q7r8' })).toBe('ntfy.sh/…q7r8');
    expect(webhookHint('ntfy', undefined)).toBe('');
    for (const v of secretValues(secrets)) expect(webhookHint('ntfy', secrets.ntfy)).not.toContain(v);
  });

  it('redacts secrets and URL paths from anything logged', () => {
    expect(redact('failed: token tk_abc123 posted to https://ntfy.sh/secret-topic', ['tk_abc123'])).toBe('failed: token •••• posted to https://ntfy.sh/••••');
  });
});

describe('stuck agents', () => {
  const now = 1_000_000_000;
  const agent = (id: string, status: string, endedAt: number | null) => ({ id, status, endedAt });

  it('finds agents in an error for 10 minutes, once per error', () => {
    const agents = [agent('a', 'error', now - STUCK_ERROR_MS), agent('b', 'error', now - STUCK_ERROR_MS + 1), agent('c', 'idle', now - 3_600_000), agent('d', 'error', null)];
    expect(stuckAgents(agents, now, new Set()).map((s) => s.key)).toEqual([`a:${now - STUCK_ERROR_MS}`]);
    expect(stuckAgents(agents, now, new Set([`a:${now - STUCK_ERROR_MS}`]))).toEqual([]);
    // A new error (a later endedAt) is a new key.
    expect(stuckAgents([agent('a', 'error', now - STUCK_ERROR_MS - 5)], now + 5, new Set([`a:${now - STUCK_ERROR_MS}`]))).toHaveLength(1);
  });
});
