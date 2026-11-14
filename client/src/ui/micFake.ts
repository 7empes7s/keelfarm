// The browser's SpeechRecognition as mic.ts uses it, and a stand-in for it (headless browsers and tests have no mic),
// driven by window.__swarmMic.
interface RecognitionResultLike {
  isFinal: boolean;
  0?: { transcript: string; confidence?: number };
}
export interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((e: { results: ArrayLike<RecognitionResultLike> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  /** `track`: a mic to listen to (Chrome's MediaStreamTrack recognition); others ignore it. */
  start(track?: MediaStreamTrack): void;
  stop(): void;
  abort(): void;
}
export type RecognitionClass = new () => Recognition;

/** The fake recognition listening now. */
export const fakeLive: { now: FakeRecognition | null } = { now: null };
/** A stand-in for the browser's recognition: __swarmMic.say() is what it hears. */
export class FakeRecognition implements Recognition {
  lang = '';
  continuous = false;
  interimResults = false;
  onstart: Recognition['onstart'] = null;
  onresult: Recognition['onresult'] = null;
  onerror: Recognition['onerror'] = null;
  onend: Recognition['onend'] = null;
  phrases: RecognitionResultLike[] = [];
  start() {
    fakeLive.now = this;
    setTimeout(() => this.onstart?.(), 30);
  }
  stop() {
    this.end();
  }
  abort() {
    this.end();
  }
  private end() {
    if (fakeLive.now !== this) return;
    fakeLive.now = null;
    setTimeout(() => this.onend?.(), 30);
  }
  /** The browser ends recognition by itself, as mobile browsers do after a short quiet, or on `error`. */
  ends(error?: string) {
    if (error) this.onerror?.({ error });
    this.end();
  }
  say(text: string, final: boolean) {
    this.phrases = [...this.phrases.filter((p) => p.isFinal), { isFinal: final, 0: { transcript: text } }];
    this.onresult?.({ results: this.phrases });
  }
}
