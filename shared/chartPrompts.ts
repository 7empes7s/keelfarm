// The chat's 📊 Charts (#270): ready prompts the CEO answers with a live chart or dashboard (shared/chatVisuals.ts),
// grouped, plus the manager's pins (saved per device) and the chart prompts the CEO suggested. Pure.

export const CHART_GROUPS = ['Money', 'Work', 'Server', 'Usage'] as const;
export type ChartGroup = (typeof CHART_GROUPS)[number];

export const CHART_PROMPTS = [
  { id: 'money', group: 'Money', text: 'Where did the money go this week?' },
  { id: 'per-merge', group: 'Money', text: 'Cost per merged PR by floor' },
  { id: 'waste', group: 'Money', text: 'Waste by cause' },
  { id: 'working', group: 'Work', text: "What's everyone working on?" },
  { id: 'backlog', group: 'Work', text: 'Backlog by floor' },
  { id: 'merges', group: 'Work', text: 'Merges and QA rounds trend' },
  { id: 'server', group: 'Server', text: "How's the server?" },
  { id: 'memory', group: 'Server', text: 'Memory per agent' },
  { id: 'usage', group: 'Usage', text: 'Claude usage this week' },
] as const satisfies readonly { id: string; group: ChartGroup; text: string }[];

export type ChartPromptId = (typeof CHART_PROMPTS)[number]['id'];

/** At most this many pins, so the list stays a glance. */
export const MAX_PINS = 8;

/** The saved pins, as written to the device: prompt texts, deduplicated and capped; anything unreadable is none. */
export function readPins(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()))].slice(0, MAX_PINS) : [];
  } catch {
    return [];
  }
}

/** Pins a prompt to the top (newest first), or unpins it. */
export function togglePin(pins: readonly string[], text: string): string[] {
  return pins.includes(text) ? pins.filter((p) => p !== text) : [text, ...pins].slice(0, MAX_PINS);
}

const CHARTY = /\b(chart|graph|plot|dashboard|trend|breakdown|by floor|by agent|by cause|per (agent|floor|merge|day))\b/i;

/** The CEO's suggested replies that ask for a chart, newest first, without the ready ones: what the sheet offers to pin. */
export function ceoChartPrompts(messages: readonly { from: string; suggestions?: string[] }[]): string[] {
  const ready = new Set<string>(CHART_PROMPTS.map((p) => p.text));
  const out: string[] = [];
  for (let i = messages.length - 1; i >= 0 && out.length < 4; i--) {
    const m = messages[i];
    if (m.from !== 'ceo') continue;
    for (const s of m.suggestions ?? []) if (CHARTY.test(s) && !ready.has(s) && !out.includes(s) && out.length < 4) out.push(s);
  }
  return out;
}
