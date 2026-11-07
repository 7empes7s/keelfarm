// Folding the Kanban's columns (#154), pure: which start folded, the manager's choice per floor (saved in localStorage
// `cubefarm:kanban-fold` by KanbanView) and the one-line summary a folded column's header shows.
import type { KanbanCard, KanbanColumns } from '../store';

export type ColumnId = keyof KanbanColumns;
/** One floor's choices: true folded, false open; a column not in it follows the default. */
type Folds = Partial<Record<ColumnId, boolean>>;
/** Every floor's choices, by repo id. */
export type FoldMap = Record<string, Folds>;

export const COLUMN_IDS: readonly ColumnId[] = ['backlog', 'progress', 'qa', 'ready', 'merged'];
/** On a phone the columns stack: the waiting and the finished ones start folded, so the work in hand is on the first screen. */
const PHONE_FOLDED: ReadonlySet<ColumnId> = new Set(['backlog', 'merged']);

export function isFolded(map: FoldMap, repoId: string, id: ColumnId, phone: boolean): boolean {
  return map[repoId]?.[id] ?? (phone && PHONE_FOLDED.has(id));
}

/** `map` with the manager's choice for one column of one floor. */
export function withFold(map: FoldMap, repoId: string, id: ColumnId, folded: boolean): FoldMap {
  return { ...map, [repoId]: { ...map[repoId], [id]: folded } };
}

/** The saved choices, keeping only known columns' booleans; anything unreadable is no choice. */
export function parseFolds(raw: string | null): FoldMap {
  let data: unknown;
  try {
    data = JSON.parse(raw ?? '{}');
  } catch {
    return {};
  }
  const out: FoldMap = {};
  if (!data || typeof data !== 'object') return out;
  for (const [repoId, folds] of Object.entries(data)) {
    if (!folds || typeof folds !== 'object') continue;
    const clean: Folds = {};
    for (const id of COLUMN_IDS) {
      const v = (folds as Record<string, unknown>)[id];
      if (typeof v === 'boolean') clean[id] = v;
    }
    out[repoId] = clean;
  }
  return out;
}

const counts = (parts: [number, string][]) =>
  parts
    .filter(([n]) => n > 0)
    .map(([n, label]) => `${n} ${label}`)
    .join(' · ');

/** A folded column's stats, e.g. "28 ready · 2 waiting · next #112"; '' when it's empty. */
export function foldSummary(id: ColumnId, cards: KanbanCard[]): string {
  if (!cards.length) return '';
  const where = (f: (c: KanbanCard) => boolean) => cards.filter(f).length;
  switch (id) {
    case 'backlog': {
      // waiting on another issue (⏳) or on the manager (a closed PR's issue)
      const waits = (c: KanbanCard) => c.tone === 'warn' || !!c.note?.startsWith('⏳');
      const next = cards.find((c) => !waits(c));
      return [counts([[where((c) => !waits(c)), 'ready'], [where(waits), 'waiting']]), next ? `next #${next.number}` : ''].filter(Boolean).join(' · ');
    }
    case 'progress':
      return counts([
        [where((c) => !c.tone), 'working'],
        [where((c) => c.tone === 'bad'), 'need help'],
        [where((c) => c.tone === 'warn'), 'stopped'],
      ]);
    case 'qa':
      return counts([
        [where((c) => c.qa?.status === 'testing'), 'testing'],
        [where((c) => c.qa?.status === 'fixing'), 'fixing'],
        [where((c) => c.qa?.status === 'needs-human'), 'need you'],
        [where((c) => c.qa?.status === 'failed'), 'failed'],
        [where((c) => !c.qa?.status || c.qa.status === 'queued'), 'waiting'],
      ]);
    case 'ready':
      return counts([[cards.length, 'passed QA']]);
    case 'merged':
      return `${counts([[cards.length, 'merged']])} · latest #${cards[0].number}`;
  }
}
