// Settings → Voice → Jarvis voice on calls (#534, docs/voice.md "ElevenLabs Agents"): the switch, the reply address ElevenLabs
// reaches the office on (#682), who listens (#658), the monthly cap
// (after which calls use today's voice mode), the minutes used today and this month with their estimate, and why a
// call would fall back right now.
import { useId } from 'react';
import { AGENT_USD_PER_MIN, DEFAULT_VOICE_AGENT, hoursLabel, LISTENER_NAMES, LISTENERS, minutesCost, minutesLabel, type AgentListen } from '../../../shared/voiceAgent';
import { useStore } from '../store';
import { agentCallWhy } from './agentCallStore';
import { saveVoice } from './VoiceSettings';

export function JarvisSettings() {
  const used = useStore((s) => s.voiceAgent);
  const keySet = useStore((s) => s.voiceKeySet);
  const settings = useStore((s) => s.settings);
  const agent = settings.voice.agent ?? DEFAULT_VOICE_AGENT;
  const capId = useId();
  const listenId = useId();
  const replyId = useId();
  const why = agentCallWhy({ settings, voiceKeySet: keySet, voiceAgent: used });
  const save = (patch: Partial<typeof agent>) => saveVoice({ agent: { ...agent, ...patch } });
  return (
    <div className="jarvis" data-testid="jarvis-settings">
      <label className="toggle">
        <input type="checkbox" checked={agent.on} onChange={(e) => save({ on: e.target.checked })} />
        <span>
          Jarvis voice on calls<span className="muted small"> · the ElevenLabs agent speaks, answers at once and hands real work to the CEO</span>
        </span>
      </label>
      <label className="field" htmlFor={replyId}>
        <span>Reply address</span>
        <input id={replyId} type="url" inputMode="url" placeholder={settings.notify?.officeUrl || 'https://office.example.com'} defaultValue={agent.replyUrl ?? ''} key={agent.replyUrl ?? ''} onBlur={(e) => e.target.value.trim() !== (agent.replyUrl ?? '') && save({ replyUrl: e.target.value.trim() })} />
        <span className="muted small">The public https address ElevenLabs sends each turn to (it adds /v1/chat/completions). Empty: the Office address. Each call first checks ElevenLabs can reach it; if not, the office answers in the same voice and IT gets a ticket.</span>
      </label>
      <label className="field" htmlFor={listenId}>
        <span>Listen</span>
        <select id={listenId} value={agent.listen ?? 'auto'} onChange={(e) => save({ listen: e.target.value as AgentListen })}>
          <option value="auto">Auto (default)</option>
          {LISTENERS.map((l) => (
            <option key={l} value={l}>
              {LISTENER_NAMES[l]}
            </option>
          ))}
        </select>
        <span className="muted small">Auto: the browser's own speech recognition hears you for free and fast; without it (Firefox) the ElevenLabs agent listens, then OpenAI through the office, then a clip per turn. Pick one to test it: a call that can't use it, or where it stops hearing, moves on to the next. The call screen's Call details button shows who listens and each turn's timings.</span>
      </label>
      <label className="field" htmlFor={capId}>
        <span>Monthly limit (hours)</span>
        <input id={capId} type="number" inputMode="decimal" min={0} max={200} step={0.25} defaultValue={agent.capHours} key={agent.capHours} onBlur={(e) => Number(e.target.value) !== agent.capHours && save({ capHours: Number(e.target.value) })} />
        <span className="muted small">After {hoursLabel(agent.capHours)} in a month, calls use the office's own voice until the next.</span>
      </label>
      <p className="muted small" data-testid="jarvis-minutes">
        Used today {minutesLabel(used.minutesToday)} · this month {minutesLabel(used.minutesMonth)}, about {minutesCost(used.minutesMonth)} at ${AGENT_USD_PER_MIN.toFixed(2)}/min
      </p>
      <p className="muted small" data-testid="jarvis-why">
        {why || 'Your next call uses the Jarvis voice. Tap the orb to talk again after "that\'s all".'}
      </p>
    </div>
  );
}
