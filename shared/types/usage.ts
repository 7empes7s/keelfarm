// Usage for every account and provider (#361): one row per source on the Company page and in Mission control, in
// the accounts view (snapshot and `accounts` event). Imported through shared/types.ts. Never a key.

export type UsageProvider = 'claude' | 'codex' | 'elevenlabs' | 'upstash' | 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'hetzner';
type UsageCategory = 'coding' | 'text' | 'audio' | 'video' | 'image' | 'cloud' | 'mcp';
export type UsageSourceStatus = 'ready' | 'near' | 'limited' | 'signed-out' | 'error';

/** One limit of a source: "5-hour" 42%, or "Characters" 61k of 100k. */
export interface UsageWindow {
  name: string; // "5-hour", "Weekly", "Characters", "Today", "Boxes", "7 days"
  usedPct: number | null; // 0-100; null when there's no limit to measure against (a spend)
  used?: number;
  limit?: number;
  unit?: string; // '$', 'chars', 'Boxes'
  resetsAt: number | null; // epoch ms
}

export interface UsageSource {
  id: string; // the account's id, or 'elevenlabs', 'upstash', 'anthropic-org', 'openai-org'
  provider: UsageProvider;
  category: UsageCategory;
  label: string;
  plan: string; // 'Max', 'Pro', 'Creator', 'API', ''
  windows: UsageWindow[];
  spendUsd7d?: number;
  status: UsageSourceStatus;
  checkedAt: number | null; // when its numbers were read (null: never)
  note?: string; // one plain line: why it's in error, where the numbers come from
  accountId?: string; // a Claude or Codex account's row: its id in Providers & accounts, whose readings it shows
  agents?: string[]; // ids of the agents (and the CEO) pinned to it
  history?: [number, number][]; // [at, worst window %], the last day, for its detail
}
