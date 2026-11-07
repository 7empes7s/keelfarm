// The office's settings (Settings in the console). Imported through shared/types.ts.
import type { CeoAwakeSettings } from '../ceoAwake.ts';
import type { TaskKind } from '../costs.ts';
import type { CeoMandate, FollowupSettings } from '../followups.ts';
import type { MemorySettings } from '../health.ts';
import type { WeatherSettings, WorldEventSettings } from '../outside.ts';
import type { EveryProject } from '../practices.ts';
import type { TestLabSettings } from '../testLab.ts';
import type { ThemeSettings } from '../themes.ts';
import type { ToolSettings } from '../tooling.ts';
import type { AgentCli, AgentRuntime, CloudSettings, EffortLevel } from './agents.ts';
import type { NotifySettings } from './notify.ts';
import type { ListenSettings, VoiceSettings } from './voice.ts';

export interface SwarmSettings {
  sessionLimit: number; // most agent sessions running at once; 0 = no limit
  memory: MemorySettings; // memory headroom, the per-session ceiling and learned estimates (shared/health.ts)
  testLab: TestLabSettings; // the test lab's switch and how many jobs it runs at once (shared/testLab.ts)
  defaultModel: string;
  defaultEffort: EffortLevel;
  taskEffort: Partial<Record<TaskKind, EffortLevel>>; // effort per kind of task (#18); an agent's own wins, and a kind without one runs at the default
  runtime: AgentRuntime;
  defaultCli: AgentCli; // what agents run in their terminals unless they have their own
  scaling: 'approve' | 'auto'; // the CEO's team changes wait for the manager (new agents wait in the lobby), or apply at once
  maxAgents: number; // most agents on a floor: 1 to FLOOR_SEATS (DEFAULT_MAX_AGENTS)
  ceoHeartbeatMin: number; // minutes between the CEO's periodic reviews; 0 = off
  researchMin: number; // a research job's time budget in minutes, after which the CEO wraps up with what it has
  ceoFollowups: FollowupSettings; // Settings → The CEO: which office events wake the CEO for a follow-up (shared/followups.ts)
  ceoMandates: CeoMandate[]; // the manager's standing mandates: follow-ups may file issues on the floors they cover
  ceoAwake: CeoAwakeSettings; // Settings → The CEO: its kept session, waits and consults (shared/ceoAwake.ts)
  managerName: string; // what the office calls you
  companyName: string;
  dogName: string; // the office dog's name, on its tag and in the hint when you aim at it
  projectsDir: string; // where your project folders live; new projects are created here
  setupDone: boolean; // the first-run setup wizard has been completed or skipped
  tutorialStep: number; // index of the current tutorial step; -1 when finished or skipped
  autoUpdate?: boolean; // update the office itself once it's quiet (absent on servers without self-update)
  updateSettleMin?: number; // an automatic update waits this long after the latest commit (at most 15 min after the first), so a run of merges is one restart
  pacingSessions: number; // after Claude warns about usage, new issues start only while fewer sessions than this run
  trimIdleDesksMin: number; // a desk idle this many minutes loses its node_modules and build output; 0 = never
  previewRecentHours: number; // an open PR updated this recently gets its own channel chip; older ones fold under "Older"
  mainPreviewIdleMin: number; // a floor's main preview stops after this many minutes with nobody watching; 0 = never
  dailyLogDir: string; // the daily work log's folder (#49); '' = /opt/ai-vault/daily when it exists, else <SWARM_HOME>/daily
  historyDays: number; // days the session history and its transcripts are kept; 0 = forever
  voice: VoiceSettings;
  themes: ThemeSettings; // holiday themes: Settings → Themes (shared/themes.ts)
  weather: WeatherSettings; // Settings → Weather: the calm cycle, off, or the manager's real local weather
  worldEvents: WorldEventSettings; // Settings → World events: how often something happens outside
  listen: ListenSettings;
  notify: NotifySettings;
  cloud: CloudSettings;
  tools: ToolSettings; // Tools & skills: what Everyone's and the CEO's sessions load (shared/tooling.ts)
  everyProject: EveryProject; // Settings → Every project: the practice switches every floor inherits (#24)
  statusReactions?: boolean; // the office's 👀 ⏳ ✅ under the manager's messages as the CEO or an agent works on them (#193: off by default)
  officePlaybook: string; // above every floor's playbook in builders', fixers' and QA's prompts (up to OFFICE_PLAYBOOK_MAX)
}
