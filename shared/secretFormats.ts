// What each pasted key or token looks like (#264): a password manager can fill one secret into every field, so a key
// that matches another field's format is refused there and never saved into the wrong place. Pure, for both sides.

export type SecretKind = 'anthropic' | 'openai' | 'github' | 'upstash' | 'elevenlabs' | 'telegram';

/** What the manager calls each one, for "This looks like your X, not a Y". */
const NAMES: Record<SecretKind, { yours: string; noun: string }> = {
  anthropic: { yours: 'Anthropic key', noun: 'an Anthropic API key' },
  openai: { yours: 'OpenAI key', noun: 'an OpenAI API key' },
  github: { yours: 'GitHub token', noun: 'a GitHub token' },
  upstash: { yours: 'Upstash key', noun: 'an Upstash Box API key' },
  elevenlabs: { yours: 'ElevenLabs key', noun: 'an ElevenLabs API key' },
  telegram: { yours: 'Telegram bot token', noun: 'a Telegram bot token' },
};

/** Formats that are recognisable on sight, most specific first (sk-ant- before sk-). Upstash's has no fixed shape. */
const SHAPES: [SecretKind, RegExp][] = [
  ['anthropic', /^sk-ant-/],
  ['openai', /^sk-/],
  ['github', /^(github_pat_|gh[pousr]_)/],
  ['elevenlabs', /^sk_[0-9a-f]{32,}$/i],
  ['telegram', /^\d{4,15}:[\w-]{30,60}$/],
];

/** Fields whose secret must have its own format, and what to say when it doesn't. */
const REQUIRED: Partial<Record<SecretKind, string>> = {
  anthropic: 'Anthropic API keys start with sk-ant-.',
  openai: 'OpenAI API keys start with sk-.',
  github: 'GitHub tokens start with github_pat_ or ghp_.',
};

/** The kind of secret a value looks like, or null when it could be anything. */
export function detectSecret(raw: string): SecretKind | null {
  const v = raw.trim();
  return SHAPES.find(([, re]) => re.test(v))?.[0] ?? null;
}

/** Why `raw` can't go in the `field` field, or null when it can ('' always can: it removes the saved one). */
export function secretMismatch(field: SecretKind, raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const looks = detectSecret(v);
  if (looks && looks !== field) return `This looks like your ${NAMES[looks].yours}, not ${NAMES[field].noun}.`;
  if (!looks && REQUIRED[field]) return REQUIRED[field];
  return null;
}
