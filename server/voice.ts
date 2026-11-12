// Phone messages read aloud by ElevenLabs: the manager's key (kept in its own secrets file, never in the state, the
// snapshot, events or agents' environments), the voice list, and spoken messages cached as mp3 under <SWARM_HOME>/voice,
// with clips.json recording which clips belong to which message so the phone can replay them without a new synthesis.
// The same key turns the manager's recorded speech into text when ElevenLabs is the 🎙's provider.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spokenLine } from '../shared/agentLines.ts';
import { SAMPLE_LINE, messageSpeech, standupLine, type DayPart } from '../shared/speech.ts';
import { clampKeepDays, KEEP_DAYS_DEFAULT } from '../shared/voiceClips.ts';
import { clipProblem, clipType } from '../shared/clipLimits.ts';
import { clampSpeed, cleanFavourites, pickVoice, SPEED_DEFAULT, VOICE_ID, voicePool } from '../shared/voices.ts';
import type { ListenSettings, PhoneMessage, VoiceCacheView, VoiceOption, VoiceSettings } from '../shared/types.ts';
import { secretMismatch } from '../shared/secretFormats.ts';
import { DEFAULT_VOICE_AGENT, voiceAgentSettings } from '../shared/voiceAgent.ts';
import type { AgentConfig, AgentIds } from './voiceAgent.ts';
import { HttpError } from './httpError.ts';
import { mergeSecrets, readSecrets } from './secrets.ts';

/**
 * Eleven v4, ElevenLabs' richest model (elevenlabs.io/docs/models): messages are short spoken summaries (#282), so its
 * higher price per character stays small. A new office's model; a saved one is kept.
 */
export const DEFAULT_VOICE_MODEL = 'eleven_v4';
export const VOICES_TTL_MS = 10 * 60_000;
export const SYNTH_TIMEOUT_MS = 20_000;
/** ElevenLabs' Speech to Text model (Scribe v2). */
export const STT_MODEL = 'scribe_v2';
export const TRANSCRIBE_TIMEOUT_MS = 30_000;
export const CACHE_MAX_FILES = 200;
const DAY_MS = 24 * 60 * 60_000;
export const CACHE_MAX_AGE_MS = KEEP_DAYS_DEFAULT * DAY_MS;
/** The clips of this many of the newest CEO messages stay whatever their age. */
export const KEEP_NEWEST_MESSAGES = 20;
/** The CEO's latest spoken lines kept for their clips (#286). */
const LINES_KEPT = 20;
const MANIFEST = 'clips.json';
const USAGE = 'usage.json';
export const KEY_REJECTED_NOTE = "🔇 ElevenLabs rejected the key, so messages aren't read aloud until you set a new one in the voice settings.";

type Labels = VoiceOption['labels'];
const voice = (id: string, name: string, description: string, accent = ''): VoiceOption => ({
  id,
  name,
  category: 'library',
  labels: { accent, gender: '', age: '', description, use_case: 'conversational' },
  previewUrl: null,
  recommended: true,
});

/**
 * docs/voice.md's shortlist for a calm, friendly CEO: ElevenLabs' replacements for its Default voices, which expire on
 * 31 December 2026. They're in the Voice Library, usable by id without saving them (paid plans).
 */
export const RECOMMENDED_VOICES: VoiceOption[] = [
  voice('OZ0L6eISlOejga3XjDFt', 'Talia', 'warm soft guide'),
  voice('l7kNoIfnJKPg7779LI2t', 'Eddie', 'helpful and comforting'),
  voice('AaOhDHYJ1XLZk74lXhdE', 'Caleb', 'trusted guide'),
  voice('gOupLcAkjEnguROwi4oS', 'Darian', 'warm grounded storyteller'),
  voice('BFd5oBc2DDna33pSi4Gf', 'Alicia', 'polished global anchor'),
  voice('QtY3JBOUKEB5xzrRfOKc', 'Maisie', 'friendly casual neighbor'),
  voice('FrS6cKLB1wg4WYgPa9GW', 'Wyatt', 'seasoned mentor'),
  voice('6WwXjDDEMyNmFG95zycZ', 'Eldrin', 'crisp baritone', 'british'),
];

export const DEFAULT_VOICE: VoiceSettings = {
  provider: 'off',
  voiceId: RECOMMENDED_VOICES[0].id,
  voiceName: RECOMMENDED_VOICES[0].name,
  model: DEFAULT_VOICE_MODEL,
  speakOffice: false,
  keepDays: KEEP_DAYS_DEFAULT,
  speed: SPEED_DEFAULT,
  favourites: [],
  talk: 'off',
  agentsSpeak: true,
  agent: DEFAULT_VOICE_AGENT,
};

const MODEL_ID = /^[a-z0-9_.-]{1,64}$/;

/** Voice settings from a saved state or a PATCH /api/settings, field by field; anything invalid keeps `base`. */
export function voiceSettings(base: VoiceSettings, patch: unknown): VoiceSettings {
  const p = (patch && typeof patch === 'object' ? patch : {}) as Partial<Record<keyof VoiceSettings, unknown>>;
  const out = { ...base };
  if (p.provider === 'off' || p.provider === 'browser' || p.provider === 'elevenlabs') out.provider = p.provider;
  // The browser's voices are named rather than numbered ("Google UK English Female"), so any short name goes.
  if (typeof p.voiceId === 'string' && p.voiceId.trim() && p.voiceId.length <= 200) out.voiceId = p.voiceId.trim();
  if (typeof p.voiceName === 'string') out.voiceName = p.voiceName.trim().slice(0, 80);
  if (typeof p.model === 'string' && MODEL_ID.test(p.model.trim())) out.model = p.model.trim();
  if (typeof p.speakOffice === 'boolean') out.speakOffice = p.speakOffice;
  if (p.talk === 'off' || p.talk === 'milestones' || p.talk === 'regular') out.talk = p.talk;
  if (typeof p.agentsSpeak === 'boolean') out.agentsSpeak = p.agentsSpeak;
  out.keepDays = clampKeepDays(p.keepDays ?? out.keepDays);
  out.speed = clampSpeed(p.speed ?? out.speed);
  out.favourites = cleanFavourites(p.favourites ?? out.favourites);
  out.agent = voiceAgentSettings(out.agent ?? DEFAULT_VOICE_AGENT, p.agent);
  return out;
}

/** The browser's speech recognition is free and needs no key, so it's where a new office starts. */
export const DEFAULT_LISTEN: ListenSettings = { provider: 'browser', autoSend: false, handsFree: false };

/** Listening settings from a saved state or a PATCH /api/settings, field by field; anything invalid keeps `base`. */
export function listenSettings(base: ListenSettings, patch: unknown): ListenSettings {
  const p = (patch && typeof patch === 'object' ? patch : {}) as Partial<Record<keyof ListenSettings, unknown>>;
  const out = { ...base };
  if (p.provider === 'off' || p.provider === 'browser' || p.provider === 'elevenlabs') out.provider = p.provider;
  if (typeof p.autoSend === 'boolean') out.autoSend = p.autoSend;
  if (typeof p.handsFree === 'boolean') out.handsFree = p.handsFree;
  return out;
}

/**
 * Which cached clips to delete: anything older than `maxAgeMs`, then the oldest beyond `max`. Clips in `keep` (the
 * newest messages') always stay and count towards `max`.
 */
export function cacheToPrune(files: { name: string; mtimeMs: number }[], now: number, max = CACHE_MAX_FILES, maxAgeMs = CACHE_MAX_AGE_MS, keep: ReadonlySet<string> = new Set()): string[] {
  const pinned = files.filter((f) => keep.has(f.name)).length;
  const fresh = files.filter((f) => !keep.has(f.name) && now - f.mtimeMs <= maxAgeMs).sort((a, b) => b.mtimeMs - a.mtimeMs);
  const kept = new Set([...keep, ...fresh.slice(0, Math.max(0, max - pinned)).map((f) => f.name)]);
  return files.filter((f) => !kept.has(f.name)).map((f) => f.name);
}

// ---------- which clips belong to which message ----------

/** A message's clips (in the order they're spoken) and the message's time, which tells a reused id apart. */
export interface ClipEntry {
  at: number;
  files: string[];
}
/** clips.json: message id → its clips, recorded when they're first made, so a later voice or model change still replays them. */
export type ClipManifest = Record<string, ClipEntry>;

/** The clips recorded for `m`, or null: none, or recorded for an older message that had the same id. */
export function clipsFor(manifest: ClipManifest, m: Pick<PhoneMessage, 'id' | 'at'>): string[] | null {
  const e = manifest[m.id];
  return e && e.at === m.at && e.files.length ? e.files : null;
}

/** The manifest with `files` recorded as `m`'s clips. */
export function withClips(manifest: ClipManifest, m: Pick<PhoneMessage, 'id' | 'at'>, files: string[]): ClipManifest {
  return { ...manifest, [m.id]: { at: m.at, files } };
}

/** The manifest without the messages that lost any of their clips (a partial message can't be replayed). */
export function withoutMissing(manifest: ClipManifest, onDisk: ReadonlySet<string>): ClipManifest {
  return Object.fromEntries(Object.entries(manifest).filter(([, e]) => e.files.every((f) => onDisk.has(f))));
}

/** The clips that stay whatever their age: those of the newest `n` CEO messages. */
export function newestClips(manifest: ClipManifest, messages: readonly PhoneMessage[], n = KEEP_NEWEST_MESSAGES): Set<string> {
  const ceo = messages.filter((m) => m.from === 'ceo').slice(-n);
  return new Set(ceo.flatMap((m) => clipsFor(manifest, m) ?? []));
}

/** The messages that can be replayed from the cache, oldest first. */
export function savedMessages(manifest: ClipManifest, messages: readonly PhoneMessage[]): number[] {
  return messages.filter((m) => clipsFor(manifest, m)).map((m) => m.id);
}

/** A manifest read from disk, entry by entry; anything malformed (or naming a file outside the cache) is dropped. */
export function parseManifest(raw: unknown): ClipManifest {
  const out: ClipManifest = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, e] of Object.entries(raw as Record<string, unknown>)) {
    const { at, files } = (e ?? {}) as { at?: unknown; files?: unknown };
    if (!/^\d+$/.test(id) || typeof at !== 'number' || !Array.isArray(files) || !files.length) continue;
    if (files.every((f) => typeof f === 'string' && /^[\w-]+\.mp3$/.test(f))) out[id] = { at, files: files as string[] };
  }
  return out;
}

/** The phone messages that are spoken: the CEO's (not a silent one, #282), and the office's own notes when the manager asked for them. */
export function speaks(m: PhoneMessage, s: VoiceSettings): boolean {
  return (m.from === 'ceo' && !m.silent) || (m.from === 'office' && s.speakOffice);
}

/** One clip to make: the voice, the model, the speed (0.7–1.2) and the words. */
export interface SynthRequest {
  voiceId: string;
  model: string;
  speed: number;
  text: string;
}

/**
 * How every clip is voiced (POST /v1/text-to-speech's voice_settings, elevenlabs.io/docs/api-reference/text-to-speech):
 * a little livelier than ElevenLabs' defaults (stability 0.5, similarity 0.75, style 0) for a colleague on the phone,
 * with speaker boost for clarity. Stability stays 0.5, a value the v3 models accept too.
 */
const VOICE_TUNING = { stability: 0.5, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true } as const;

type SynthBody = { text: string; model_id: string; voice_settings: typeof VOICE_TUNING & { speed: number } };

/**
 * POST /v1/text-to-speech's body, the speed in voice_settings ("available for all voices and all models", ElevenLabs'
 * help centre; its Eleven v4 page says v4 has no Speed slider, so a v4 voice may keep its own pace).
 */
export function synthBody({ model, speed, text }: SynthRequest): SynthBody {
  return { text, model_id: model, voice_settings: { ...VOICE_TUNING, speed: clampSpeed(speed) } };
}

/** A clip's cache name: the voice, model, voice settings and words, so a change to any of them never plays stale audio. */
export function clipHash(req: SynthRequest): string {
  const { model_id, voice_settings, text } = synthBody(req);
  return crypto.createHash('sha256').update(`${req.voiceId}\n${model_id}\n${JSON.stringify(voice_settings)}\n${text}`).digest('hex').slice(0, 12);
}

/** A clip's file in the cache: what it's for, then clipHash. */
export const clipName = (name: string, req: SynthRequest) => `${name}-${clipHash(req)}.mp3`;

/**
 * A clicked agent's line (#321) as a clip to make: in their voice (else the office voice), at the office's model and
 * speed, its audio tags kept only for a v4 model. Lines repeat, so most clicks find the clip already cached.
 */
export function lineRequest(s: Pick<VoiceSettings, 'voiceId' | 'model' | 'speed'>, voiceId: string, line: string): SynthRequest {
  return { voiceId: voiceId && VOICE_ID.test(voiceId) ? voiceId : s.voiceId, model: s.model, speed: s.speed, text: spokenLine(line, s.model) };
}

// ---------- characters used ----------

/** Characters sent to ElevenLabs on one day (usage.json), for Settings → Voice. */
export interface CharUsage {
  day: string;
  chars: number;
}

/** The local date of `ms`, "2026-11-09". */
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** `u` with `n` more characters on `day` (a new day starts from zero). */
export const addChars = (u: CharUsage, day: string, n: number): CharUsage => ({ day, chars: (u.day === day ? u.chars : 0) + n });

/** The characters used on `day`. */
export const charsOn = (u: CharUsage, day: string) => (u.day === day ? u.chars : 0);

/** usage.json as read from disk; anything malformed is no usage. */
export function parseUsage(raw: unknown): CharUsage {
  const { day, chars } = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof CharUsage, unknown>>;
  return typeof day === 'string' && typeof chars === 'number' && Number.isFinite(chars) && chars >= 0 ? { day, chars } : { day: '', chars: 0 };
}

/** An ElevenLabs call that failed; status 0 when it never answered. */
export class VoiceApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** ElevenLabs (server/elevenlabs.ts), or demo.ts's fake. */
export interface VoiceApi {
  checkKey(key: string): Promise<void>;
  listVoices(key: string): Promise<Omit<VoiceOption, 'recommended'>[]>;
  synthesize(key: string, req: SynthRequest, signal: AbortSignal): Promise<Buffer>;
  /** Speech to Text: the words in `audio` (a clipType() type). */
  transcribe(key: string, req: { audio: Buffer; type: string }, signal: AbortSignal): Promise<string>;
  /** ElevenLabs Agents (#534): the office's agent and its LLM secret, made or brought up to date with `config`. */
  ensureAgent(key: string, config: AgentConfig, have: AgentIds | null, llmToken: string): Promise<AgentIds>;
  /** A short-lived signed URL for one conversation with the agent (the key never reaches the browser). */
  agentUrl(key: string, agentId: string): Promise<string>;
}

export interface VoiceKeyView {
  voiceKeySet: boolean;
  voiceKeyHint: string;
}

export interface VoiceDeps {
  api: VoiceApi;
  secretsFile: string;
  cacheDir: string;
  settings(): VoiceSettings;
  listen(): ListenSettings;
  /** The phone messages the office still has, oldest first. */
  messages(): readonly PhoneMessage[];
  /** Posts an office message on the manager's phone. */
  officeNote(text: string): void;
  keyChanged(view: VoiceKeyView): void;
  cacheChanged(view: VoiceCacheView): void;
  /** Server log lines (a new clip made, a clip transcribed), never the key or what was said. */
  log?(line: string): void;
  now?(): number;
}

interface Secrets {
  elevenlabsKey?: string;
  elevenlabsKeyRejected?: boolean;
}

export class Voice {
  private key = '';
  private rejected = false; // ElevenLabs said 401: no more calls until the key changes
  private voicesCache: { at: number; list: VoiceOption[] } | null = null;
  private making = new Map<string, Promise<Buffer>>();
  private queue: Promise<unknown> = Promise.resolve();
  private clips: ClipManifest = {};
  private cacheView: VoiceCacheView = { clips: 0, bytes: 0, saved: [], charsToday: 0 };
  private usage: CharUsage = { day: '', chars: 0 };
  private cacheWork: Promise<unknown> = Promise.resolve(); // manifest changes, prunes and clears, one after another
  private talkLines = new Map<number, string>(); // the latest lines the CEO said while working (#286), for their clips

  constructor(private deps: VoiceDeps) {}

  async init() {
    const s = await this.readSecrets();
    this.key = typeof s.elevenlabsKey === 'string' ? s.elevenlabsKey : '';
    this.rejected = !!this.key && s.elevenlabsKeyRejected === true;
    const raw = await fs.readFile(this.manifestFile(), 'utf8').catch(() => '');
    try {
      this.clips = parseManifest(raw ? JSON.parse(raw) : {});
    } catch {
      this.clips = {};
    }
    const usage = await fs.readFile(path.join(this.deps.cacheDir, USAGE), 'utf8').catch(() => '');
    try {
      this.usage = parseUsage(usage ? JSON.parse(usage) : null);
    } catch {
      this.usage = { day: '', chars: 0 };
    }
    await this.prune();
  }

  /** The snapshot's voiceCache: the clips on disk and the messages they replay. */
  cacheInfo(): VoiceCacheView {
    return this.cacheView;
  }

  keyView(): VoiceKeyView {
    return { voiceKeySet: !!this.key, voiceKeyHint: this.key.slice(-4) };
  }

  /** The key itself, only so the journal can scrub it out of anything it writes ('' when none). */
  secret(): string {
    return this.key;
  }

  /** PUT /api/voice/key: '' removes the key; anything else must pass one cheap ElevenLabs call first. */
  async setKey(raw: string): Promise<VoiceKeyView> {
    const key = raw.trim();
    if (key) {
      if (key.length > 200 || /\s/.test(key)) throw new HttpError(400, "That doesn't look like an ElevenLabs API key.");
      const wrong = secretMismatch('elevenlabs', key);
      if (wrong) throw new HttpError(400, wrong);
      try {
        await this.deps.api.checkKey(key);
      } catch (err) {
        if (err instanceof VoiceApiError && err.status === 401) throw new HttpError(400, 'ElevenLabs rejected that key. Copy it again from elevenlabs.io → Developers → API Keys.');
        if (err instanceof VoiceApiError && err.status === 403) throw new HttpError(400, 'That key may not read voices. Give it the Voices (read) and Text to Speech permissions on elevenlabs.io.');
        throw new HttpError(502, `Couldn't check the key with ElevenLabs: ${(err as Error).message}`);
      }
    }
    this.key = key;
    this.rejected = false;
    this.voicesCache = null;
    await this.writeSecrets({ elevenlabsKey: key || undefined, elevenlabsKeyRejected: undefined });
    const view = this.keyView();
    this.deps.keyChanged(view);
    return view;
  }

  /** GET /api/voice/voices: the account's voices plus the shortlist, shortlist first. Cached for 10 minutes. */
  async voices(): Promise<VoiceOption[]> {
    this.requireKey();
    const now = this.now();
    if (this.voicesCache && now - this.voicesCache.at < VOICES_TTL_MS) return this.voicesCache.list;
    const key = this.key;
    const mine = await this.deps.api.listVoices(key).catch((err) => this.failed(err, key, 'list the voices'));
    const recommended = new Map(RECOMMENDED_VOICES.map((v) => [v.id, v]));
    const list: VoiceOption[] = [
      ...RECOMMENDED_VOICES.map((r) => {
        const own = mine.find((v) => v.id === r.id);
        return own ? { ...own, labels: fill(own.labels, r.labels), recommended: true } : r;
      }),
      ...mine.filter((v) => !recommended.has(v.id)).map((v) => ({ ...v, recommended: false })).sort((a, b) => Number(!!b.v4) - Number(!!a.v4) || a.name.localeCompare(b.name)),
    ];
    if (this.key === key) this.voicesCache = { at: now, list };
    return list;
  }

  /**
   * A voice for a new agent (or Shuffle's next one), distinct on their floor where it can be: only while ElevenLabs
   * speaks and a key works; null otherwise or when the list can't be had.
   */
  async pickFor(seed: string, used: string[], not = ''): Promise<{ voiceId: string; voiceName: string } | null> {
    const s = this.deps.settings();
    if (s.provider !== 'elevenlabs' || !this.key || this.rejected) return null;
    const list = await this.voices().catch(() => [] as VoiceOption[]);
    const id = pickVoice(voicePool(list, s.favourites), used, seed, not);
    return id ? { voiceId: id, voiceName: list.find((v) => v.id === id)?.name ?? '' } : null;
  }

  /**
   * GET /api/voice/messages/:id: a phone message's spoken summary as mp3, made once and cached. `whole` (?whole=1, the
   * ⋯ menu's "Read the whole message"): its whole text, cached by its words but never the clip the ▶ replays.
   * `tapped` (?tap=1, #532): the manager asked for it, so any CEO message is made, also with the voice off.
   */
  messageAudio(id: number, whole = false, tapped = false): Promise<Buffer> {
    return this.logged(`message ${id}`, () => this.makeMessageAudio(id, whole, tapped));
  }

  private async makeMessageAudio(id: number, whole: boolean, tapped: boolean): Promise<Buffer> {
    const s = this.deps.settings();
    if (s.provider !== 'elevenlabs' && !(tapped && s.provider === 'off')) throw new HttpError(404, "Messages aren't read by ElevenLabs right now.");
    const m = this.message(id);
    if (!m || !(speaks(m, s) || (tapped && m.from === 'ceo'))) throw new HttpError(404, `No spoken message ${id}`);
    if (whole) {
      const all = messageSpeech(m, { whole: true });
      if (!all) throw new HttpError(404, `Message ${id} has nothing to say aloud`);
      return this.audio(`${m.id}-whole`, { voiceId: s.voiceId, model: s.model, speed: s.speed, text: all });
    }
    const saved = clipsFor(this.clips, m);
    const first = saved && (await fs.readFile(path.join(this.deps.cacheDir, saved[0])).catch(() => null));
    if (first) return first; // made before, perhaps in another voice: a message keeps the clip it was first read with
    const text = messageSpeech(m);
    if (!text) throw new HttpError(404, `Message ${id} has nothing to say aloud`);
    return this.audio(String(m.id), { voiceId: s.voiceId, model: s.model, speed: s.speed, text }, m);
  }

  /**
   * GET /api/voice/messages/:id?cached=1&part=N: the phone's ▶. Only clips already on disk, never ElevenLabs: a 404
   * means there's nothing saved to replay. `parts` is how many clips the message has, played in order.
   */
  async cachedAudio(id: number, part = 0): Promise<{ audio: Buffer; parts: number }> {
    const m = this.message(id);
    const files = m && clipsFor(this.clips, m);
    const file = files?.[part];
    const audio = file && (await fs.readFile(path.join(this.deps.cacheDir, file)).catch(() => null));
    if (!files || !audio) throw new HttpError(404, `Audio for message ${id} is no longer saved.`);
    return { audio, parts: files.length };
  }

  /** DELETE /api/voice/cache: Settings → Voice's "Clear saved clips". */
  clearCache(): Promise<VoiceCacheView> {
    return this.cacheOp(async () => {
      const names = await fs.readdir(this.deps.cacheDir).catch(() => [] as string[]);
      for (const name of names.filter((n) => n.endsWith('.mp3'))) await fs.rm(path.join(this.deps.cacheDir, name), { force: true, maxRetries: 3 });
      this.clips = {};
      await this.saveManifest();
      return this.measure([]);
    });
  }

  /**
   * Deletes clips older than the voice settings' keepDays, then the oldest beyond 200, never the newest 20 CEO
   * messages' clips. Runs at start, on the office's housekeeping timer and after every new clip; never throws.
   */
  prune(): Promise<VoiceCacheView> {
    return this.cacheOp(async () => {
      const dir = this.deps.cacheDir;
      const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.mp3'));
      const stats = await Promise.all(names.map(async (name) => ({ name, st: await fs.stat(path.join(dir, name)).catch(() => null) })));
      const files = stats.flatMap(({ name, st }) => (st ? [{ name, mtimeMs: st.mtimeMs, size: st.size }] : []));
      const keep = newestClips(this.clips, this.deps.messages());
      const gone = new Set(cacheToPrune(files, this.now(), CACHE_MAX_FILES, this.deps.settings().keepDays * DAY_MS, keep));
      for (const name of [...gone]) await fs.rm(path.join(dir, name), { force: true, maxRetries: 3 }).catch(() => gone.delete(name));
      const left = files.filter((f) => !gone.has(f.name));
      const clips = withoutMissing(this.clips, new Set(left.map((f) => f.name)));
      if (Object.keys(clips).length !== Object.keys(this.clips).length) {
        this.clips = clips;
        await this.saveManifest();
      }
      return this.measure(left);
    }).catch(() => this.cacheView);
  }

  /**
   * POST /api/voice/transcribe: the manager's recorded speech (`ms` long, by the browser's clock) as text, by
   * ElevenLabs Speech to Text. Only while ElevenLabs is the 🎙's provider, and at most 60 s / 5 MB a clip.
   */
  transcribe(audio: Buffer, contentType: string | undefined, ms: number): Promise<string> {
    return this.logged('speech to text', () => this.makeTranscript(audio, contentType, ms), "couldn't turn speech into text");
  }

  private async makeTranscript(audio: Buffer, contentType: string | undefined, ms: number): Promise<string> {
    if (this.deps.listen().provider !== 'elevenlabs') throw new HttpError(409, "ElevenLabs isn't turning speech into text: pick it under Settings → Voice → Talk instead of type.");
    const bad = clipProblem({ bytes: audio.length, ms, type: contentType });
    if (bad) throw new HttpError(bad.status, bad.message);
    if (!this.key) throw new HttpError(409, 'Add your ElevenLabs API key in Settings → Voice to talk instead of type, or pick the browser there.');
    this.requireKey();
    const key = this.key;
    const text = await this.deps.api.transcribe(key, { audio, type: clipType(contentType) }, AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS)).catch((err) => {
      if (err instanceof VoiceApiError && err.status === 403) throw new HttpError(502, 'Your ElevenLabs key may not use Speech to Text: allow it for the key on elevenlabs.io (Developers → API Keys).');
      return this.failed(err, key, 'turn your speech into text');
    });
    const secs = Number.isFinite(ms) ? ` ${(ms / 1000).toFixed(1)} s` : '';
    this.deps.log?.(`voice: transcribed a${secs} clip (${Math.ceil(audio.length / 1024)} KB)`);
    return text.trim();
  }

  /** GET /api/voice/sample: the settings' Test button, in `voiceId` (default: the chosen voice). */
  sampleAudio(voiceId?: string): Promise<Buffer> {
    const s = this.deps.settings();
    return this.logged('the Test line', () => this.audio('sample', { voiceId: voiceId || s.voiceId, model: s.model, speed: s.speed, text: SAMPLE_LINE }));
  }

  /** GET /api/voice/standup: the CEO's line at a stand-up in the 3D office, made once per wording and cached. */
  standupAudio(count: number, part: DayPart): Promise<Buffer> {
    return this.logged('the stand-up line', async () => {
      const s = this.deps.settings();
      if (s.provider !== 'elevenlabs') throw new HttpError(404, "The CEO isn't voiced by ElevenLabs right now.");
      return this.audio('standup', { voiceId: s.voiceId, model: s.model, speed: s.speed, text: standupLine(count, part) });
    });
  }

  /** A line the CEO says while it works (#286, shared/voiceTalk.ts): kept for GET /api/voice/talk/:id. */
  rememberTalk(id: number, text: string) {
    this.talkLines.set(id, text);
    if (this.talkLines.size > LINES_KEPT) this.talkLines.delete(this.talkLines.keys().next().value!);
  }

  /** A line the CEO said while working, for the Jarvis voice to say on a call (#534). */
  talkLine(id: number): string | undefined {
    return this.talkLines.get(id);
  }

  /** GET /api/voice/talk/:id: an ack or progress line as mp3, cached by its words (so each fixed ack is made once). */
  talkAudio(id: number): Promise<Buffer> {
    return this.logged(`spoken line ${id}`, async () => {
      const s = this.deps.settings();
      if (s.provider !== 'elevenlabs') throw new HttpError(404, "The CEO isn't voiced by ElevenLabs right now.");
      const text = this.talkLines.get(id);
      if (!text) throw new HttpError(404, `No spoken line ${id}`);
      return this.audio('talk', { voiceId: s.voiceId, model: s.model, speed: s.speed, text });
    });
  }

  /** Clicked agents' lines are spoken by ElevenLabs now: it's the provider, the setting is on and a key works. */
  speaksLines(): boolean {
    const s = this.deps.settings();
    return s.provider === 'elevenlabs' && s.agentsSpeak && !!this.key && !this.rejected;
  }

  /** GET /api/voice/lines/:agent: a clicked agent's line (lineRequest), cached by voice, model, speed and words. */
  lineAudio(voiceId: string, line: string): Promise<Buffer> {
    return this.logged("an agent's line", async () => {
      if (!this.speaksLines()) throw new HttpError(404, "Agents aren't voiced by ElevenLabs right now.");
      return this.audio('line', lineRequest(this.deps.settings(), voiceId, line));
    });
  }

  /**
   * Every failed clip or transcription in the server log, with the plain words the client gets (#545): a voice that
   * goes quiet always leaves a line saying why. Never the key or what was said.
   */
  private async logged<T>(what: string, make: () => Promise<T>, failed = "couldn't make clip"): Promise<T> {
    try {
      return await make();
    } catch (err) {
      this.deps.log?.(`voice: ${failed} (${what}): ${(err as Error).message}`);
      throw err;
    }
  }

  private async audio(name: string, req: SynthRequest, m?: PhoneMessage): Promise<Buffer> {
    if (!VOICE_ID.test(req.voiceId)) throw new HttpError(400, 'Pick an ElevenLabs voice first.');
    // The voice, model, speed and words are in the file name, so a change or a reused message id never plays stale audio.
    const file = path.join(this.deps.cacheDir, clipName(name, req));
    const cached = await fs.readFile(file).catch(() => null);
    if (cached) {
      if (m) await this.record(m, [path.basename(file)]);
      return cached;
    }
    this.requireKey();
    const busy = this.making.get(file);
    if (busy) return busy;
    const made = this.oneAtATime(() => this.synthesize(file, req, m)).finally(() => this.making.delete(file));
    this.making.set(file, made);
    return made;
  }

  private oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async synthesize(file: string, req: SynthRequest, m?: PhoneMessage): Promise<Buffer> {
    this.requireKey(); // the key may have been rejected or removed while this waited its turn
    const key = this.key;
    const audio = await this.deps.api.synthesize(key, req, AbortSignal.timeout(SYNTH_TIMEOUT_MS)).catch((err) => this.failed(err, key, 'speak the message'));
    await fs.mkdir(this.deps.cacheDir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, audio);
    await fs.rename(tmp, file);
    await this.used(req.text.length);
    this.deps.log?.(`voice: made a new clip ${path.basename(file)} (${req.text.length} characters)`);
    if (m) await this.record(m, [path.basename(file)]);
    else await this.prune();
    return audio;
  }

  /** An ElevenLabs failure as a short 502. A 401 also stops every call until the key changes, and says so once. */
  private async failed(err: unknown, key: string, what: string): Promise<never> {
    if (err instanceof VoiceApiError && err.status === 401 && key === this.key && !this.rejected) {
      this.rejected = true;
      this.deps.officeNote(KEY_REJECTED_NOTE);
      await this.writeSecrets({ elevenlabsKeyRejected: true }).catch(() => undefined);
    }
    if (err instanceof VoiceApiError && err.status === 401) throw new HttpError(502, 'ElevenLabs rejected the key.');
    throw new HttpError(502, `ElevenLabs couldn't ${what}: ${(err as Error).message}`.slice(0, 240));
  }

  private requireKey() {
    if (!this.key) throw new HttpError(409, 'Add an ElevenLabs API key first.');
    if (this.rejected) throw new HttpError(502, 'ElevenLabs rejected the key. Set a new one in the voice settings.');
  }

  /** Counts `chars` more sent to ElevenLabs today (saved, so a restart keeps the day's count; re-measured on the next prune). */
  private async used(chars: number) {
    this.usage = addChars(this.usage, localDay(this.now()), chars);
    const file = path.join(this.deps.cacheDir, USAGE);
    await fs.writeFile(`${file}.${process.pid}.tmp`, JSON.stringify(this.usage)).then(() => fs.rename(`${file}.${process.pid}.tmp`, file)).catch(() => undefined);
  }

  // ---------- the clip manifest ----------

  private message(id: number) {
    return this.deps.messages().find((m) => m.id === id);
  }

  private cacheOp<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.cacheWork.then(fn, fn);
    this.cacheWork = run.catch(() => undefined);
    return run;
  }

  /** Records `files` as message `m`'s clips, then prunes and re-measures (the phone's ▶ follows `saved`). */
  private async record(m: PhoneMessage, files: string[]) {
    await this.cacheOp(async () => {
      this.clips = withClips(this.clips, m, files);
      await this.saveManifest();
    }).catch(() => undefined);
    await this.prune();
  }

  private manifestFile() {
    return path.join(this.deps.cacheDir, MANIFEST);
  }

  private async saveManifest() {
    await fs.mkdir(this.deps.cacheDir, { recursive: true });
    const tmp = `${this.manifestFile()}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.clips));
    await fs.rename(tmp, this.manifestFile());
  }

  /** The cache view for `files` (what's on disk), told to the clients when it changed. */
  private measure(files: { size: number }[]): VoiceCacheView {
    const view: VoiceCacheView = { clips: files.length, bytes: files.reduce((n, f) => n + f.size, 0), saved: savedMessages(this.clips, this.deps.messages()), charsToday: charsOn(this.usage, localDay(this.now())) };
    if (JSON.stringify(view) !== JSON.stringify(this.cacheView)) {
      this.cacheView = view;
      this.deps.cacheChanged(view);
    }
    return view;
  }

  private now() {
    return this.deps.now?.() ?? Date.now();
  }

  private async readSecrets(): Promise<Secrets & Record<string, unknown>> {
    return readSecrets(this.deps.secretsFile);
  }

  /** Merge into the secrets file (other secrets stay), owner-only where the OS has file modes. */
  private writeSecrets(patch: Secrets): Promise<void> {
    return mergeSecrets(this.deps.secretsFile, { ...patch });
  }
}

/** The account's labels, with the shortlist's description where ElevenLabs has none. */
function fill(own: Labels, ours: Labels): Labels {
  return { ...own, description: own.description || ours.description };
}
