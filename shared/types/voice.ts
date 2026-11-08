// Reading messages aloud and listening to the manager (docs/voice.md). Imported through shared/types.ts.

/** Who reads phone messages aloud: nobody, the browser's own voice, or ElevenLabs (with the manager's key). */
export type VoiceProvider = 'off' | 'browser' | 'elevenlabs';

export interface VoiceSettings {
  provider: VoiceProvider;
  voiceId: string; // the ElevenLabs voice (or the browser voice's name)
  voiceName: string;
  model: string; // ElevenLabs model id
  speakOffice: boolean; // read the office's own notes too, not just the CEO's messages
  keepDays: number; // saved clips older than this are deleted (1–90; the newest 20 CEO messages' clips always stay)
  speed: number; // speech speed, 0.7–1.2 (ElevenLabs' voice_settings.speed, the browser voice's rate); shared/voices.ts
  favourites: string[]; // ElevenLabs voice ids starred in any voice picker, shown first (ids only)
  talk: TalkWhileWorking; // the CEO's spoken progress while it works (#286); during a call 'off' means milestones
}

/** Settings → Voice's "Talk while working": no progress lines, only milestones, or a line about every minute too. */
export type TalkWhileWorking = 'off' | 'milestones' | 'regular';

/**
 * A line the CEO says while it works (#286, shared/voiceTalk.ts): an instant ack of the manager's message, or progress.
 * Spoken and shown as a chip, never a chat message. Its clip is GET /api/voice/lines/:id.
 */
export interface VoiceLine {
  id: number;
  kind: 'ack' | 'progress';
  milestone?: boolean;
  text: string;
  at: number;
}

/** Who turns the manager's speech into text: nobody (no 🎙), the browser's own recognition, or ElevenLabs (with the key). */
export type ListenProvider = 'off' | 'browser' | 'elevenlabs';

/** Talking instead of typing (docs/voice.md): the 🎙 by every message box, and the phone's hands-free conversation. */
export interface ListenSettings {
  provider: ListenProvider;
  autoSend: boolean; // send once you stop talking (about 1.2 s of quiet), not only when you press Send
  handsFree: boolean; // after the CEO's spoken reply, the phone listens for up to 8 s and sends what it hears
}

/** The voice's saved clips: how many and how big, and which phone messages can be replayed from them. */
export interface VoiceCacheView {
  clips: number;
  bytes: number;
  saved: number[]; // message ids with every clip still on disk
}

/** GET /api/voice/voices: a voice the manager can pick. recommended: on docs/voice.md's shortlist. */
export interface VoiceOption {
  id: string;
  name: string;
  category: string;
  labels: { accent: string; gender: string; age: string; description: string; use_case: string };
  previewUrl: string | null;
  recommended: boolean;
  v4?: boolean; // made for Eleven v4 (the API's per-voice model metadata): shown first, after the favourites
}
