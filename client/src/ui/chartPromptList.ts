import type { IconName } from './icons';

// The chat's 📊 Charts (#270): ready prompts the CEO answers with a live chart or dashboard, grouped, and the
// manager's pinned ones (saved per device in localStorage `cubefarm:chart-pins`). Pure, drawn by ChartPrompts.tsx.

export interface ChartPrompt {
  text: string;
  icon: IconName;
}

export const CHART_GROUPS: readonly { title: string; prompts: readonly ChartPrompt[] }[] = [
  {
    title: 'Money',
    prompts: [
      { text: 'Where did the money go this week?', icon: 'wallet' },
      { text: 'Cost per merged PR by floor', icon: 'coins' },
      { text: 'Waste by cause', icon: 'trash-2' },
    ],
  },
  {
    title: 'Work',
    prompts: [
      { text: "What's everyone working on?", icon: 'users' },
      { text: 'Backlog by floor', icon: 'clipboard-list' },
      { text: 'Merges and QA rounds trend', icon: 'git-merge' },
    ],
  },
  {
    title: 'Server',
    prompts: [
      { text: "How's the server?", icon: 'server' },
      { text: 'Memory per agent', icon: 'cpu' },
    ],
  },
  { title: 'Usage', prompts: [{ text: 'Claude usage this week', icon: 'gauge' }] },
];

export const PINS_KEY = 'cubefarm:chart-pins';
const MAX_PINS = 12;
const MAX_CHARS = 200;

/** The saved pins: prompt texts, unreadable or missing as none. */
export function parsePins(raw: string | null): string[] {
  try {
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.slice(0, MAX_CHARS)))].slice(0, MAX_PINS) : [];
  } catch {
    return [];
  }
}

/** Pins after tapping a prompt's pin: added to the top, or taken off. */
export function togglePin(pins: readonly string[], text: string): string[] {
  return pins.includes(text) ? pins.filter((p) => p !== text) : [text.slice(0, MAX_CHARS), ...pins].slice(0, MAX_PINS);
}

/** A pinned prompt's icon: its ready prompt's, else a chart (the CEO's own suggestions). */
export const iconFor = (text: string): IconName => CHART_GROUPS.flatMap((g) => g.prompts).find((p) => p.text === text)?.icon ?? 'chart-column';

/** The CEO's suggestions that are about charts, numbers or trends: the ones offered for pinning here. */
export const chartSuggestions = (suggestions: readonly string[]): string[] => suggestions.filter((s) => /\b(chart|graph|trend|dashboard|breakdown|by (floor|day|agent|kind|cause)|per (merge|agent|floor|day)|cost|spend|usage|memory|cpu|backlog)\b/i.test(s));
