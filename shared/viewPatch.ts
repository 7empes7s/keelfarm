// Whole views sent as patches (#491): the CEO's, the test lab's and the accounts' views change many times a minute in a
// big company, mostly in one small field, so the outbox sends only their top-level fields that changed (drop: the ones
// now absent) and the tab merges them into what it has.

export interface ViewPatch<T> {
  set: Partial<T>;
  drop?: (keyof T & string)[];
}

/** Equal values: the same, or objects with the same JSON. */
export const same = (a: unknown, b: unknown) => a === b || (typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b));

/** The top-level fields of `next` that differ from `sent`; null when nothing changed. Every field when `sent` is missing. */
export function viewPatch<T extends object>(sent: T | undefined, next: T): ViewPatch<T> | null {
  if (!sent) return { set: { ...next } };
  const set: Partial<T> = {};
  let changed = false;
  for (const key of Object.keys(next) as (keyof T)[]) {
    if (same(sent[key], next[key])) continue;
    set[key] = next[key];
    changed = true;
  }
  const drop = (Object.keys(sent) as (keyof T & string)[]).filter((key) => !(key in next));
  if (!changed && !drop.length) return null;
  return drop.length ? { set, drop } : { set };
}

/** `base` with the patch applied, as a new object. */
export function applyViewPatch<T extends object>(base: T | null | undefined, patch: ViewPatch<T>): T {
  const out = { ...base, ...patch.set } as T;
  for (const key of patch.drop ?? []) delete out[key];
  return out;
}
