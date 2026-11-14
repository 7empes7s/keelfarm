// The demo's earnings (#666): the server and a Claude plan as fixed costs, a few manual entries, 8 weeks of Claude
// and provider spend before the demo ledger starts, and the first floor's feed on the demo clipfarm (gcloud.ts).
import { dayKey } from '../shared/journal.ts';
import { addEntry, addFixed, setFeed, type EarningsState } from '../shared/earnings.ts';

const DEMO_FEED_URL = 'https://clip.techinsiderbytes.com/api/earnings';

export function earningsSample(s: EarningsState, repoIds: readonly string[], now: number) {
  const day = (back: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - back);
    return d.getTime();
  };
  addFixed(s, { label: 'Server (Hetzner)', usdPerMonth: 38 });
  addFixed(s, { label: 'Claude Max', usdPerMonth: 200 });
  addEntry(s, { date: dayKey(day(1)), usd: 250, source: 'Sponsor', note: 'Newsletter slot', repoId: repoIds[1] ?? null }, now);
  addEntry(s, { date: dayKey(day(9)), usd: 120, source: 'Consulting', repoId: null }, now);
  addEntry(s, { date: dayKey(day(23)), usd: 90, source: 'Sponsor', repoId: repoIds[1] ?? null }, now);
  for (let i = 0; i < 56; i++) {
    const claude: Record<string, number> = { '': 4 + (i % 4) };
    repoIds.forEach((id, n) => (claude[id] = 9 + ((i + n * 3) % 6) * 2));
    s.spend[dayKey(day(i))] = { claude, providers: { 'ElevenLabs': 0.6, 'OpenAI API · organisation': 1.1 + (i % 3) * 0.3 } };
  }
  if (repoIds[0]) setFeed(s, repoIds[0], DEMO_FEED_URL);
}
