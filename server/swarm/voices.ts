// A voice for every agent (#320, docs/voice.md): a new agent gets an ElevenLabs voice nobody on their floor has, and so
// does everyone still without one once a key is saved or ElevenLabs turned on. The CEO's voice is settings.voice.
import { agentVoice } from '../../shared/voices.ts';
import type { VoiceSettings } from '../../shared/types.ts';
import { DEMO_TALK_PACE, TALK_PACE } from '../../shared/voiceTalk.ts';
import { CeoTalk } from '../ceoTalk.ts';
import { HttpError } from '../httpError.ts';
import type { VoiceKeyView } from '../voice.ts';
import { SwarmCeoTools } from './ceoTools.ts';
import type { PersistedAgent } from './model.ts';

export abstract class SwarmVoices extends SwarmCeoTools {
  private voicing: Promise<void> = Promise.resolve(); // one round at a time, so each pick sees the ones before
  /** The CEO talking while it works (#286): acks and progress lines, while it has a voice. */
  protected ceoTalk = new CeoTalk(
    () => this.state.settings.voice.provider !== 'off',
    (line) => {
      this.voice.rememberLine(line.id, line.text);
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
}
