// The demo office's made-up history (#257): a past week of ops, costs, careers, the lab, notices, the chat, a charter
// and a QA report, so a fresh demo shows every panel full.
import { demoCharter } from '../demoCharters.ts';
import { demoEditedChat, demoThreads } from '../demoChat.ts';
import { DEMO_QA_ISSUE, demoQaReport } from '../demoQa.ts';
import { sampleCareers, sampleHistory, samplePastCareers } from '../careerSample.ts';
import { sampleLog } from '../charterSample.ts';
import { sampleChat } from '../chatSample.ts';
import { sampleOffice } from '../costSample.ts';
import { demoSurvival, sampleLab } from '../experimentSample.ts';
import { sampleNotices } from '../noticeSample.ts';
import { demoPastWeek } from '../opsSample.ts';
import { registerDemo } from './registry.ts';
import { demoTeam } from './seedRepos.ts';
import { fakeSha, issue, repos, takeNumber } from './world.ts';

registerDemo('samples', ({ scale, noTour }) => ({
  survivalSignals: demoSurvival,
  seedOps: (ids, at) => demoPastWeek(ids, at),
  seedCosts: (floors, agents, at) => sampleOffice(floors.map((f) => ({ id: f.id, open: repos.get(f.fullName)?.issues.map((i) => i.number) })), agents, at, Math.random, scale ? 7 : 28), // four weeks for the Charter tab's sparklines; the big company keeps one
  seedCharterLog: (charter, ledger, now) => sampleLog(charter, ledger, now, Math.random),
  seedCareers: sampleCareers, seedPastCareers: samplePastCareers, seedHistory: sampleHistory,
  demoTeam: (floor) => demoTeam(scale, floor),
  demoNoTour: noTour,
  seedLab: sampleLab,
  seedNotices: sampleNotices,
  seedChat: (now, cards) => {
    const edits = demoEditedChat(now).map((m, i) => ({ ...m, id: i + 1 }));
    return [...edits, ...sampleChat(now, edits.length + 1, scale ? undefined : cards)]; // the big company measures the office (scale.test.ts), not the cards' example
  },
  seedThreads: demoThreads,
  demoCharter,
  seedQaReport: (fullName) => {
    if (scale) return null; // the big company measures the office (scale.test.ts), not this example
    const r = repos.get(fullName);
    if (!r) return null;
    const stuck = { ...issue(takeNumber(r), DEMO_QA_ISSUE.title, DEMO_QA_ISSUE.body, fullName), createdAt: new Date(Date.now() - 5 * 3_600_000).toISOString() };
    r.issues.push(stuck);
    const seeded = demoQaReport(fullName, takeNumber(r), stuck, 3 * 3_600_000, fakeSha());
    r.pulls.unshift(seeded.pull);
    return seeded;
  },
}));
