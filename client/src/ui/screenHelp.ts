// "What can I do here?" (#109): the ⓘ sheet on each main screen (pocket's tabs, every console section): what the screen
// shows, its three most useful actions, and where the docs explain it. All the words are here, so they stay alike.
import type { SectionId } from './consoleNavRules';
import { DOCS } from './emptyStates';

export type ScreenId = SectionId | 'company' | 'kanban' | 'pocket-team' | 'approvals';

export interface ScreenHelp {
  title: string;
  shows: string;
  actions: [string, string, string];
  docs: string;
}

const HOW = `${DOCS}how-it-works.md`;
const POCKET = `${DOCS}pocket.md`;

export const SCREEN_HELP: Record<ScreenId, ScreenHelp> = {
  company: {
    title: 'Company',
    shows: "Every floor's pipeline at a glance: building, in QA, fixing, ready and what needs you, plus Claude's usage and the CEO.",
    actions: ['Tap Board or Team on a floor to see its work and people.', 'Tick off the guide card to get the most from the office.', 'Search anything from the search box at the top.'],
    docs: `${HOW}#how-an-issue-flows-through-the-office`,
  },
  kanban: {
    title: 'Kanban',
    shows: "A floor's issues and pull requests, from backlog to merged. Each card says where it stands and what happens next.",
    actions: ['+ New issue files one on GitHub; a free agent picks it up.', 'Turn on auto-assign and auto-merge so work flows by itself.', 'Preview runs a pull request beside main to try it.'],
    docs: `${HOW}#how-an-issue-flows-through-the-office`,
  },
  'pocket-team': {
    title: 'Team',
    shows: 'Everyone on every floor: what they are doing now and what happens next.',
    actions: ['Open an agent’s terminal to watch them work.', 'Message an agent, or hand a free one an issue.', 'Stop a session that went the wrong way.'],
    docs: `${HOW}#the-team`,
  },
  approvals: {
    title: 'Approvals',
    shows: 'Decisions only you can make: team changes, charter proposals, stuck pull requests and ones to merge by hand.',
    actions: ['Approve or decline the CEO’s team changes.', 'Retry QA, send a stuck PR back, or merge it anyway.', 'Turn on notifications so you hear when something lands here.'],
    docs: `${HOW}#qa`,
  },
  floors: {
    title: 'Floors & repos',
    shows: 'Each project’s floor: its switches, preview and folder, the office’s own update, and adding a project.',
    actions: ['Add a project from GitHub or a folder.', 'Switch auto-assign and auto-merge per floor.', 'Set up the floor’s app preview.'],
    docs: `${HOW}#floor-previews`,
  },
  issues: {
    title: 'Issues',
    shows: 'Every open issue on a floor, who has it, and a form to file a new one.',
    actions: ['File an issue, optionally straight to a free agent.', 'Assign an open issue by hand.', 'Close an issue as not planned.'],
    docs: `${HOW}#how-an-issue-flows-through-the-office`,
  },
  team: {
    title: 'Team',
    shows: 'Each floor’s agents, their coding agent, model, effort and look.',
    actions: ['Add an agent to a floor.', 'Change an agent’s model or effort.', 'Let an agent go from its options menu.'],
    docs: `${DOCS}agents.md`,
  },
  ops: {
    title: 'Mission control',
    shows: 'Claude’s usage, what needs you, the office doctor, the numbers, costs, experiments and server health.',
    actions: ['Act on an alarm that needs you.', 'See where the plan’s usage goes and what was wasted.', 'Start an experiment on a practice.'],
    docs: `${HOW}#mission-control`,
  },
  charter: {
    title: 'Charter',
    shows: 'Each floor’s mission, objectives, standards and non-goals, with numbers per objective and where the week went.',
    actions: ['Edit the charter, or approve the CEO’s proposal.', 'Add an objective with how you will know it is met.', 'Check drift: merged work by objective.'],
    docs: `${HOW}#how-an-issue-flows-through-the-office`,
  },
  map: {
    title: 'Memory map',
    shows: 'The company and its projects as a graph: floors, agents, issues, pull requests and files, and how they connect.',
    actions: ['Search the map for an agent, issue or file.', 'Open a node’s local graph to see what touches it.', 'Colour by floor or objective to spot drift.'],
    docs: `${HOW}#how-an-issue-flows-through-the-office`,
  },
  ceo: {
    title: 'The CEO',
    shows: 'The CEO’s chat, model and effort, standing mandates, team changes and each floor’s brief and QA brief.',
    actions: ['Add a standing mandate so follow-ups can file issues.', 'Write or ask for a floor’s QA brief.', 'Review the company now.'],
    docs: `${HOW}#the-team`,
  },
  'ceo-settings': {
    title: 'CEO settings',
    shows: 'How the CEO works: team changes, reviews, research time, follow-ups and its kept session.',
    actions: ['Choose whether team changes wait for you.', 'Set how often the company is reviewed.', 'Pick which events wake the CEO.'],
    docs: `${HOW}#the-team`,
  },
  'it-dept': {
    title: 'IT department',
    shows: "Your chat with the IT lead, who owns this machine's health, and how IT runs: its account, model and Telegram bot.",
    actions: ['Ask how much disk is free.', 'Run or skip a proposed clean-up.', 'Pick the account and model IT runs on.'],
    docs: `${HOW}#the-team`,
  },
  tools: {
    title: 'Tools & skills',
    shows: 'The plugins, skills and MCP servers a session can load, and switches for everyone, the CEO and each agent.',
    actions: ['Switch a tool off for everyone.', 'Give one agent a skill the others skip.', 'Keep sessions lean to save usage.'],
    docs: `${DOCS}agents.md`,
  },
  history: {
    title: 'Sessions',
    shows: 'Every finished session: who, what, how it ended, its cost and transcript.',
    actions: ['Filter by agent, floor or pull request.', 'Open a transcript to see what happened.', 'Spot sessions that ended without a result.'],
    docs: `${HOW}#where-things-live`,
  },
  'daily-log': {
    title: 'Daily log',
    shows: 'Where the daily work log is written and how long transcripts are kept.',
    actions: ['Pick the daily log folder.', 'Set how many days of history to keep.', 'See how much the history takes on disk.'],
    docs: `${HOW}#where-things-live`,
  },
  timelapse: {
    title: 'Time-lapse',
    shows: 'A replay of any recorded day in the 3D office, and what happened since you were last here.',
    actions: ['Replay today at speed.', 'Jump to a merge or a failure.', 'Catch up on what happened while you were away.'],
    docs: `${HOW}#time-lapse`,
  },
  agents: {
    title: 'Agents',
    shows: 'Defaults for every agent: coding agent, model, effort per kind of task, session limits and memory.',
    actions: ['Set the default model and effort.', 'Limit how many sessions run at once.', 'Keep memory free so the server never runs out.'],
    docs: `${HOW}#models-and-usage`,
  },
  projects: {
    title: 'Every project',
    shows: 'The practices every floor inherits, and the playbook every agent reads.',
    actions: ['Switch a practice on for every floor.', 'Edit every project’s playbook.', 'Override a practice on one floor from Floors & repos.'],
    docs: `${HOW}#how-an-issue-flows-through-the-office`,
  },
  runtime: {
    title: 'How agents run',
    shows: 'Real terminals you can watch and type into, or the Agent SDK.',
    actions: ['Pick real terminals to watch agents live.', 'Switch to the Agent SDK for lighter sessions.', 'Open an agent’s terminal from their desk.'],
    docs: `${HOW}#agents-terminals`,
  },
  office: {
    title: 'Company',
    shows: 'Your name, the company’s, the dog’s, the projects folder and idle desk upkeep.',
    actions: ['Rename the company.', 'Pick where new projects are created.', 'Replay the first-run tour.'],
    docs: `${HOW}#where-things-live`,
  },
  profile: {
    title: 'Profile',
    shows: 'How you appear to others viewing the office.',
    actions: ['Set your name and colour.', 'Choose whether others see you.', 'Wave at visitors with the emote key.'],
    docs: `${HOW}#shared-presence`,
  },
  providers: {
    title: 'Providers',
    shows: 'Every provider the office runs on, by category: coding agents, text, audio, video, cloud and MCP servers, with status, usage and what uses each one.',
    actions: ['Add a provider with its key, or sign in.', 'Test a key or an MCP server with one cheap call.', 'Pick which agents get an MCP server.'],
    docs: `${DOCS}accounts.md`,
  },
  guides: {
    title: 'Guides',
    shows: 'The best setup for each kind of project: which coding agent does which job, the QA checks, the preview, the skills and providers it needs.',
    actions: ['Pick what the company mainly makes.', 'Open a guide for a kind of project.', 'Search for an agent, check or provider.'],
    docs: `${DOCS}guides/README.md`,
  },
  accounts: {
    title: 'Providers & accounts',
    shows: 'Every login and API key the coding agents on this computer run on, with usage, status and cost.',
    actions: ['Add a second subscription or an API key.', 'Pin an agent or the CEO to an account or tag.', 'Pause, reorder, test or remove an account.'],
    docs: `${DOCS}accounts.md`,
  },
  'cloud-agents': {
    title: 'Cloud agents',
    shows: 'Agents that work in an Upstash Box and carry on when the office is closed.',
    actions: ['Save the Upstash Box API key.', 'Choose where new agents work.', 'Pick a Box size.'],
    docs: `${DOCS}cloud.md`,
  },
  voice: {
    title: 'Voice',
    shows: 'Messages read aloud and speech to text, with the browser’s voice or ElevenLabs.',
    actions: ['Turn on reading messages aloud.', 'Save an ElevenLabs key for better voices.', 'Talk to the CEO with the mic.'],
    docs: `${DOCS}voice.md`,
  },
  outside: {
    title: 'Weather & world',
    shows: 'The weather outside the 3D office and what happens in the street.',
    actions: ['Use your real local weather.', 'Keep it calm.', 'Choose how often events happen.'],
    docs: HOW,
  },
  notifications: {
    title: 'Notifications',
    shows: 'What the office tells you about, and where: this browser, push to your devices, ntfy or Telegram.',
    actions: ['Turn on push for this phone.', 'Link Telegram to chat with the CEO from there.', 'Pick which events notify you.'],
    docs: `${POCKET}#notifications`,
  },
  themes: {
    title: 'Themes',
    shows: 'Holiday decorations in the 3D office.',
    actions: ['Turn holiday themes on or off.', 'Preview a theme.', 'Set a birthday to celebrate.'],
    docs: HOW,
  },
  access: {
    title: 'Accessibility',
    shows: 'Captions, status colours and shapes, motion, UI scale, readable font and high contrast.',
    actions: ['Turn on captions for sounds.', 'Pick a colour-blind palette.', 'Reduce motion.'],
    docs: HOW,
  },
  pocket: {
    title: 'Pocket mode',
    shows: 'The office without the 3D building, for phones and touch screens.',
    actions: ['Open the 3D office instead.', 'Add the office to your home screen.', 'Reach the office from your phone safely.'],
    docs: `${POCKET}#pocket-mode`,
  },
  about: {
    title: 'About this office',
    shows: 'Version, commit, GitHub account, where agents’ machines live and the environment.',
    actions: ['Check which version runs.', 'See the GitHub account in use.', 'Find the agents’ machines on disk.'],
    docs: `${HOW}#updating-the-office`,
  },
};
