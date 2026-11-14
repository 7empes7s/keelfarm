// Settings → Voice → Jarvis voice on calls (#534, docs/voice.md "ElevenLabs Agents"): the switch, who listens (#658), the monthly cap
// (after which calls use today's voice mode), the minutes used today and this month with their estimate, and why a
// call would fall back right now.
import { useId } from 'react';
import { AGENT_USD_PER_MIN, DEFAULT_VOICE_AGENT, hoursLabel, minutesCost, minutesLabel, type AgentListen } from '../../../shared/voiceAgent';
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
      <label className="field" htmlFor={listenId}>
        <span>Listen</span>
        <select id={listenId} value={agent.listen ?? 'browser'} onChange={(e) => save({ listen: e.target.value as AgentListen })}>
          <option value="browser">Browser (default)</option>
          <option value="elevenlabs">ElevenLabs</option>
        </select>
        <span className="muted small">The browser's own speech recognition hears you for free and fast; without it (Firefox) ElevenLabs listens, then the office's OpenAI key, then a recording per turn.</span>
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
