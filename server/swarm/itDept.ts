// The IT department (#524): a named IT lead with a long-lived session of their own (on Settings → The IT department's
// coding agent, account, model and effort; resumed across restarts), their own chat and Telegram bot, and #506's IT
// desk tools. They sleep between events: a message from the manager, the CEO's ask_it or a change the manager ran
// wakes them. The lead is never in the office's agent list, so no floor, desk or task is theirs. Rules in
// shared/itDept.ts, prompts in server/itLead.ts.
import fs from 'node:fs/promises';
import path from 'node:path';
import { IT_ID, IT_MESSAGES_KEPT, IT_MESSAGES_SHOWN, itDeptSettings, loadIt, nextItJob, queueItJob, viaCeoBot, type ItJob, type ItView } from '../../shared/itDept.ts';
import { argvLine, IT_LOG_SHOWN, type ItProposal } from '../../shared/itDesk.ts';
import { itWatchSettings } from '../../shared/itWatch.ts';
import { makeArtifacts, parseMessage } from '../../shared/chatParts.ts';
import { ceoModelOn } from '../../shared/ceoRunsOn.ts';
import { forwardText, isHarnessText, stripHarness } from '../../shared/chat.ts';
import { isReaction, react } from '../../shared/reactions.ts';
import type { AgentStatus, PhoneMessage, WorldSnapshot } from '../../shared/types.ts';
import { HOME_DIR } from '../config.ts';
import { HttpError } from '../httpError.ts';
import { itOfficeTools } from '../ceoItTools.ts';
import type { OfficeTools } from '../ceo.ts';
import { itJobPrompt, itSystemPrompt } from '../itLead.ts';
import { recordCost } from '../metrics.ts';
import { runKeyboard, type TgButton } from '../telegram.ts';
import { TelegramBot } from '../telegramBot.ts';
import { plainText } from '../notify.ts';
import type { PersistedAgent } from './model.ts';
import { SwarmSetup } from './setup.ts';

const IT_DIR = path.join(HOME_DIR, 'it');
const OFF = 'The IT department is off: the manager turns it on in Settings → The IT department.';

export abstract class SwarmItDept extends SwarmSetup {
  /** IT's own bot, under "telegramIt" in the secrets file; on the same Telegram switch as the CEO's. */
  readonly itBot = new TelegramBot({
    api: this.backend.telegramIt,
    secretsFile: path.join(HOME_DIR, this.backend.demo ? 'demo-telegram-secrets.json' : 'secrets.json'),
    key: 'telegramIt',
    who: () => this.state.settings.itDept.name,
    on: () => this.state.settings.notify.channels.telegram,
    message: async (text, id) => void (await this.messageIt(text, 'telegram', id)),
    decide: (verdict, id) => this.itDecide(verdict, id),
    changed: () => this.itChanged(),
    log: (line) => console.warn(`IT ${line}`),
  });
  private itAgent: PersistedAgent | null = null;
  /** The manager's last IT message came from Telegram: IT's replies go back there too. */
  private itViaTelegram = false;

  /** The IT lead, as a session sees them: CEO-like (no shell, the lobby's tools), on the IT department's setup. */
  protected itLead(): PersistedAgent {
    const s = this.state.settings.itDept;
    const it = this.state.it;
    const a = (this.itAgent ??= {
      id: IT_ID, name: s.name, repoId: '', role: 'ceo', look: 'feminine', task: null, desk: 0, color: '#2a9d8f', hair: '#3b2a20', skin: '#c68863', style: null,
      model: s.model, effort: s.effort, cli: s.cli, machine: null, status: 'idle', issueNumber: null, issueTitle: null, branch: null, prNumber: null, prUrl: null,
      startedAt: null, endedAt: null, costUsd: it.costUsd, turns: 0, sessionId: null, sessionCli: null, lastError: null, logTail: [],
    });
    Object.assign(a, { name: s.name, model: s.model, effort: s.effort, cli: s.cli, account: s.account || undefined, sessionId: it.sessionId, sessionCli: it.sessionCli });
    if (!this.agentRt.has(a.id)) this.agentRt.set(a.id, { log: [], session: null, currentTool: null, browserUrl: null, screenshot: null, shots: [], terminal: null });
    return a;
  }

  /** The saved IT department, from the state file (shared/itDept.ts loadIt). */
  protected loadItState(raw: unknown) {
    return loadIt(raw);
  }

  /** Started with the usage readings, once from init: IT's bot, and a job a restart cut off. */
  protected override async startUsage() {
    this.state.settings.itDept = itDeptSettings(undefined, this.state.settings.itDept); // as saved, checked
    await this.itBot.init();
    setTimeout(() => this.startItWork(), 3000);
    await super.startUsage();
  }

  override async shutdown(restart = false): Promise<void> {
    await super.shutdown(restart);
    await this.itBot.stop();
  }

  /** updateSettings' part: Settings → The IT department (the lead's next job starts on it), its Health thresholds, and the Telegram switch for IT's bot. */
  protected itSettings(patch: { itDept?: unknown; notify?: unknown; itWatch?: unknown }) {
    if (patch.notify !== undefined) this.itBot.refresh();
    if (patch.itWatch !== undefined) this.state.settings.itWatch = itWatchSettings(this.state.settings.itWatch, patch.itWatch);
    if (patch.itDept === undefined) return;
    this.state.settings.itDept = itDeptSettings(this.state.settings.itDept, patch.itDept);
    this.itChanged();
    setTimeout(() => this.startItWork(), 150);
  }

  private itBusy() {
    return !!this.state.it.job || !!this.agentRt.get(IT_ID)?.session;
  }

  protected itView(): ItView {
    const s = this.state.settings.itDept;
    return { on: s.on, name: s.name, busy: this.itBusy(), messages: this.state.it.messages.slice(-IT_MESSAGES_SHOWN), telegram: this.itBot.view() };
  }

  /** Left out until IT has a message or a bot: every tab's snapshot pays for it (scale.test.ts), and the settings have the rest. */
  override snapshot(): WorldSnapshot {
    return this.state.it.messages.length || this.itBot.view().set ? { ...super.snapshot(), it: this.itView() } : super.snapshot();
  }

  private itHead(): Omit<ItView, 'messages'> {
    const { messages: _, ...head } = this.itView();
    return head;
  }

  /** The IT view changed (busy, the bot, the settings): every tab hears, without the messages. */
  protected itChanged() {
    this.broadcast({ type: 'it', it: this.itHead() });
    this.save();
  }

  // ---------- the chat ----------

  protected postIt(from: PhoneMessage['from'], text: string, extra: Partial<PhoneMessage> = {}): PhoneMessage {
    const parts = parseMessage(from, text);
    const id = this.messageSeq++;
    const artifacts = makeArtifacts(id, parts.artifacts);
    const m: PhoneMessage = { id, from, text: parts.text.trim().slice(0, 6000), at: Date.now(), ...extra, ...(parts.suggestions && { suggestions: parts.suggestions }), ...(parts.ask && { ask: parts.ask }), ...(parts.spoken && { spoken: parts.spoken }), ...(artifacts && { artifacts }), ...(parts.visuals && { visuals: parts.visuals }) };
    const list = this.state.it.messages;
    list.push(m);
    if (list.length > IT_MESSAGES_KEPT) list.splice(0, list.length - IT_MESSAGES_KEPT);
    this.broadcast({ type: 'it', it: this.itHead(), message: m });
    this.save();
    return m;
  }

  private itDelivery(ids: number[], delivery: 'read' | 'replied') {
    for (const m of this.state.it.messages) {
      if (!ids.includes(m.id) || m.delivery === delivery || m.delivery === 'replied') continue;
      m.delivery = delivery;
      this.broadcast({ type: 'it', it: this.itHead(), message: m });
    }
  }

  /** The manager's phone (or IT's Telegram) → IT: into the running session, else IT's next job. */
  async messageIt(text: string, via?: 'telegram', tg?: number, replyTo?: number): Promise<{ id: number }> {
    const s = this.state.settings.itDept;
    if (!s.on) throw new HttpError(409, OFF);
    const t = text.trim().slice(0, 4000);
    if (!t) throw new HttpError(400, 'Empty message');
    if (isHarnessText(t)) throw new HttpError(400, "That's a session's own output, not a message: it stays out of the chat.");
    const quoted = replyTo === undefined ? undefined : this.state.it.messages.find((m) => m.id === replyTo);
    const m = this.postIt('manager', t, { delivery: 'sent', ...(replyTo !== undefined && { replyTo }), ...(via && { telegram: 'in' as const, ...(tg !== undefined && { tg }) }) });
    this.itViaTelegram = via === 'telegram';
    const forward = `(message ${m.id}) ${forwardText(t, quoted)}`;
    const session = this.agentRt.get(IT_ID)?.session;
    if (session) {
      session.send(`Message from the manager (they read your reply on their phone, so keep it short):\n${forward}`);
      this.itDelivery([m.id], 'read');
      return { id: m.id };
    }
    this.enqueueIt({ kind: 'chat', text: forward, messageIds: [m.id], at: Date.now() });
    return { id: m.id };
  }

  /** POST /api/it/messages/:id/react: the manager adds or removes a reaction on IT's message (#589), kept on it and shown in the chat. */
  reactToItMessage(id: number, emoji: string) {
    const m = this.state.it.messages.find((x) => x.id === id);
    if (!m) throw new HttpError(404, 'That message is no longer saved');
    if (m.from !== 'ceo') throw new HttpError(400, `Only ${this.state.settings.itDept.name}'s messages take reactions.`);
    if (!isReaction(emoji)) throw new HttpError(400, 'Pick a reaction from the bar.');
    const next = react(m.reactions, 'manager', emoji);
    if (next.length) m.reactions = next;
    else delete m.reactions;
    this.broadcast({ type: 'it', it: this.itHead(), message: m });
    this.save();
    return { reactions: m.reactions ?? [] };
  }

  /** The CEO's ask_it: the question opens in IT's chat, and IT's answer reaches the CEO in their next job. */
  protected askIt(a: { question: string }): string {
    const s = this.state.settings.itDept;
    if (!s.on) throw new Error(`${OFF} Tell the manager what you wanted to know.`);
    const q = String(a.question ?? '').trim().slice(0, 2000);
    if (!q) throw new Error('Say what IT should look at.');
    const ceo = this.ceo().name;
    const m = this.postIt('office', `📨 ${ceo} asks: ${q}`);
    this.enqueueIt({ kind: 'ask', from: ceo, text: q, messageId: m.id, at: Date.now() });
    return `Asked ${s.name} in the IT chat (message ${m.id}). Their answer comes back to you in your next job; any change goes to the manager on a card.`;
  }

  protected enqueueIt(job: ItJob) {
    queueItJob(this.state.it.queue, job);
    this.save();
    setTimeout(() => this.startItWork(), 50);
  }

  // ---------- the session ----------

  /** IT's next job, when they're free: they never wait for a session slot, like the CEO. */
  protected startItWork() {
    const it = this.state.it;
    if (!this.state.settings.itDept.on || this.itBusy() || !it.queue.length || this.officeUpdate.sent) return;
    const job = nextItJob(it.queue)!;
    it.job = job;
    void this.runItJob(job);
  }

  /** The bot's token, for redacting (core.ts secrets; the bot doesn't exist yet while the office is being built). */
  protected itBotSecret(): string | null {
    return (this.itBot as TelegramBot | undefined)?.secret() ?? null;
  }

  /** IT's office tools: it_run, it_propose, it_recommend (itWatch.ts), it_health, it_ticket, it_review and it_improve (itImprove.ts; server/ceoItTools.ts). */
  protected itTools(): OfficeTools {
    return itOfficeTools({ itRun: (a) => this.itRun(a), itPropose: (a) => this.itPropose(a), itRecommend: (a) => this.itRecommend(a), itHealth: () => this.itHealth(), itTicket: (a) => this.itTicket(a), itReview: (a) => this.itReview(a), itImprove: (a) => this.itImprove(a), cloudflare: (a) => this.cloudflareAct(a, this.itName), problemsList: (a) => this.problemsList(a), noteProblem: (a) => this.noteProblem(a) });
  }

  /** it_health: the office's readings, compact. */
  protected itHealth(): string {
    const d = this.state.itDesk;
    return JSON.stringify({ health: this.health.view(), watchdog: this.doctorView().slice(0, 10), waiting: d.waiting.map((p) => argvLine(p.argv)), recent: d.log.slice(0, Math.min(5, IT_LOG_SHOWN)).map((e) => ({ kind: e.kind, cmd: argvLine(e.argv), code: e.code, at: e.at })), tickets: this.state.itTickets.list.filter((t) => t.status === 'open').slice(0, 10).map((t) => ({ id: t.id, where: t.where, what: t.what, count: t.count, blocking: t.blocking })) }).slice(0, 8000);
  }

  private async runItJob(job: ItJob) {
    const a = this.itLead();
    const rt = this.agentRt.get(a.id)!;
    const s = this.state.settings.itDept;
    const cli = this.ceoCliOf(a);
    // A session carries on only on the coding agent that made it.
    const resume = this.state.it.sessionId && (this.state.it.sessionCli ?? 'claude') === cli ? this.state.it.sessionId : undefined;
    const how = this.sessionRuntime(a, resume);
    Object.assign(a, { status: 'working' as AgentStatus, issueTitle: job.kind === 'chat' ? 'Answering the manager' : job.kind === 'ask' ? `${job.from}'s question` : job.kind === 'ticket' ? `Ticket #${job.id}` : job.kind === 'watch' ? 'Looking at a health check' : job.kind === 'review' ? 'Weekly review' : `Checking ${job.line}`, startedAt: Date.now(), endedAt: null, lastError: null });
    if (job.kind === 'chat') this.itDelivery(job.messageIds, 'read');
    this.itChanged();
    await fs.mkdir(IT_DIR, { recursive: true }).catch(() => undefined);
    const replied: string[] = [];
    rt.session = this.startOnAccount(
      a,
      {
        cwd: IT_DIR,
        prompt: itJobPrompt(job),
        systemAppend: itSystemPrompt({ name: s.name, company: this.state.settings.companyName, manager: this.state.settings.managerName, ceo: this.ceo().name }),
        model: ceoModelOn(cli, s.model, this.state.settings, ''),
        effort: s.effort,
        browserTesting: false,
        additionalDirectories: [],
        role: 'ceo',
        dept: 'it',
        office: this.itTools(),
        tools: this.sessionToolsFor(a, how.cli),
        keepAlive: false,
        ...how,
      },
      {
        log: (entries) => this.appendLog(a, entries),
        tool: (name) => void (rt.currentTool = name),
        sessionId: (id) => {
          this.state.it.sessionId = id;
          this.state.it.sessionCli = id ? (how.cli ?? 'claude') : null;
        },
        browserUrl: () => undefined,
        screenshot: () => undefined,
        turn: (raw) => {
          const text = stripHarness(raw);
          if (!text.trim()) return;
          replied.push(text);
          const m = this.postIt('ceo', text);
          if (job.kind === 'chat') this.itDelivery(job.messageIds, 'replied');
          if (this.itViaTelegram || this.state.settings.notify.telegramMirror) void this.itTelegram(`💬 ${s.name}\n${plainText(m.text)}`);
        },
        limited: (at) => this.pauseForLimit(at),
        usage: (readings) => this.recordUsage(readings),
        finished: (result) => {
          rt.session = null;
          rt.currentTool = null;
          const usd = result.costUsd;
          this.state.it.costUsd += usd;
          recordCost(this.state.ops, '', usd, Date.now());
          Object.assign(a, { costUsd: this.state.it.costUsd, turns: a.turns + result.turns, endedAt: Date.now(), status: (result.ok ? 'done' : 'error') as AgentStatus, lastError: result.ok ? null : result.errors.join('; ') || 'Session failed' });
          if (!result.ok && !result.interrupted) this.postIt('office', `⚠️ ${s.name} hit a problem: ${(a.lastError ?? '').slice(0, 240)}`);
          // The CEO's question: IT's answer, in the CEO's next job.
          if (job.kind === 'ask' && replied.length) this.ceoTold.push(`${s.name} (IT) answered your ask_it "${job.text.slice(0, 120)}": ${replied.join(' ').slice(0, 600)}`);
          this.state.it.job = null;
          this.itChanged();
          setTimeout(() => this.startItWork(), 200);
        },
      },
    );
  }

  // ---------- the IT desk's cards, and Telegram ----------

  /** To the manager's Telegram: IT's own bot, else the CEO's, labelled "IT:". Null when it went out, else why not. */
  protected async itTelegram(text: string, keyboard?: TgButton[][]): Promise<string | null> {
    if (this.itBot.active()) return this.itBot.send(text, keyboard);
    if (this.telegram.active()) return this.telegram.send(viaCeoBot(text), keyboard);
    return 'Telegram isn\'t linked';
  }

  /** A card it_propose made: IT's alert, with Run / Not now on Telegram (the chat shows its card). */
  protected itProposed(p: ItProposal) {
    void this.itTelegram(`🖥️ ${p.by ?? this.state.settings.itDept.name} asks to ${p.cf ? 'change' : 'run'} \`${argvLine(p.argv)}\`\n${p.why}\n${p.diff ? `${p.diff}\n` : ''}Frees or changes: ${p.affects}\nUndo: ${p.undo}\nRisk: ${p.risk}`.slice(0, 3500), runKeyboard(p.id));
  }

  /** The manager's Run went through (or was refused at Run): into IT's chat and Telegram, and IT checks a run's result. */
  protected itRan(p: ItProposal, text: string, out: string, ran: { code: number | null } | null) {
    this.postIt('office', text, { notice: { details: out.trim() || '(no output)' } });
    void this.itTelegram(`${text}\n${out.trim().split('\n').slice(0, 8).join('\n')}`.slice(0, 1500));
    if (ran && this.state.settings.itDept.on && !p.rec) this.enqueueIt({ kind: 'ran', line: argvLine(p.argv), code: ran.code, out, at: Date.now() });
  }

  /** A Run / Not now button on Telegram (IT's bot, or IT's card on the CEO's). */
  protected async itDecide(verdict: 'approve' | 'decline', id: string): Promise<string> {
    if (verdict === 'decline') {
      this.itDismiss([id]);
      return '✋ Not now: nothing ran.';
    }
    const { results } = await this.itRunProposals([id]);
    const code = results[0]?.code;
    return code === 0 ? '✅ Ran: the output is in the IT chat.' : code === null ? "⚠️ It didn't run: the IT chat says why." : `⚠️ Exit ${code}: the output is in the IT chat.`;
  }

  /** POST /api/it/telegram/demo: the demo's fake manager on IT's bot. */
  itTelegramDemo(body: { kind?: unknown; text?: unknown }) {
    if (!this.backend.demo) throw new HttpError(404, 'Only the demo office has a fake Telegram.');
    return this.itBot.demo(body);
  }
}
