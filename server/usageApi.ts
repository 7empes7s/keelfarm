// The providers' usage endpoints (#361) through Node's fetch. The key goes in the request's header and nowhere else;
// a failure carries only the HTTP status (UsageFetchError).
import { UsageFetchError, type UsageApi } from './usageSources.ts';

const DAY = 24 * 60 * 60_000;

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new UsageFetchError(0);
  }
  if (!res.ok) throw new UsageFetchError(res.status);
  return res.json().catch(() => {
    throw new UsageFetchError(res.status);
  });
}

/** The start of the UTC day six days before `now`: seven daily buckets with today's. */
const weekStart = (now: number) => Math.floor(now / DAY) * DAY - 6 * DAY;

export const realUsageApi: UsageApi = {
  // https://elevenlabs.io/docs/api-reference/user/subscription/get
  elevenLabs: (key) => getJson('https://api.elevenlabs.io/v1/user/subscription', { 'xi-api-key': key }),
  costs: (provider, key, now) =>
    provider === 'anthropic'
      ? // https://platform.claude.com/docs/en/build-with-claude/usage-cost-api
        getJson(`https://api.anthropic.com/v1/organizations/cost_report?starting_at=${encodeURIComponent(new Date(weekStart(now)).toISOString())}&bucket_width=1d&limit=7`, { 'x-api-key': key, 'anthropic-version': '2023-06-01' })
      : getJson(`https://api.openai.com/v1/organization/costs?start_time=${Math.floor(weekStart(now) / 1000)}&bucket_width=1d&limit=7`, { Authorization: `Bearer ${key}` }),
};
