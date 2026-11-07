// The voice in a profile (#320): an agent's own ElevenLabs voice, with Shuffle, or the CEO's, which is the office voice
// (settings.voice) that reads messages aloud and talks in voice mode, so changing it here changes Settings → Voice too.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { agentsOnRepo, useStore, type Agent } from '../store';
import { pickVoice, voicePool } from '../../../shared/voices';
import { Icon } from './Icon';
import { useElevenLabsReady, useVoiceList, VoiceGate, VoicePicker, type Playing } from './VoiceChooser';
import { stopVoice } from './voicePlayback';

let shuffles = 0;

function Pickers({ agent }: { agent: Agent }) {
  const voice = useStore((s) => s.settings.voice);
  const agents = useStore((s) => s.agents);
  const list = useVoiceList();
  const [playing, setPlaying] = useState<Playing>(null);
  useEffect(() => stopVoice, []); // leaving the profile stops a preview
  const ceo = agent.role === 'ceo';
  const chosen = ceo ? voice.voiceId : (agent.voiceId ?? '');
  const choose = (voiceId: string, voiceName: string) =>
    void (ceo ? api.updateSettings({ voice: { ...voice, voiceId, voiceName } }) : api.updateAgent(agent.id, { voiceId, voiceName })).catch(() => undefined);
  const shuffle = () => {
    if (!Array.isArray(list)) return;
    const used = agentsOnRepo(agents, agent.repoId).flatMap((a) => (a.id !== agent.id && a.voiceId ? [a.voiceId] : []));
    const id = pickVoice(voicePool(list, voice.favourites), used, `${agent.id}:${++shuffles}:${Date.now()}`, chosen);
    const v = id && list.find((x) => x.id === id);
    if (v) choose(v.id, v.name);
  };
  return (
    <>
      <div className="row wrap">
        <span className="grow small">
          {ceo ? 'Reads your messages aloud and talks in voice mode.' : 'Their voice in the office.'} <b>{(ceo ? voice.voiceName : agent.voiceName) || 'None yet'}</b>
        </span>
        {!ceo && (
          <button type="button" className="btn btn-small" disabled={!Array.isArray(list)} onClick={shuffle}>
            <Icon name="shuffle" /> Shuffle
          </button>
        )}
      </div>
      <VoicePicker list={list} chosen={chosen} onChoose={(v) => choose(v.id, v.name)} name={`voice-${agent.id}`} playing={playing} setPlaying={setPlaying} />
    </>
  );
}

/** The profile's Voice card: the picker while ElevenLabs speaks with a key, else the way to Settings → Voice. */
export function ProfileVoice({ agent }: { agent: Agent }) {
  const ready = useElevenLabsReady();
  return (
    <div className="profile-voice">
      <h4>
        <Icon name="volume-2" /> Voice
      </h4>
      {ready ? <Pickers agent={agent} /> : <VoiceGate />}
    </div>
  );
}
