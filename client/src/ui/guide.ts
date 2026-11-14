// "Get the most out of the office" (#109): a checklist read from the office's real state, which ticks itself as the
// manager sets things up. Each unticked item says in one line why it helps and where "Do it" goes. Pure; GuideCard.tsx
// draws it (pocket's Company tab, and a HUD button in the 3D office).
import type { CeoMandate } from '../../../shared/followups';
import type { LabView } from '../../../shared/experiments';
import type { ResearcherView } from '../../../shared/research';
import type { CeoInfo, NotifyChannelsView, RepoView, SwarmSettings } from '../../../shared/types';
import { DOCS } from './emptyStates';
import type { Target } from './goTo';

export interface GuideInput {
  repos: Pick<RepoView, 'id' | 'floor' | 'qaBrief' | 'charter'>[];
  settings: Pick<SwarmSettings, 'notify'> & { ceoMandates: CeoMandate[] };
  notifyChannels: Pick<NotifyChannelsView, 'pushDevices' | 'webhooks' | 'telegram'>;
  experiments: Pick<LabView, 'experiments'>;
  /** The CEO's jobs: research done (kept by the server, #496) or under way. */
  ceo: Pick<CeoInfo, 'job' | 'queue' | 'researchedAt'>;
  /** The Researcher's desk (#664), where research runs. */
  research?: Pick<ResearcherView, 'job' | 'queue'> | null;
  /** This browser runs the office as an installed app (display-mode: standalone). */
  installed: boolean;
}

export interface GuideItem {
  id: 'charter' | 'qaBrief' | 'notify' | 'install' | 'telegram' | 'mandate' | 'experiment' | 'research';
  title: string;
  why: string;
  done: boolean;
  /** Under way: "In progress" instead of Do it. */
  busy?: boolean;
  target: Target;
}

export function guideItems(s: GuideInput): GuideItem[] {
  const floors = s.repos.length > 0;
  const missing = (has: (r: GuideInput['repos'][number]) => boolean) => s.repos.find((r) => !has(r));
  const noCharter = missing((r) => r.charter.objectives.length > 0);
  const noBrief = missing((r) => r.qaBrief.trim() !== '');
  const c = s.notifyChannels;
  const researched = !!s.ceo.researchedAt;
  return [
    {
      id: 'charter',
      title: 'Every floor has a charter with objectives',
      why: 'Agents and QA read it every session, so work stays on what you want.',
      done: floors && !noCharter,
      target: { kind: 'section', section: 'charter', repoId: noCharter?.id },
    },
    {
      id: 'qaBrief',
      title: 'Every floor has a QA brief',
      why: 'QA tests what matters for that kind of project, so fewer rounds.',
      done: floors && !noBrief,
      target: noBrief ? { kind: 'ceo', text: `Write a QA brief for floor ${noBrief.floor}: what QA must check on every pull request there.` } : { kind: 'section', section: 'ceo' },
    },
    {
      id: 'notify',
      title: 'Notifications are on',
      why: 'You hear about stuck work and questions without keeping the office open.',
      done: c.pushDevices > 0 || (s.settings.notify.channels.ntfy && c.webhooks.ntfy.set) || (s.settings.notify.channels.telegram && c.telegram.linked),
      target: { kind: 'section', section: 'notifications' },
    },
    {
      id: 'install',
      title: 'The office is on your phone’s home screen',
      why: 'It opens full screen like an app, and iPhones only push to installed apps.',
      done: s.installed || c.pushDevices > 0,
      target: { kind: 'link', url: `${DOCS}pocket.md#install-it` },
    },
    {
      id: 'telegram',
      title: 'Telegram is linked',
      why: 'Chat with the CEO and get alerts from Telegram, wherever you are.',
      done: c.telegram.linked,
      target: { kind: 'section', section: 'notifications' },
    },
    {
      id: 'mandate',
      title: 'The CEO has a standing mandate',
      why: 'It may then file follow-up issues on its own, within what you allowed.',
      done: s.settings.ceoMandates.length > 0,
      target: { kind: 'section', section: 'ceo' },
    },
    {
      id: 'experiment',
      title: 'An experiment has been tried',
      why: 'Practices become defaults on evidence, not on a hunch.',
      done: s.experiments.experiments.length > 0,
      target: { kind: 'section', section: 'ops' },
    },
    {
      id: 'research',
      title: 'The CEO researched before planning',
      why: 'A plan built on sources and the code beats one from memory.',
      done: researched,
      busy: !researched && (!!s.research?.job || !!s.research?.queue.length),
      target: { kind: 'ceo', text: 'Research: how comparable projects solve our biggest open problem, then propose a plan' }, // "Research:" makes it a research job (server/research.ts)
    },
  ];
}

/** "5/8": items done out of all. */
export const guideProgress = (items: GuideItem[]) => ({ done: items.filter((i) => i.done).length, total: items.length });

// ---------- dismissed (per browser) ----------

const KEY = 'cubefarm.guide.dismissed';

export function guideDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissGuide(v: boolean) {
  try {
    if (v) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    // private windows and blocked storage: the card just comes back next time
  }
}
