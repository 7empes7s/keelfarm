// The demo CEO's chat replies that show its office tools (#257), tried in this order through the real tools; a new
// tool's demo registers its own reply here or in its feature's module.
import { demoMoneyAnswer, demoServerAnswer, objectiveIds, plannedSize, plural, refused, short } from './ceo.ts';
import { registerCeoReply } from './registry.ts';

// "Where did the money go this week?": a dashboard on the office's live costs (#146, shared/chatVisuals.ts).
registerCeoReply('money', ({ text }) => (/\b(money|spend|spent|spending|costs?)\b/i.test(text) ? demoMoneyAnswer() : null));

// "send me the status on Telegram": through the real tool, refused when Telegram isn't linked.
registerCeoReply('send_telegram', async ({ text, s, use }) => {
  if (!/\btelegram\b/i.test(text)) return null;
  const issues = s.floors.reduce((n, f) => n + f.backlogCounts.open, 0);
  const out = await use('send_telegram', { text: `Status: ${plural(s.floors.length, 'floor')}, ${plural(issues, 'open issue')}, ${plural(s.pendingChanges.length, 'team change')} waiting for you.` });
  return out.startsWith('Refused') ? `I couldn't send it: ${refused(out)}` : 'Sent: the status is on your Telegram.';
});

// "fix your last message": the CEO corrects its latest reply through the real tool (#125), struck through on the phone.
registerCeoReply('edit_message', async ({ text, s, use }) => {
  if (!/\b(fix|correct|edit) your (last |latest )?(message|reply)\b/i.test(text)) return null;
  const out = await use('edit_message', { text: `Correction: ${plural(s.floors.length, 'floor')} and ${plural(s.floors.reduce((n, f) => n + f.pullRequests.length, 0), 'pull request')} in flight, as of now.`, reason: 'the manager asked me to correct it' });
  return out.startsWith('Refused') ? `I couldn't edit it: ${refused(out)}` : 'Corrected: my earlier message now shows what changed, struck through.';
});

// "add to the office playbook: run the linter first": a bullet through the real tool, refused past its cap.
registerCeoReply('set_office_playbook', async ({ text, s, use, detail }) => {
  const rule = text.match(/\boffice playbook\b[^:]*:\s*(.+)/i)?.[1]?.trim();
  if (!rule) return null;
  const now = s.floors[0] ? (await detail(s.floors[0].floor)).officePlaybook : null;
  const out = await use('set_office_playbook', { playbook: [now, `- ${rule}`].filter(Boolean).join('\n') });
  return out.startsWith('Refused') ? `I couldn't add it: ${refused(out)}` : `Added to the office playbook: "${short(rule, 80)}". ${out}`;
});

// "close #3, superseded by #5": through the real tool.
registerCeoReply('close_issue', async ({ text, s, use }) => {
  const close = text.match(/\bclose #(\d+)[\s,:;.-]*(.*)/i);
  const closeFloor = close && (s.floors.find((f) => f.backlog.some((i) => i.number === Number(close[1]))) ?? s.floors[0]);
  if (!close || !closeFloor) return null;
  const reason = close[2].trim() || 'No longer wanted.';
  const out = await use('close_issue', { floor: closeFloor.floor, number: Number(close[1]), reason });
  return out.startsWith('Refused') ? `I couldn't close #${close[1]}: ${refused(out)}` : `Done: ${out} I left "${short(reason, 80)}" on it as a comment.`;
});

// "put the freed agent on #3" / "assign #3 to Ada": through the real tool (#265), before the demo's files.
registerCeoReply('assign_issue', async ({ text, s, use }) => {
  const put = text.match(/\b(?:put|assign)\b(?:.*?\bon #(\d+)|\s+#(\d+)(?:\s+to\s+(\w+))?)/i);
  const putNumber = put && Number(put[1] ?? put[2]);
  const named = put?.[3] && s.floors.find((f) => f.agents?.some((a) => a.name.toLowerCase() === put[3].toLowerCase())); // "to Bjarne": Bjarne's floor
  const putFloor = putNumber && (named || s.floors.find((f) => f.backlog.some((i) => i.number === putNumber)) || s.floors[0]);
  if (!put || !putNumber || !putFloor) return null;
  const out = await use('assign_issue', { floor: putFloor.floor, number: putNumber, ...(put[3] && { agent: put[3] }) });
  return out.startsWith('Refused') ? `I couldn't assign #${putNumber}: ${refused(out)}` : `Done: ${out}`;
}, { early: true });

// "Tighten floor 2's charter": a change for the manager to approve, through the real tool.
registerCeoReply('propose_charter', async ({ text, s, use, detail }) => {
  if (!/\bcharter\b/i.test(text)) return null;
  const f = s.floors.find((x) => new RegExp(`floor ${x.floor}\\b`, 'i').test(text)) ?? s.floors[0];
  if (!f) return 'There are no floors yet: add a project first, and I will draft its charter.';
  const ids = objectiveIds((await detail(f.floor)).charter);
  const out = await use('propose_charter', { floor: f.floor, reason: 'You asked about the charter: finish the first objectives before starting new ones.', focus: ids.length ? `${ids.slice(0, 2).join(', ')}, until they are met` : 'The core flows first' });
  return out.startsWith('Refused') ? `I couldn't propose it: ${refused(out)}` : `I proposed a new focus for floor ${f.floor}'s charter. Approve or edit it in the Charter tab: nothing changes until you do.`;
});

// "Plan the next milestone for floor 1": an issue and a bigger team through the real tools, so the reply shows
// its action cards (#108), with the plan as an artifact and an idea card for the charter.
registerCeoReply('plan', async ({ text, s, use, detail, scale }) => {
  if (!/\b(plan|milestone)\b/i.test(text)) return null;
  const f = s.floors.find((x) => new RegExp(`floor ${x.floor}\\b`, 'i').test(text)) ?? s.floors[0];
  if (!f) return 'There are no floors yet: add a project first, and I will plan its first milestone.';
  const ids = objectiveIds((await detail(f.floor)).charter);
  const filed = await use('file_issue', { floor: f.floor, title: 'Polish: phone layout and empty states', body: `Make every screen work at 390px and add friendly empty states.${ids.length ? `\n\nObjective: ${ids[0]}` : ''}` });
  const team = plannedSize(f.team) < f.team.max ? await scale(f, { size: plannedSize(f.team) + 1, reason: 'One more agent so the milestone lands this week.' }) : '';
  const n = filed.match(/#(\d+)/)?.[1];
  return [
    filed.startsWith('Refused') ? `I couldn't file it: ${refused(filed)}` : `Planned the next milestone on floor ${f.floor}: #${n} first. ${team}`,
    '',
    '```artifact title="Milestone plan"',
    `## Floor ${f.floor}: next milestone`,
    '',
    '| Step | Issue | Who |',
    '| --- | --- | --- |',
    `| Phone polish | #${n ?? '?'} | the team |`,
    '| QA and merge | as PRs land | the office |',
    '```',
    '',
    '```idea objective',
    `Add an objective to floor ${f.floor}: no screen cut off at 390 px`,
    `Add an objective to floor ${f.floor}'s charter: no screen is cut off at 390 px, checked by the layout spec.`,
    '```',
  ].join('\n');
});

// Asked for a bigger team: one more agent where the most work waits, through the real tool.
registerCeoReply('scale_team', ({ text, s, scale }) => {
  if (!/\b(hire|hiring|grow|team|bigger)\b/i.test(text)) return null;
  if (!s.floors.length) return 'There are no floors yet: add a project first, and I will size its team.';
  const room = s.floors.filter((f) => plannedSize(f.team) < f.team.max);
  if (!room.length) return `Every floor is at its most agents (${s.floors[0].team.max}). Raise it in Settings → Most agents per floor, and I'll grow the busiest one.`;
  const f = room.sort((a, b) => b.capacity.issuesReadyToStart - b.team.free - (a.capacity.issuesReadyToStart - a.team.free) || a.floor - b.floor)[0];
  const ready = f.capacity.issuesReadyToStart;
  return scale(f, {
    size: plannedSize(f.team) + 1,
    reason: `You asked for a bigger team, and floor ${f.floor} has the most work waiting: ${plural(ready, 'issue')} ready to start, ${plural(f.team.free, 'agent')} free.`,
  });
});

// "How much of the server is used, and by what?": its live sources (#271). Last, so a plan or a hire about a server isn't taken for it.
registerCeoReply('server', ({ text }) => (/\b(how much|by what|which programs?)\b.*\b(server|memory|ram|cpu)\b|\b(server|memory|cpu) (use|usage|load)\b/i.test(text) ? demoServerAnswer() : null));
