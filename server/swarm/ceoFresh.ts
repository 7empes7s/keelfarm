// The CEO's context diet, part 2 (#330): background jobs in fresh sessions of their own with the office's digest, the
// chat's kept session left to chat, and a full one's handover to the next. The rules are pure, in server/ceoDigest.ts.
import type { CeoJob } from '../ceo.ts';
import { ceoSystemPrompt } from '../ceo.ts';
import { ceoDigest, ceoJobSession, freshStart, HANDOVER_PROMPT, handoverOf, loadHandover, sinceLastChat } from '../ceoDigest.ts';
import { ceoSessionStep } from '../ceoWaits.ts';
import { recordCost } from '../metrics.ts';
import { liveMandates } from '../../shared/followups.ts';
import { sameRun } from '../../shared/sessionRun.ts';
import { conversationsView, currentConversation } from '../../shared/conversations.ts';
import type { SessionRun } from '../../shared/types.ts';
import { CEO_DIR, CEO_MODEL, type PersistedAgent } from './model.ts';
import { SwarmCeoModels } from './ceoModels.ts';

const HANDOVER_MS = 3 * 60_000; // a handover that takes longer is stopped: the digest alone then

type SessionPlan = { fresh: boolean; resume: boolean; why: string | null };

export abstract class SwarmCeoFresh extends SwarmCeoModels {
  /** The CEO's session answering in the chat (not a background job's fresh one): what it runs on goes on the thread (#376). */
  protected sessionRan(a: PersistedAgent, run: SessionRun) {
    if (a.role !== 'ceo' || this.ceoFresh) return;
    const thread = currentConversation(this.state.ceo.chats);
    const same = !!thread.run && sameRun(thread.run, run);
    thread.run = run;
    if (!same) this.broadcast({ type: 'ceoChat', conversations: conversationsView(this.state.ceo.chats) }); // the whole list: only when the chip changes
  }

  /**
   * How the job's session starts: a chat carries on from the CEO's last session, so "why did you propose that?" has an
   * answer; with keep-alive on, every job does until its context fills up or it sat idle too long (#28). Background
   * jobs start fresh instead, and a full kept session hands over to the next one first.
   */
  protected async ceoSessionPlan(a: PersistedAgent, job: CeoJob): Promise<SessionPlan> {
    const awake = this.state.settings.ceoAwake;
    const kept = this.state.ceo.kept;
    const step = ceoSessionStep(awake, { sessionId: a.sessionId, turns: kept.turns, lastEndedAt: kept.lastEndedAt }, Date.now());
    const plan = ceoJobSession(job.kind, awake, step, !!job.redo);
    if (!plan.fresh && step.handover && !loadHandover(this.state.ceo.handover) && a.status === 'working') await this.ceoHandover(a);
    return plan;
  }

  /**
   * The planned session, started: whether it carries on (`resumeId`), and what its prompt starts with (`start`: a fresh
   * one's digest, and a kept session's successor's handover) and adds (`since`: what a background job did since the
   * chat last ran). The step log says which.
   */
  protected ceoOpening(a: PersistedAgent, job: CeoJob, plan: SessionPlan, model: string): { resumeId: string | undefined; start: string; since: string } {
    this.ceoFresh = plan.fresh;
    const c = this.state.ceo;
    const lastChat = c.kept.lastEndedAt; // before ceoResume starts the count over
    const resume = !plan.fresh && this.ceoResume(a, plan, model);
    const handover = loadHandover(c.handover);
    const successor = !plan.fresh && !resume && (!!a.sessionId || !!handover); // the kept session's next one, not a new conversation's
    const start = plan.fresh || successor ? freshStart(this.ceoDigestNow(job), successor ? handover : null) : '';
    if (successor) c.handover = null; // the new session has it
    if (plan.fresh) this.appendLog(a, [{ kind: 'system', text: "↻ A fresh session with the office's digest: background jobs don't carry the chat (CEO settings → Staying awake)." }]);
    if (start) this.ceoChat.note('🆕', plan.fresh ? 'Started fresh with the office digest' : handover ? 'Fresh session with the handover and digest' : 'Fresh session with the office digest');
    else if (resume) this.ceoChat.note('↺', 'Carried on in its chat session');
    return { resumeId: resume ? (a.sessionId ?? undefined) : undefined, start, since: resume ? sinceLastChat(c.lastJob ?? null, lastChat) : '' };
  }

  /** The office's digest for a fresh session: the chat, decisions, mandates (a follow-up's prompt has them), notes and the latest background job. */
  private ceoDigestNow(job: CeoJob): string {
    const c = this.state.ceo, now = Date.now();
    return ceoDigest({ messages: this.state.messages, decisions: this.state.decisions.list, mandates: job.kind === 'followup' ? [] : liveMandates(this.state.settings.ceoMandates, now), remember: c.remember, lastJob: c.lastJob ?? null, now });
  }

  /** A full kept session's handover to the next one, into state.ceo.handover; none when it can't answer (at its limit, say): the digest alone then. */
  private ceoHandover(a: PersistedAgent): Promise<void> {
    const rt = this.agentRt.get(a.id)!;
    const sid = a.sessionId!;
    this.appendLog(a, [{ kind: 'system', text: '✍ Its session is full: asking it for a handover to the next one.' }]);
    return new Promise((resolve) => {
      let said = '';
      const timer = setTimeout(() => rt.session?.stop(), HANDOVER_MS);
      rt.session = this.startOnAccount(
        a,
        { cwd: CEO_DIR, prompt: HANDOVER_PROMPT, systemAppend: ceoSystemPrompt(this.ceoPromptInput(a)), model: this.state.ceo.kept.model ?? (a.model || CEO_MODEL), effort: 'low', browserTesting: false, additionalDirectories: [], role: 'ceo', office: this.officeTools(), tools: this.sessionToolsFor(a, 'claude'), ...this.sessionRuntime(a, sid) },
        {
          log: (entries) => this.appendLog(a, entries),
          tool: () => undefined,
          sessionId: () => undefined,
          browserUrl: () => undefined,
          screenshot: () => undefined,
          turn: (text) => void (said = text),
          limited: (at) => this.pauseForLimit(at),
          usage: (readings) => this.recordUsage(readings),
          finished: (r) => {
            clearTimeout(timer);
            rt.session = null;
            const usd = this.spend.perTurn(a.id, sid, r).costUsd; // the kept session reports its running total (#254)
            a.costUsd += usd;
            recordCost(this.state.ops, '', usd, Date.now());
            const h = r.ok ? handoverOf(said || r.text, Date.now()) : null;
            this.state.ceo.handover = h;
            this.appendLog(a, [{ kind: 'system', text: h ? '✍ Handover written: the next session starts with it and the digest.' : "✍ No handover (the session couldn't answer): the next session starts with the digest." }]);
            this.save();
            resolve();
          },
        },
      );
    });
  }
}
