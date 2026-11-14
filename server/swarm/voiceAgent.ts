// The Jarvis voice (#534, docs/voice.md "ElevenLabs Agents"): on a call, ElevenLabs Agents listens, takes turns and
// speaks; the office is its LLM. POST /api/voice/agent/start makes or updates the office's agent and hands the browser
// a short-lived signed URL (never the key); POST /v1/chat/completions answers each turn at once from the office's own
// data (shared/voiceBrain.ts) or a fast model's streamed answer (#665, server/voiceFast.ts), hands real work to the CEO
// like a typed message in the background, asks before changing anything, and writes both sides into the CEO chat as
// voice messages. Each turn's timings join the call's trace (#665). Minutes are counted per day against Settings → Voice's cap.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cleanTrace, keepTrace, turnWords, type CallTrace } from '../../shared/callTrace.ts';
import { redact } from '../../shared/journal.ts';
import { messageSpeech } from '../../shared/speech.ts';
import type { WorldSnapshot } from '../../shared/types.ts';
import { DEFAULT_VOICE_AGENT, addCallSeconds, agentWhy, parseUsage, usageMinutes, type AgentUsage, type VoiceAgentView } from '../../shared/voiceAgent.ts';
import { MARKER, NO_BRAIN, brainTurn, lastUserText, markerSay, type BrainAct, type BrainFacts, type BrainState } from '../../shared/voiceBrain.ts';
import { VOICE_ID } from '../../shared/voices.ts';
import { HOME_DIR } from '../config.ts';
import { HttpError } from '../httpError.ts';
import { DEFAULT_VOICE, localDay } from '../voice.ts';
import { bearerOk, newLlmToken, sessionOf, type AgentIds } from '../voiceAgent.ts';
import { fastModel, fastPrompt, fastSentences, type FastModel } from '../voiceFast.ts';
import { SwarmProblems } from './problems.ts';

/** A call nobody ended (a crashed tab) is counted up to its last turn plus this, once it's been quiet STALE_MS. */
const STALE_MS = 15 * 60_000;
const TAIL_MS = 30_000;
/** Spoken answers longer than the CEO's summary by this many characters add "the full answer's in the chat". */
const LONGER_BY = 80;
/** A fast answer that hasn't finished by then is cut off (what it said stands). */
const FAST_TIMEOUT_MS = 8_000;
/** Calls whose turn timings are kept for their traces (#665), and the turns of each. */
const TIMED_SESSIONS = 20;
const TIMED_TURNS = 20;

/** The office's side of a turn (#665): ms from the request to its first words and to the end. */
interface LlmTime {
  first: number;
  done: number;
}

interface AgentFile {
  token: string; // the bearer token ElevenLabs sends to /v1/chat/completions
  ids: AgentIds | null;
  usage: AgentUsage;
}

interface AgentSession {
  at: number;
  last: number;
  brain: BrainState;
}

/** The conversation ElevenLabs sent, for the fast model: the manager's and the voice's turns (never the CEO markers), the last 8. */
function chatHistory(messages: unknown): { role: 'user' | 'assistant'; content: string }[] {
  if (!Array.isArray(messages)) return [];
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of messages as { role?: unknown; content?: unknown }[]) {
    if ((m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim() && !MARKER.test(m.content)) out.push({ role: m.role, content: m.content.slice(0, 1000) });
  }
  return out.slice(-8);
}

/** The office's facts in a few lines, for the fast model's prompt. */
function factsLine(f: BrainFacts): string {
  const floors = f.floors.map((x) => `Floor ${x.floor} ${x.name}: ${x.open} open issues, ${x.prs} open PRs, ${x.mergedToday} merged today; ${x.agents.map((a) => `${a.name} ${a.doing || a.status}`).join(', ') || 'nobody'}.`);
  const decisions = f.decisions.slice(0, 3).map((d) => `Waiting on the manager: ${d.question}`);
  const it = f.it?.map((c) => `${c.label}: ${c.line}`) ?? [];
  return [...floors, f.ceoJob ? `The CEO is ${f.ceoJob}.` : 'The CEO is free.', ...decisions, ...it].join('\n').slice(0, 3000);
}

/** "issue #12" → "working on issue 12"; "testing PR #9" → "testing pull request 9". */
const doingWords = (d: string | null) => (d ? d.replace(/^issue #(\d+)/, 'working on issue $1').replace(/\bPR #(\d+)/, 'pull request $1') : '');

export abstract class SwarmVoiceAgent extends SwarmProblems {
  private agentFile: AgentFile | null = null;
  private agentSessions = new Map<string, AgentSession>();
  private callTraces: CallTrace[] = [];
  private llmTimes = new Map<string, LlmTime[]>(); // a call's turns (never markers), in the order they came
  private loggedTurns = new Set<string>();

  /**
   * POST /api/voice/trace (#650): a call's trace from the browser, logged as one line and kept (the last 20 calls).
   * Each turn gets the office's own timings for it (#665: its `s`th turn on its conversation's `session`, read here and
   * never kept or logged) and is logged once, as `voice: turn {…}`, when its voice has started or the call ended.
   */
  voiceTrace(body: unknown) {
    const secrets = [...this.secrets(), this.agentData().token];
    const t = cleanTrace(body, (s) => redact(s, secrets));
    if (!t) throw new HttpError(400, 'Not a call trace: it needs an id.');
    const raw = (body as { turns?: unknown }).turns;
    const rawTurns = Array.isArray(raw) ? raw.slice(-t.turns.length) : [];
    t.turns.forEach((turn, i) => {
      const r = (rawTurns[i] ?? {}) as { session?: unknown; s?: unknown };
      const times = typeof r.session === 'string' ? this.llmTimes.get(r.session) : undefined;
      const x = typeof r.s === 'number' ? times?.[r.s - 1] : undefined;
      if (x?.done) turn.office = { ...x };
      const key = `${t.id}:${turn.n}`;
      if ((turn.firstAudio || t.final) && !this.loggedTurns.has(key)) {
        if (this.loggedTurns.size > 500) this.loggedTurns.clear();
        this.loggedTurns.add(key);
        console.log(`voice: turn ${JSON.stringify({ call: t.id, ...turn, words: turnWords(turn) })}`);
      }
    });
    console.log(`voice: call trace ${JSON.stringify(t)}`);
    this.callTraces = keepTrace(this.callTraces, t);
  }

  /** GET /api/voice/traces: the kept traces, newest last. */
  voiceTraces(): CallTrace[] {
    return this.callTraces;
  }

  private get agentPath() {
    return path.join(HOME_DIR, this.backend.demo ? 'demo-voice-agent.json' : 'voice-agent.json');
  }

  /** The saved token, agent and minutes, read once (a small file, readable only by the owner like secrets.json). */
  private agentData(): AgentFile {
    if (this.agentFile) return this.agentFile;
    let raw: Partial<AgentFile> = {};
    try {
      raw = JSON.parse(fs.readFileSync(this.agentPath, 'utf8')) as Partial<AgentFile>;
    } catch {
      // first use
    }
    const ids = raw.ids && typeof raw.ids.agentId === 'string' && typeof raw.ids.secretId === 'string' ? { agentId: raw.ids.agentId, secretId: raw.ids.secretId, hash: String(raw.ids.hash ?? '') } : null;
    this.agentFile = { token: typeof raw.token === 'string' && raw.token.length >= 24 ? raw.token : newLlmToken(), ids, usage: parseUsage(raw.usage) };
    return this.agentFile;
  }

  private saveAgentData() {
    const tmp = `${this.agentPath}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.agentPath), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(this.agentData()), { mode: 0o600 });
      fs.renameSync(tmp, this.agentPath);
    } catch (err) {
      console.error('voice agent: could not save', (err as Error).message);
    }
  }

  protected voiceAgentView(): VoiceAgentView {
    return { ...usageMinutes(this.agentData().usage, localDay(Date.now())), fake: this.backend.demo };
  }

  override snapshot(): WorldSnapshot {
    return { ...super.snapshot(), voiceAgent: this.voiceAgentView() };
  }

  /** Why a call can't use the Jarvis voice right now ('' when it can). */
  private voiceAgentWhy(): string {
    const s = this.state.settings;
    return agentWhy({ settings: s.voice.agent ?? DEFAULT_VOICE_AGENT, keySet: this.voice.keyView().voiceKeySet, officeUrl: s.notify.officeUrl, minutesMonth: this.voiceAgentView().minutesMonth, fake: this.backend.demo });
  }

  /** What the agent says as a conversation opens. */
  agentGreeting() {
    return `Hi, it's ${this.ceo().name}. What can I do for you?`;
  }

  /** POST /api/voice/agent/start: the office's agent made or brought up to date, and a signed URL for one conversation. */
  async startVoiceAgent(): Promise<{ session: string; url: string; stt: boolean }> {
    this.sweepAgentSessions();
    const why = this.voiceAgentWhy();
    if (why) throw new HttpError(409, why);
    const s = this.state.settings;
    const data = this.agentData();
    const voiceId = s.voice.provider === 'elevenlabs' && VOICE_ID.test(s.voice.voiceId) ? s.voice.voiceId : DEFAULT_VOICE.voiceId;
    const key = this.voice.secret();
    try {
      const ids = await this.backend.voice.ensureAgent(key, { name: `${s.companyName || 'cubefarm'} office voice`, llmUrl: `${s.notify.officeUrl.replace(/\/+$/, '')}/v1`, llmSecretId: '', voiceId, firstMessage: this.agentGreeting() }, data.ids, data.token);
      if (JSON.stringify(ids) !== JSON.stringify(data.ids)) {
        data.ids = ids;
        this.saveAgentData();
      }
      const url = await this.backend.voice.agentUrl(key, ids.agentId);
      const session = crypto.randomBytes(9).toString('base64url');
      this.agentSessions.set(session, { at: Date.now(), last: Date.now(), brain: NO_BRAIN });
      return { session, url, stt: !!this.sttKey() };
    } catch (err) {
      throw new HttpError(502, `ElevenLabs couldn't start the call: ${(err as Error).message}`);
    }
  }

  /** The OpenAI key the call's transcription relay uses (#658: OpenAI audio first, then any OpenAI key), 'fake' in the demo, or null. Server memory only. */
  private sttKey(): string | null {
    if (this.backend.demo) return 'fake';
    return this.providers.keysFor('openai-audio')[0]?.key ?? this.providers.keysFor('openai')[0]?.key ?? null;
  }

  /** /ws/voice-stt?session=: the key for a live call's relay, or null (no such call, or no OpenAI key). */
  voiceSttKey(session: string): string | null {
    return this.agentSessions.has(session) ? this.sttKey() : null;
  }

  /** POST /api/voice/agent/:session/end: the call's minutes counted (again is harmless). */
  endVoiceAgent(session: string): VoiceAgentView {
    const s = this.agentSessions.get(session);
    if (s) this.countAgentSession(session, s, Date.now());
    return this.voiceAgentView();
  }

  private countAgentSession(id: string, s: AgentSession, end: number) {
    this.agentSessions.delete(id);
    const data = this.agentData();
    data.usage = addCallSeconds(data.usage, localDay(s.at), (end - s.at) / 1000);
    this.saveAgentData();
    this.broadcast({ type: 'voiceAgent', voiceAgent: this.voiceAgentView() });
  }

  private sweepAgentSessions(now = Date.now()) {
    for (const [id, s] of this.agentSessions) if (now - s.last > STALE_MS) this.countAgentSession(id, s, s.last + TAIL_MS);
  }

  /** POST /v1/chat/completions (stream: false) and the demo's fake agent: the turn's words, whole. */
  async voiceLlm(body: unknown, auth: string | undefined, trusted = false): Promise<string> {
    let out = '';
    for await (const piece of this.voiceTurn(body, auth, trusted)) out += piece;
    return out;
  }

  /**
   * POST /v1/chat/completions, ElevenLabs' custom LLM: the words to say for this turn, piece by piece as they exist
   * (#665: the route streams each at once). `trusted`: the demo's fake agent socket, in this process; anything else
   * must carry the bearer token the agent was made with. Each manager turn's timings are kept for its call's trace.
   */
  async *voiceTurn(body: unknown, auth: string | undefined, trusted = false): AsyncGenerator<string> {
    if (!trusted && !bearerOk(auth, this.agentData().token)) {
      console.log('voice agent: refused a turn without the agent token');
      throw new HttpError(401, 'Not the office voice agent');
    }
    const t0 = Date.now();
    const id = sessionOf(body);
    const session = this.agentSessions.get(id) ?? { at: t0, last: t0, brain: NO_BRAIN };
    if (id && !this.agentSessions.has(id)) this.agentSessions.set(id, session);
    session.last = t0;
    const messages = (body as { messages?: unknown } | null)?.messages;
    const text = lastUserText(messages).trim();
    console.log(`voice agent: a turn from ElevenLabs (${text.length} characters)`); // never the words: IT sees calls reach the office (#645)
    const mark = MARKER.exec(text);
    if (mark) {
      yield this.markerWords(mark[1] as 'msg' | 'line', Number(mark[2]));
      return;
    }
    const time = this.timeTurn(id);
    try {
      for await (const piece of this.turnWords(text, session, messages)) {
        time.first ||= Math.max(1, Date.now() - t0);
        yield piece;
      }
    } finally {
      time.done = Math.max(1, Date.now() - t0);
    }
  }

  /** A new turn's timings, kept in its call's list (a bounded number of calls and turns). */
  private timeTurn(session: string): LlmTime {
    const time = { first: 0, done: 0 };
    if (!session) return time;
    const list = this.llmTimes.get(session) ?? [];
    this.llmTimes.delete(session);
    this.llmTimes.set(session, [...list, time].slice(-TIMED_TURNS));
    for (const k of [...this.llmTimes.keys()].slice(0, -TIMED_SESSIONS)) this.llmTimes.delete(k);
    return time;
  }

  /**
   * A manager turn's words: the office's own answer, a fast model's for an open question when a key for one is there
   * (#665, streamed sentence by sentence), and real work handed to the CEO in the background, never waited on.
   */
  private async *turnWords(text: string, session: AgentSession, messages: unknown): AsyncGenerator<string> {
    const before = session.brain;
    const facts = this.brainFacts();
    const turn = brainTurn(text, before, facts);
    session.brain = turn.state;
    const fast = turn.handoff && !before.pending && turn.act?.kind === 'ceo' ? this.fastVoiceModel() : null;
    if (fast) {
      const said: string[] = [];
      try {
        const gen = fastSentences(this.backend.voice.chatStream(fast, chatHistory(messages), fastPrompt(facts.ceoName, factsLine(facts)), AbortSignal.timeout(FAST_TIMEOUT_MS)));
        for (let r = await gen.next(); ; r = await gen.next()) {
          if (r.done) {
            if (r.value === 'handoff') console.log(`voice agent: ${fast.provider} handed the question to the CEO`);
            break;
          }
          said.push(r.value);
          yield r.value;
        }
      } catch (err) {
        console.log(`voice agent: the fast answer (${fast.provider}) failed: ${(err as Error).message}`);
      }
      if (said.length) {
        this.postMessage('manager', text.slice(0, 4000), undefined, { voiceCall: true });
        this.postMessage('ceo', said.join('').trim(), undefined, { voiceCall: true });
        return;
      }
    }
    let say = turn.say;
    if (turn.record && !turn.handoff) this.postMessage('manager', text.slice(0, 4000), undefined, { voiceCall: true });
    if (turn.act && turn.handoff) {
      void this.voiceAct(turn.act).catch((err: Error) => console.log(`voice agent: handing the turn to the CEO failed: ${err.message}`));
    } else if (turn.act) {
      try {
        await this.voiceAct(turn.act);
      } catch (err) {
        say = `That didn't work: ${(err as Error).message}`;
      }
    }
    if (turn.record) this.postMessage('ceo', say, undefined, { voiceCall: true });
    yield say;
  }

  /** The model for fast answers (#665): the first fast provider with a key; the demo's fake. */
  private fastVoiceModel(): FastModel | null {
    if (this.backend.demo) return { provider: 'demo', url: '', key: 'fake', model: 'demo' };
    return fastModel((p) => this.providers.keysFor(p)[0]?.key);
  }

  /** The CEO's answer (its spoken summary) or a progress line, for the client's marker. */
  private markerWords(kind: 'msg' | 'line', n: number): string {
    if (kind === 'line') return markerSay(this.voice.talkLine(n) ?? '', false) || 'Still working on it.';
    const m = this.state.messages.find((x) => x.id === n);
    const spoken = m ? messageSpeech(m) : '';
    if (!m || !spoken) return `${this.ceo().name} answered in the chat.`;
    return markerSay(spoken, messageSpeech(m, { whole: true }).length > spoken.length + LONGER_BY || !!m.artifacts?.length || !!m.visuals?.length);
  }

  /** What the manager said yes to (or asked the CEO): done as the chat's buttons would. */
  private async voiceAct(act: BrainAct) {
    if (act.kind === 'ceo') {
      await this.messageCeo(act.text, undefined, 'voice');
      return;
    }
    const d = this.state.decisions.list.find((x) => x.id === act.id && x.status === 'open');
    if (!d) throw new Error('that decision is no longer open');
    if (d.kind === 'team') {
      if (act.approve) this.approveRequest(d.id.slice('team:'.length));
      else this.rejectRequest(d.id.slice('team:'.length));
    } else if (d.kind === 'charter') this.decideCharter(d.repoIds[0], !!act.approve);
    else await this.messageCeo(act.option, d.messageId ?? undefined, 'voice');
  }

  /** What a turn can answer from: floors, people, the CEO's job, open decisions and IT's checks. */
  private brainFacts(): BrainFacts {
    const ops = this.opsNow();
    const now = Date.now();
    const job = this.ceoInfo().job?.label;
    return {
      ceoName: this.ceo().name,
      floors: [...this.state.repos]
        .sort((a, b) => a.floor - b.floor)
        .map((r) => {
          const rt = this.repoRt.get(r.id);
          return {
            floor: r.floor,
            name: r.fullName.split('/').pop() ?? r.fullName,
            open: rt?.issues.length ?? 0,
            prs: rt?.pulls.filter((p) => p.state === 'OPEN').length ?? 0,
            mergedToday: ops.floors.find((f) => f.repoId === r.id)?.mergedToday ?? 0,
            agents: this.state.agents.filter((a) => a.repoId === r.id && a.role !== 'ceo').map((a) => ({ name: a.name, status: a.status, doing: doingWords(this.agentDoing(a)) })),
          };
        }),
      ceoJob: job ? `${job.charAt(0).toLowerCase()}${job.slice(1)}` : null,
      decisions: this.state.decisions.list
        .filter((d) => d.status === 'open' && !(d.snoozedUntil && d.snoozedUntil > now))
        .sort((a, b) => b.lastAskedAt - a.lastAskedAt)
        .map((d) => ({ id: d.id, kind: d.kind, question: d.question, options: d.options })),
      it: this.state.itWatch.checks.length ? this.state.itWatch.checks.map((c) => ({ label: c.label, level: c.level, line: c.line })) : null,
    };
  }
}
