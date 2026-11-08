// `npm run demo`: a fake GitHub and fake Claude Code sessions, so the office (including the build → QA → fix loop) can
// be explored without spending any usage or touching real repos. Each feature's fakes live in their own module under
// server/demo/ (#257), registered with registerDemo; this file only wires them together.
import type { Backend } from './backend.ts';
import type { DemoScale } from './config.ts';
import { holdDemoPort } from './demoLeftover.ts';
import { buildDemo } from './demo/registry.ts';
import { seedBigCompany } from './demo/seedRepos.ts';
import { repos, restoreNumbers } from './demo/world.ts';
import './demo/index.ts';

export { answerReply, demoGrow, demoMoneyAnswer, demoServerAnswer, demoShrink, type DemoFloor } from './demo/ceo.ts';
export { demoTeam } from './demo/seedRepos.ts';
export { fixPromptPull } from './demo/sessionScripts.ts';
export { demoUsage } from './demo/sessions.ts';
export { demoCatalog } from './demo/tools.ts';

/** The demo's fake world; `scale` (--floors / --agents) makes it the big company instead of the usual two floors. */
export function createDemoBackend(scale: DemoScale | null = null, noTour = false): Backend {
  if (scale) seedBigCompany(scale.floors);
  restoreNumbers();
  holdDemoPort(() => `/demo/${[...repos.keys()][0]}/desks/preview`);
  return { ...buildDemo({ scale, noTour, deskRepo: new Map(), installedDesks: new Set() }), demo: true };
}
