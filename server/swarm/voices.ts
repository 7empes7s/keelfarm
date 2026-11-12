// A voice for every agent (#320, docs/voice.md): a new agent gets an ElevenLabs voice nobody on their floor has, and so
// does everyone still without one once a key is saved or ElevenLabs turned on. The CEO's voice is settings.voice.
// Clicked, they say a short line about what they're doing (#321, shared/agentLines.ts) in that voice.
import { lineSituation, lineText, nextLine, shortTitle, type LastLine, type LineSituation } from '../../shared/agentLines.ts';
import { needsYou } from '../../shared/needsYou.ts';
import { agentVoice } from '../../shared/voices.ts';
import type { VoiceSettings } from '../../shared/types.ts';
import { DEMO_TALK_PACE, TALK_PACE } from '../../shared/voiceTalk.ts';
import { CeoTalk } from '../ceoTalk.ts';
import { HttpError } from '../httpError.ts';
import { inCall } from '../notify.ts';
import type { VoiceKeyView } from '../voice.ts';
import { SwarmCeoTools } from './ceoTools.ts';
import type { PersistedAgent } from './model.ts';

export abstract class SwarmVoices extends SwarmCeoTools {
  private voicing: Promise<void> = Promise.resolve(); // one round at a time, so each pick sees the ones before
  private lines = new Map<string, LastLine>(); // each agent's last clicked line, for the 20 s cooldown
  /** The CEO talking while it works (#286): acks and progress lines, while it has a voice. */
  protected ceoTalk = new CeoTalk(
    () => this.state.settings.voice.provider !== 'off' || inCall(this.notifier.attention.all()),
    (line) => {
      this.voice.rememberTalk(line.id, line.text);
      this.broadcast({ type: 'voiceLine', line });
    },
    this.backend.demo ? DEMO_TALK_PACE : TALK_PACE,
  );

  /** The manager's message (ceoJobs.ts); one that finds the CEO mid-job gets a spoken ack at once (#286). */
  override async messageCeo(...args: Parameters<SwarmCeoTools['messageCeo']>) {
    const busy = this.state.ceo.job !== null;
    const sent = await super.messageCeo(...args);
    if (busy) this.ceoTalk.ack(Date.now());
    return sent;
  }

  protected voiceKeyChanged(view: VoiceKeyView) {
    this.broadcast({ type: 'voiceKey', ...view });
    if (view.voiceKeySet) void this.voiceEveryone();
  }

  /** After a settings change: prune for a new keepDays, voices for everyone when ElevenLabs was just turned on. */
  protected voiceSettingsChanged(was: VoiceSettings) {
    const now = this.state.settings.voice;
    if (now.keepDays !== was.keepDays) setTimeout(() => void this.voice.prune(), 500);
    if (now.provider === 'elevenlabs' && was.provider !== 'elevenlabs') void this.voiceEveryone();
  }

  /** Every agent without a voice gets one, distinct on their floor where the voices go round; nothing without a key. */
  protected voiceEveryone(): Promise<void> {
    const run = this.voicing.then(async () => {
      for (const a of this.state.agents.filter((x) => x.role !== 'ceo' && !x.voiceId)) {
        const used = this.state.agents.filter((x) => x.repoId === a.repoId && x.id !== a.id && x.voiceId).map((x) => x.voiceId!);
        const picked = await this.voice.pickFor(a.id, used).catch(() => null);
        if (!picked) return; // no key, ElevenLabs off, or no list: the same for everyone
        if (a.voiceId || !this.state.agents.includes(a)) continue; // picked by hand meanwhile, or let go
        Object.assign(a, picked);
        this.save();
        this.emitAgent(a);
      }
    });
    this.voicing = run.catch(() => undefined);
    return run;
  }

  /** PATCH /api/agents/:id's voiceId / voiceName: '' clears it. The CEO's is the office voice, in Settings → Voice. */
  protected setAgentVoice(a: PersistedAgent, patch: { voiceId?: unknown; voiceName?: unknown }) {
    if (a.role === 'ceo') throw new HttpError(400, `${a.name}'s voice is the office voice: change it in Settings → Voice or their profile.`);
    const v = agentVoice(patch);
    if (!v) throw new HttpError(400, 'Not an ElevenLabs voice id.');
    a.voiceId = v.voiceId || undefined;
    a.voiceName = v.voiceName || undefined;
  }

  // ---------- clicked agents' lines (#321) ----------

  /**
   * POST /api/voice/lines/:id: what an agent says when clicked (`hour`: the manager's local hour), and whether
   * ElevenLabs will say it (GET the same path for the clip). Within 20 s of their last line, that line again.
   */
  agentSays(id: string, hour: number): { text: string; clip: boolean } {
    const a = this.agent(id);
    const now = Date.now();
    const last = nextLine(this.lines.get(id), now, this.lineSituationOf(a, hour, now), id);
    this.lines.set(id, last);
    return { text: lineText(last.line), clip: this.voice.speaksLines() };
  }

  /** GET /api/voice/lines/:id: their last line as a clip in their voice (the CEO's: the office voice), cached. */
  agentLineAudio(id: string): Promise<Buffer> {
    const a = this.agent(id);
    const last = this.lines.get(id);
    if (!last) throw new HttpError(404, `${a.name} hasn't said anything yet.`);
    return this.voice.lineAudio(a.role === 'ceo' ? '' : (a.voiceId ?? ''), last.line);
  }

  private lineSituationOf(a: PersistedAgent, hour: number, now: number): LineSituation {
    if (a.role === 'ceo') return this.companyLine(now);
    const v = this.agentView(a, false);
    const merge = v.career?.recent[0];
    const q = v.task === 'qa' ? this.state.qa.find((x) => x.repoId === a.repoId && x.prNumber === a.prNumber) : undefined;
    const author = q?.devAgentId ? (this.state.agents.find((x) => x.id === q.devAgentId)?.name ?? '') : '';
    return lineSituation({
      ...v,
      issueTitle: v.issueTitle && shortTitle(v.issueTitle),
      lastMerge: merge ? { pr: merge[0], at: merge[2] } : null,
      author,
      memoryWait: !!this.health.view().heldWork,
      hour,
      now,
    });
  }

  /** The CEO's one-line company status: who's busy, free and needing the manager, and today's merges. */
  private companyLine(now: number): LineSituation {
    const views = this.state.agents.filter((x) => x.role !== 'ceo').map((x) => this.agentView(x, false));
    const midnight = new Date(now).setHours(0, 0, 0, 0);
    return {
      kind: 'ceo',
      busy: views.filter((v) => v.status === 'working' || v.status === 'preparing').length,
      free: views.filter((v) => v.status === 'idle' || v.status === 'done').length,
      needs: views.filter((v) => needsYou(v)).length,
      merged: views.reduce((n, v) => n + (v.career?.week.filter((at) => at >= midnight).length ?? 0), 0),
    };
  }
}
