// The setup advisor (#366): each floor's use case, the gaps between its setup and that use case's recommendation, and
// the one-tap actions on them. Rules and the recommendations table are pure, in shared/setup.ts and shared/useCases.ts.
import type { AgentCli } from './agents.ts';

export type UseCase = 'web-app' | 'api' | 'game-3d' | 'static-site' | 'cli-library' | 'mobile' | 'design' | 'video' | 'marketing' | 'ops' | 'research' | 'agency';

/** What the office does itself when the manager (or the CEO) taps an action. */
export type SetupFix =
  | { kind: 'qaBrief' } // add the use case's QA checks to the floor's QA brief
  | { kind: 'preview' } // set the use case's preview command
  | { kind: 'browserTesting' } // switch the floor's browser testing on
  | { kind: 'testLab' } // switch the Test lab on for everyone
  | { kind: 'skill'; id: string } // switch a Tools & skills item on for builders
  | { kind: 'cli'; agentId: string; cli: AgentCli; model: string } // move an agent to the recommended coding agent
  | { kind: 'companyUseCase' }; // add the floor's use case to the company's main use cases

/** A sheet the client opens, prefilled where it can. */
export type SetupSheet = 'providers' | 'accounts' | 'floor' | 'tools' | 'terminal' | 'guide';

export type SetupAction =
  | { label: string; fix: SetupFix }
  | { label: string; open: SetupSheet; agentId?: string };

/** One gap between a floor's setup and its use case's recommendation; its first action is the recommended one. */
export interface SetupGap {
  id: string; // stable: 'preview', 'qa-brief', 'provider:video', 'signin:<agent id>' …, for Not now and the one notification
  title: string; // "No preview command"
  why: string; // one plain sentence
  /** Agents can't work until it's fixed: those agents take no work meanwhile. */
  blocks?: string[];
  actions: SetupAction[];
}

/** A floor's setup as RepoView carries it. */
export interface FloorSetupView {
  useCase: UseCase | null; // null: not guessed yet (the checkout isn't there yet)
  guessed: boolean; // the office's guess, not the manager's pick
  guessWhy: string; // "three in package.json"
  gaps: SetupGap[]; // open and not snoozed, recommended first
  snoozed: number; // gaps the manager said Not now to
  /** New floor or a changed use case: show the checklist sheet until the manager closes it. */
  review: boolean;
}
