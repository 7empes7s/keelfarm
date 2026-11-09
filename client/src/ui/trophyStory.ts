// A trophy's story for its card (#311), pure: what it was for, when it was won, and the PR and floor its detail names
// (the ledger writes "PR #12 on owner/repo"). A locked one says only how to win it.
import { achievementDef, type AchievementView } from '../../../shared/progress';
import type { RepoView } from '../../../shared/types';

export interface TrophyStory {
  /** The trophy's emoji; null on a locked one, which shows the lock icon. */
  icon: string | null;
  name: string;
  /** What it was for; on a locked one, what it takes. */
  blurb: string;
  locked: boolean;
  /** When it was won, as the player reads dates. */
  when: string | null;
  detail: string | null;
  pr: { n: number; url: string } | null;
  floor: { n: number; name: string } | null;
}

export function trophyStory(id: string, achievements: AchievementView[], repos: Pick<RepoView, 'fullName' | 'url' | 'floor'>[]): TrophyStory | null {
  const def = achievementDef(id);
  if (!def) return null;
  const got = achievements.find((a) => a.id === id);
  if (!got) return { icon: null, name: 'A locked trophy', blurb: def.blurb, locked: true, when: null, detail: null, pr: null, floor: null };
  const detail = got.detail || null;
  // the longest name the detail mentions, so "o/app" never wins over "o/app-2"
  const repo = detail ? repos.filter((r) => detail.includes(r.fullName)).sort((a, b) => b.fullName.length - a.fullName.length)[0] : undefined;
  const m = detail?.match(/PR #(\d+) on ([\w.-]+\/[\w.-]+)/);
  const pr = m ? { n: Number(m[1]), url: `${repo?.fullName === m[2] ? repo.url : `https://github.com/${m[2]}`}/pull/${m[1]}` } : null;
  return {
    icon: def.icon,
    name: def.name,
    blurb: def.blurb,
    locked: false,
    when: new Date(got.at).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    detail,
    pr,
    floor: repo ? { n: repo.floor, name: repo.fullName } : null,
  };
}
