import { useStore } from './store';
import type { PongResult } from '../../shared/pong';
import type { Charter } from '../../shared/charter';
import type { ObjectiveStatus } from '../../shared/charterStats';
import type { AgentStyle } from '../../shared/looks';
import type { AccountCli, AccountKind, AgentCli, SignInMode, AgentPromptView, AgentView, CloudView, DoctorFinding, DoctorFix, EffortLevel, GhRepoSummary, NotifyChannel, NotifyChannelsView, NotifyWebhook, OfficeUpdateView, PushTestView, PreviewView, TelegramView, ProjectFolderView, PrPreviewView, RefFileView, RepoView, SwarmSettings, UsageView, VoiceCacheView, VoiceOption, MachineHost, McpServerConfig, ProviderConnection } from '../../shared/types';
import type { JournalChunk, JournalDayView } from '../../shared/journal';
import type { CostsView, TaskKind } from '../../shared/costs';
import type { ServerPoint } from '../../shared/serverLoad';
import type { HistoryDetail, HistoryFilter, HistoryPage, HistoryUsage } from '../../shared/history';
import type { TimelineView } from '../../shared/careerTimeline';
import type { Experiment, ExperimentInput } from '../../shared/experiments';
import type { PracticeOverrides } from '../../shared/practices';
import type { FloorTheme } from '../../shared/floorThemes';
import type { DecorItem, ProgressView } from '../../shared/progress';
import type { QuickPicks } from '../../shared/used';
import type { ConversationHit, ConversationPatch } from '../../shared/conversations';
import type { LibraryFilter, LibraryPage } from '../../shared/library';
import type { HealthView } from '../../shared/health';
import type { ChatPage } from '../../shared/chatPage';

async function call<T = unknown>(method: string, url: string, body?: unknown, toast = true): Promise<T> {
  // The time-lapse shows a recorded day: nothing in it can be acted on.
  if (method !== 'GET' && useStore.getState().replaying) {
    useStore.getState().pushToast('info', 'Replaying: live actions are off. Press Esc to go back to the live office.');
    throw new Error('The time-lapse is playing');
  }
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data as { error?: string }).error ?? `${res.status} ${res.statusText}`;
    if (toast) useStore.getState().pushToast('error', message);
    throw new Error(message);
  }
  return data as T;
}

/** An audio clip from the office (the voice settings' Test line); errors become toasts like the rest. */
async function clip(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const message = (data as { error?: string }).error ?? `${res.status} ${res.statusText}`;
    useStore.getState().pushToast('error', message);
    throw new Error(message);
  }
  return res.blob();
}

const r = (repoId: string) => `/api/repos/${encodeURIComponent(repoId)}`;

/** An agent's coding agent, model and effort ('' = the office default), and where they work (docs/cloud.md). */
export interface AgentSetupPatch {
  cli?: AgentCli | '';
  model?: string;
  effort?: EffortLevel | '';
  host?: MachineHost | '';
  account?: string; // an account id or tag (#247); '' for the rotation
}

/** Choices made when a project moves in: a brief for the CEO, and whether work starts on its own. */
export interface FloorOptions {
  mission?: string;
  autoAssign?: boolean;
}

export const api = {
  githubRepos: (owner?: string) => call<GhRepoSummary[]>('GET', `/api/github/repos${owner ? `?owner=${encodeURIComponent(owner)}` : ''}`),
  connectRepo: (fullName: string, floor: FloorOptions = {}) => call<RepoView>('POST', '/api/repos', { fullName, ...floor }),
  createRepo: (body: FloorOptions & { name: string; description: string; visibility: 'private' | 'public'; owner?: string }) =>
    call<RepoView>('POST', '/api/repos/new', body),
  folders: (dir?: string) => call<{ root: string; folders: ProjectFolderView[] }>('GET', `/api/folders${dir ? `?dir=${encodeURIComponent(dir)}` : ''}`),
  connectFolder: (path: string, floor: FloorOptions = {}) => call<RepoView>('POST', '/api/folders/connect', { path, ...floor }),
  publishFolder: (body: FloorOptions & { path: string; name?: string; visibility: 'private' | 'public'; description?: string }) =>
    call<RepoView>('POST', '/api/folders/publish', body),
  setup: (body: { managerName: string; companyName: string; scaling: SwarmSettings['scaling']; ceoName: string; ceoLook: 'feminine' | 'masculine'; ceoColor: string }) =>
    call<SwarmSettings>('POST', '/api/setup', body),
  updateRepo: (
    repoId: string,
    patch: {
      autoAssign?: boolean;
      autoMerge?: boolean;
      browserTesting?: boolean;
      color?: string;
      theme?: FloorTheme;
      links?: string[];
      mission?: string;
      summary?: string;
      qaBrief?: string;
      playbook?: string;
      trustedAuthors?: string[];
      previewCommand?: string | null;
      previewEnv?: Record<string, string>;
      practices?: { [K in keyof PracticeOverrides]?: PracticeOverrides[K] | null }; // null: inherit Every project's again
    },
  ) => call('PATCH', r(repoId), patch),
  startPreview: (repoId: string, pr?: number, otherPort?: boolean) => call<PreviewView>('POST', `${r(repoId)}/preview`, { ...(pr ? { pr } : {}), ...(otherPort ? { otherPort } : {}) }),
  stopPreview: (repoId: string) => call<PreviewView>('DELETE', `${r(repoId)}/preview`),
  startPrPreview: (repoId: string, pr: number, restart = false) => call<PrPreviewView>('POST', `${r(repoId)}/pr-previews/${pr}`, { restart }),
  stopPrPreview: (repoId: string, pr: number) => call('DELETE', `${r(repoId)}/pr-previews/${pr}`),
  /** 📌 keep a preview running ('hour' | 'forever'), let it stop by itself again ('off'), or (no pin) start its max lifetime again. */
  keepPreview: (repoId: string, pr: number | null, pin?: 'hour' | 'forever' | 'off') => call('POST', `${r(repoId)}/preview/keep`, { pr, pin }),
  /** The app viewer's heartbeat: which PR preview it has on screen (repoId null: none). Quiet on errors. */
  watchPreview: (viewer: string, repoId: string | null, pr: number | null) => call('POST', '/api/previews/watch', { viewer, repoId, pr }, false),
  previewSync: (repoId: string, pr: number | null) => call<{ url: string }>('POST', `${r(repoId)}/preview/sync`, { pr }),
  disconnectRepo: (repoId: string) => call('DELETE', r(repoId)),
  syncRepo: (repoId: string) => call('POST', `${r(repoId)}/sync`),
  syncFolder: (repoId: string) => call<{ folderSync: string | null }>('POST', `${r(repoId)}/sync-folder`),
  createIssue: (repoId: string, title: string, body: string, assignTo?: string) => call<{ number: number }>('POST', `${r(repoId)}/issues`, { title, body, assignTo }),
  closeIssue: (repoId: string, n: number) => call('POST', `${r(repoId)}/issues/${n}/close`),
  /** Assign to… (#265): a free agent starts it now, a busy one gets it as their next task. */
  assignIssue: (repoId: string, n: number, agentId: string) => call<{ started: boolean; text: string }>('POST', `${r(repoId)}/issues/${n}/assign`, { agentId }),
  trustIssue: (repoId: string, n: number) => call('POST', `${r(repoId)}/issues/${n}/trust`),
  planFloor: (repoId: string, mission?: string, research = false) => call('POST', `${r(repoId)}/plan`, { mission, research }),
  onboardFloor: (repoId: string) => call('POST', `${r(repoId)}/onboard`),
  setCharter: (repoId: string, charter: Charter) => call<RepoView>('PUT', `${r(repoId)}/charter`, { charter }),
  /** Approve the CEO's proposal (edited: as the manager changed it) or dismiss it. */
  decideCharter: (repoId: string, approve: boolean, charter?: Charter) => call<RepoView>('POST', `${r(repoId)}/charter/proposal`, { approve, charter }),
  /** The manager's word on an objective (#105); null clears it. */
  setObjectiveStatus: (repoId: string, objective: string, status: ObjectiveStatus | null) => call<RepoView>('PUT', `${r(repoId)}/charter/status`, { objective, status }),
  exportCharter: (repoId: string) => call<{ url: string }>('POST', `${r(repoId)}/charter/export`),
  mergePull: (repoId: string, n: number, method: 'squash' | 'merge' | 'rebase' = 'squash') => call('POST', `${r(repoId)}/pulls/${n}/merge`, { method }),
  closePull: (repoId: string, n: number) => call('POST', `${r(repoId)}/pulls/${n}/close`),
  /** Queues the PR for QA; with `agentId`, that (free) agent tests it now. */
  sendToQa: (repoId: string, n: number, agentId?: string) => call('POST', `${r(repoId)}/pulls/${n}/qa`, agentId ? { agentId } : {}),
  sendBack: (repoId: string, n: number, note?: string) => call('POST', `${r(repoId)}/pulls/${n}/fix`, { note }),
  /** A new agent on the floor (refused past Settings → Most agents per floor). Empty settings use the office's defaults. */
  hireAgent: (repoId: string, opts: AgentSetupPatch & { name?: string } = {}, toast = true) => call<AgentView>('POST', `${r(repoId)}/agents`, opts, toast),
  updateAgent: (id: string, patch: AgentSetupPatch & { name?: string; look?: 'feminine' | 'masculine'; style?: AgentStyle | null; voiceId?: string; voiceName?: string }) => call('PATCH', `/api/agents/${id}`, patch),
  fireAgent: (id: string) => call('DELETE', `/api/agents/${id}`),
  /** waitForDeps: refuse an issue that still waits for open ones, as the whiteboard's stickies do. */
  assign: (id: string, issueNumber: number, note?: string, waitForDeps?: boolean) => call('POST', `/api/agents/${id}/assign`, { issueNumber, note, waitForDeps }),
  stop: (id: string) => call('POST', `/api/agents/${id}/stop`),
  reset: (id: string) => call('POST', `/api/agents/${id}/reset`),
  message: (id: string, text: string) => call('POST', `/api/agents/${id}/message`, { text }),
  react: (id: string, itemId: number, reaction: string) => call<{ sent: boolean; note: boolean }>('POST', `/api/agents/${id}/react`, { itemId, reaction }),
  /** Start a cloud agent's sign-in again in their terminal (docs/cloud.md). */
  signIn: (id: string) => call('POST', `/api/agents/${id}/sign-in`),
  signInCheck: (id: string) => call('POST', `/api/agents/${id}/sign-in-check`),
  signInLink: (id: string) => call<{ url: string | null }>('GET', `/api/agents/${id}/sign-in-link`),
  agentPrompt: (id: string) => call<AgentPromptView>('GET', `/api/agents/${id}/prompt`),
  careerTimeline: (id: string) => call<TimelineView>('GET', `/api/agents/${id}/timeline`, undefined, false),
  updateSettings: (patch: Partial<SwarmSettings>) => call('PATCH', '/api/settings', patch),
  /** Settings → effort per kind of task; '' puts the kind back on the default. */
  setTaskEffort: (kind: TaskKind, effort: EffortLevel | '') => call('PATCH', '/api/settings', { taskEffort: { [kind]: effort } }),
  /** Tools & skills: scan the manager's Claude Code setup again. */
  refreshTools: () => call('POST', '/api/tools/refresh'),
  refreshModels: () => call('POST', '/api/models/refresh'),
  /** One switch for 'everyone', 'ceo' or an agent's id; on null follows Everyone. */
  switchTool: (scope: string, id: string, on: boolean | null) => call('POST', '/api/tools/switch', { scope, id, on }),
  updateOffice: async (action: 'now' | 'later') => {
    const u = await call<OfficeUpdateView>('POST', '/api/office/update', { action });
    useStore.getState().setOfficeUpdate(u);
    return u;
  },
  /** Clears pacing after a usage warning; refused (and toasted) while paused at the limit. */
  resumeFullSpeed: () => call<UsageView>('POST', '/api/usage/resume'),
  /** The demo only: a usage warning, or the limit, as if a session had reported it. */
  simulateUsage: (kind: 'warning' | 'limit') => call<UsageView>('POST', '/api/usage/simulate', { kind }),
  /** The demo only: memory too low for another session, or back. */
  simulateMemory: (low: boolean) => call<HealthView>('POST', '/api/health/simulate', { low }),
  /** The office doctor: a finding's one-click fix, or Ignore. */
  doctorFix: (id: string, fix: DoctorFix) => call<DoctorFinding[]>('POST', '/api/doctor/fix', { id, fix }),
  doctorIgnore: (id: string) => call<DoctorFinding[]>('POST', '/api/doctor/ignore', { id }),
  /** The demo only: the office doctor's scenarios. */
  demoDoctor: (action: 'restart' | 'stuck' | 'later' | 'unclosed' | 'check') => call<{ text: string; doctor: DoctorFinding[] }>('POST', '/api/doctor/demo', { action }),
  /** A message for the CEO, replying to message `replyTo` if given; answers with the posted message's id. */
  messageCeo: (text: string, replyTo?: number, files?: string[], clientId?: string) => call<{ id: number } | undefined>('POST', '/api/ceo/message', { text, replyTo, ...(files?.length && { files }), ...(clientId && { clientId }) }),
  ceoPicks: () => call<QuickPicks>('GET', '/api/ceo/picks', undefined, false),
  keepFile: (id: string, keep: boolean) => call('POST', `/api/files/${id}/keep`, { keep }),
  deleteFile: (id: string, toast = true) => call('DELETE', `/api/files/${id}`, undefined, toast),
  ceoReview: () => call('POST', '/api/ceo/review'),
  // The chat closer to Claude's (#51)
  ceoStop: () => call('POST', '/api/ceo/stop'),
  ceoRetry: () => call('POST', '/api/ceo/retry'),
  editMessage: (id: number, text: string) => call('POST', `/api/ceo/messages/${id}/edit`, { text }),
  reactToMessage: (id: number, emoji: string, note?: string) => call('POST', `/api/ceo/messages/${id}/react`, { emoji, note }),
  chatMessages: (before: number) => call<ChatPage>('GET', `/api/ceo/messages?before=${before}`),
  removeMessage: (id: number) => call('DELETE', `/api/ceo/messages/${id}`),
  newConversation: (repoId: string | null = null) => call<{ id: string }>('POST', '/api/ceo/conversations', { repoId }),
  openConversation: (id: string) => call('POST', `/api/ceo/conversations/${encodeURIComponent(id)}/open`),
  editConversation: (id: string, patch: ConversationPatch) => call('POST', `/api/ceo/conversations/${encodeURIComponent(id)}/edit`, patch),
  library: (scope: string, filter: LibraryFilter, after?: string) => call<LibraryPage>('GET', `/api/ceo/library?${new URLSearchParams({ scope, filter, ...(after && { after }) })}`, undefined, false),
  searchConversations: (q: string) => call<{ hits: ConversationHit[] }>('GET', `/api/ceo/conversations/search?q=${encodeURIComponent(q)}`, undefined, false),
  ceoNotes: () => call<{ text: string; truncated: boolean; at: number | null }>('GET', '/api/ceo/notes'),
  addMemory: (text: string) => call('POST', '/api/ceo/memory', { text }),
  editMemory: (id: string, text: string) => call('PUT', `/api/ceo/memory/${encodeURIComponent(id)}`, { text }),
  deleteMemory: (id: string) => call('DELETE', `/api/ceo/memory/${encodeURIComponent(id)}`),
  readNotices: (ids?: string[]) => call('POST', '/api/notices/read', ids ? { ids } : {}, false),
  phoneRead: (at: number) => call('POST', '/api/phone/read', { at }),
  artifact: (messageId: number, artifactId: string) => call<{ markdown: string }>('GET', `/api/messages/${messageId}/artifacts/${encodeURIComponent(artifactId)}`),
  /** A chat file ref's text (the viewer shows its own error, so no toast). */
  refFile: (messageId: number, index: number) => call<RefFileView>('GET', `/api/messages/${messageId}/refs/${index}/file`, undefined, false),
  /** A finished ping-pong game on a floor, for its leaderboard (shared/pong.ts parsePongResult). */
  pongResult: (repoId: string, result: PongResult) => call('POST', `${r(repoId)}/pong`, result),
  /** Decides a team change: a hire with the manager's changes to the new agent, if any. */
  approveRequest: (id: string, overrides: AgentSetupPatch & { name?: string; note?: string } = {}) => call('POST', `/api/requests/${id}/approve`, overrides),
  rejectRequest: (id: string, note?: string) => call('POST', `/api/requests/${id}/reject`, { note }),
  decideOpen: (id: string, action: 'snooze' | 'drop' | 'answered' | 'open' | 'reopen') => call('POST', `/api/decisions/${encodeURIComponent(id)}`, { action }),
  /** Demo office only: the CEO asks for a new agent (or for one to leave) on demand. */
  demoPropose: (kind: 'hire' | 'let-go', floor?: number) => call<{ text: string }>('POST', '/api/demo/proposals', { kind, floor }),
  demoNewCommit: () => call<{ commit: string }>('POST', '/api/demo/new-commit'),
  /** Saves an Anthropic or OpenAI Admin key for the usage card's organisation spend (#361); '' removes it. */
  // Settings → Providers (#362): keys and MCP servers' secrets go in and never come back out.
  addProvider: (provider: string, key: string, label?: string) => call<ProviderConnection>('POST', '/api/providers', { provider, key, label }, false),
  testProvider: (id: string) => call<ProviderConnection>('POST', `/api/providers/${encodeURIComponent(id)}/test`),
  removeProvider: (id: string) => call('DELETE', `/api/providers/${encodeURIComponent(id)}`),
  addMcpServer: (m: { name: string; command?: string; url?: string; secrets?: Record<string, string>; agents?: string[] }) => call<McpServerConfig>('POST', '/api/providers/mcp', m, false),
  setMcpServer: (id: string, patch: { on?: boolean; agents?: string[] }) => call<McpServerConfig>('PATCH', `/api/providers/mcp/${encodeURIComponent(id)}`, patch),
  testMcpServer: (id: string) => call<McpServerConfig>('POST', `/api/providers/mcp/${encodeURIComponent(id)}/test`),
  removeMcpServer: (id: string) => call('DELETE', `/api/providers/mcp/${encodeURIComponent(id)}`),
  setUsageAdminKey: (provider: 'anthropic' | 'openai', key: string) => call<{ set: boolean }>('PUT', '/api/usage/admin-key', { provider, key }),
  /** Saves (or with '' removes) the ElevenLabs key. No toast: the settings show why a key was rejected. */
  setVoiceKey: (key: string) => call<{ voiceKeySet: boolean; voiceKeyHint: string }>('PUT', '/api/voice/key', { key }, false),
  voices: () => call<VoiceOption[]>('GET', '/api/voice/voices'),
  voiceSample: (voiceId: string) => clip(`/api/voice/sample?voiceId=${encodeURIComponent(voiceId)}`),
  clearVoiceCache: () => call<VoiceCacheView>('DELETE', '/api/voice/cache'),
  journalDays: () => call<JournalDayView[]>('GET', '/api/journal/days'),
  history: (f: HistoryFilter, toast = true) => call<HistoryPage>('GET', `/api/history?${new URLSearchParams(Object.entries(f).flatMap(([k, v]) => (v === undefined || v === '' ? [] : [[k === 'repoId' ? 'repo' : k, String(v)]])))}`, undefined, toast),
  historyEntry: (id: string) => call<HistoryDetail>('GET', `/api/history/${encodeURIComponent(id)}`),
  historyUsage: () => call<HistoryUsage>('GET', '/api/history/usage'),
  serverTrend: () => call<ServerPoint[]>('GET', '/api/server/trend'),
  stopOrphan: (pid: number) => call<void>('POST', `/api/server/orphans/${pid}/stop`),
  costs: (days: number, repo?: string) => call<CostsView>('GET', `/api/costs?days=${days}${repo ? `&repo=${encodeURIComponent(repo)}` : ''}`),
  defineExperiment: (input: ExperimentInput) => call<Experiment>('POST', '/api/experiments', input),
  /** A stopped experiment's variant's practice switches become every project's default (#24). */
  everyProject: (id: string, variant: string) => call<SwarmSettings>('POST', `/api/experiments/${encodeURIComponent(id)}/every-project`, { variant }),
  experimentAction: (id: string, action: 'start' | 'stop' | 'promote' | 'delete', variant?: string | null) => call<Experiment | null>('POST', `/api/experiments/${encodeURIComponent(id)}`, { action, variant }),
  journalEvents: (from: number, to: number, seek: boolean) => call<JournalChunk>('GET', `/api/journal/events?from=${Math.floor(from)}&to=${Math.ceil(to)}${seek ? '&seek=1' : ''}`),
  journalSample: () => call<{ day: string }>('POST', '/api/journal/sample'),
  /** Saves (or with empty fields removes) a chat app's webhook. No toast: the settings show why it was refused. */
  setWebhook: (channel: NotifyWebhook, body: Record<string, string>) => call<NotifyChannelsView>('PUT', `/api/notify/webhooks/${channel}`, body, false),
  testNotify: (channel: NotifyChannel) => call<{ ok: true; sent: number }>('POST', '/api/notify/test', { channel }, false),
  // Settings → Cloud agents (docs/cloud.md). No toasts on keys: the settings show why one was refused.
  setCloudKey: (key: string) => call<CloudView>('PUT', '/api/cloud/key', { key }, false),
  setCloudToken: (kind: 'github' | 'anthropic' | 'openai', value: string) => call<CloudView>('PUT', '/api/cloud/token', { kind, value }, false),
  testCloud: () => call<CloudView>('POST', '/api/cloud/test', undefined, false),
  deleteCloudOrphans: () => call<{ deleted: number }>('POST', '/api/cloud/orphans'),
  /** The demo only: every cloud agent's sign-in expires. */
  expireSignIns: () => call('POST', '/api/cloud/demo-expire'),
  useKeyAgain: (kind: 'anthropic' | 'openai') => call<CloudView>('POST', '/api/cloud/key-again', { kind }),
  simulateOutOfCredit: () => call<CloudView>('POST', '/api/cloud/demo-credit'),
  // Settings → Providers & accounts (#247, docs/accounts.md). Keys go in; only their last 4 come back.
  addAccount: (a: { cli: AccountCli; kind: AccountKind; label?: string; tags?: string; key?: string; tokenEnv?: string }) => call<{ id: string; note: string }>('POST', '/api/accounts', a, false),
  updateAccount: (id: string, patch: { label?: string; tags?: string; enabled?: boolean; plan?: string; dailyCostCap?: number | null }) => call('PATCH', `/api/accounts/${encodeURIComponent(id)}`, patch),
  moveAccount: (id: string, by: -1 | 1) => call('POST', `/api/accounts/${encodeURIComponent(id)}/move`, { by }),
  setAccountKey: (id: string, key: string) => call<{ note: string }>('PUT', `/api/accounts/${encodeURIComponent(id)}/key`, { key }, false),
  testAccount: (id: string) => call<{ note: string }>('POST', `/api/accounts/${encodeURIComponent(id)}/test`),
  signInAccount: (id: string, mode: SignInMode = 'login') => call('POST', `/api/accounts/${encodeURIComponent(id)}/signin`, { mode }),
  useAccountNow: (id: string) => call('POST', `/api/accounts/${encodeURIComponent(id)}/use-now`),
  simulateAccountLimit: (id: string) => call('POST', `/api/accounts/${encodeURIComponent(id)}/simulate-limit`),
  removeAccount: (id: string) => call<{ result: 'removed' | 'waiting' }>('DELETE', `/api/accounts/${encodeURIComponent(id)}`),
  pushKey: () => call<{ publicKey: string }>('GET', '/api/notify/push/key'),
  pushSubscribe: (subscription: PushSubscriptionJSON, name: string) => call<{ id: string }>('POST', '/api/notify/push/devices', { subscription, name }, false),
  pushUnsubscribe: (endpoint: string) => call<NotifyChannelsView>('DELETE', '/api/notify/push/devices', { endpoint }),
  pushWhois: (endpoint: string) => call<{ id: string | null }>('POST', '/api/notify/push/whois', { endpoint }, false),
  renamePushDevice: (id: string, name: string) => call<NotifyChannelsView>('PATCH', `/api/notify/push/devices/${encodeURIComponent(id)}`, { name }),
  removePushDevice: (id: string) => call<NotifyChannelsView>('DELETE', `/api/notify/push/devices/${encodeURIComponent(id)}`),
  testPushDevice: (id: string) => call<PushTestView>('POST', `/api/notify/push/devices/${encodeURIComponent(id)}/test`, {}, false),
  /** Where this device's push sign-up stopped, for the office's log. */
  pushReport: (step: string, error: string) => call('POST', '/api/notify/push/report', { step, error }, false),
  quickNtfy: () => call<{ url: string; test: { ok: boolean; message: string } }>('POST', '/api/notify/ntfy/quick', {}, false),
  // The manager's Telegram bot. No toasts: the settings show why a token was refused.
  setTelegram: (token: string) => call<{ view: TelegramView; startUrl: string }>('PUT', '/api/notify/telegram', { token }, false),
  telegramLink: () => call<{ startUrl: string }>('POST', '/api/notify/telegram/link', {}, false),
  retryTelegram: () => call<TelegramView>('POST', '/api/notify/telegram/retry', {}),
  removeTelegram: () => call<TelegramView>('DELETE', '/api/notify/telegram'),
  /** The demo only: the fake manager on Telegram presses Start, writes, replies, or presses a team change's button. */
  telegramDemo: (kind: 'start' | 'message' | 'reply' | 'approve' | 'decline' | 'outage' | 'online', text = '') => call('POST', '/api/notify/telegram/demo', { kind, text }),
  // office progression (#210)
  buyDecor: (repoId: string, item: DecorItem) => call<ProgressView>('POST', `${r(repoId)}/decor/buy`, { item }),
  placeDecor: (repoId: string, body: { item: DecorItem; slot: string | null; from: string | null }) => call<ProgressView>('POST', `${r(repoId)}/decor/place`, body),
  drankCoffee: (id: string) => call<{ coffees: number }>('POST', '/api/progress/coffee', { id }, false),
  /** Demo only: coins for a floor, or days of tenure for one agent (or everyone). */
  demoProgress: (body: { action: 'coins'; repoId: string; coins: number } | { action: 'tenure'; days: number; agentId?: string }) => call<ProgressView>('POST', '/api/progress/demo', body),
};
