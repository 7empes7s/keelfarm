// IT manages keys end to end (#609), pure: the service env files a Providers key may be installed into (the ONLY write
// path to a credential file; the IT desk refuses every other), the one line set in such a file, the card's line (the
// key's last 4 characters, never its value), a key the manager pasted in chat masked out of the stored history, and
// when a key the office made renews itself and what each provider's API allows.

/** A service env file the office may set a key in, and the unit restarted after (on the same Approve). */
export interface InstallTarget {
  file: string;
  unit?: string;
  name: string;
}

/** The allow-list. Postiz runs under docker compose in /opt/postiz, which reads its .env there. */
export const INSTALL_TARGETS: readonly InstallTarget[] = [
  { file: '/etc/clipfarm/clipfarm.env', unit: 'clipfarm.service', name: 'clipfarm' },
  { file: '/opt/postiz/.env', unit: 'postiz.service', name: 'Postiz' },
];

/**
 * An app the office sets a key in through its own Settings API (#622), over a Cloudflare Access service token: each
 * variable's settings group, and the token's env file (what access_service_token_ensure writes for `access` by default).
 */
export interface AppTarget {
  id: string;
  name: string;
  url: string;
  groups: Record<string, string>;
  access: string;
}

export const APP_TARGETS: readonly AppTarget[] = [
  {
    id: 'clipfarm app',
    name: 'clipfarm',
    url: 'https://clip.techinsiderbytes.com',
    groups: { OPENAI_API_KEY: 'openai', TWITCH_CLIENT_ID: 'twitch', TWITCH_CLIENT_SECRET: 'twitch', YOUTUBE_API_KEY: 'youtube', POSTIZ_API_KEY: 'postiz', UPLOAD_POST_API_KEY: 'upload-post' },
    access: 'clipfarm',
  },
];

export const appTarget = (id: string) => APP_TARGETS.find((t) => t.id === id);

/** Why setting this variable in that app is refused, or null. */
export function appInstallRefusal(t: AppTarget, varName: string): string | null {
  return t.groups[varName] ? null : `${t.name}'s Settings have no ${varName} (it takes ${Object.keys(t.groups).join(', ')}).`;
}

/** One key installed into a target, kept on its Providers connection (no value): renewals install into the same. */
export interface KeyInstall {
  file: string;
  var: string;
  unit?: string;
  part?: KeyPart;
  /** An app install's value's last 4 characters: the same key again changes nothing. */
  hint?: string;
}

/** Which half of a paired key ("client id:secret", Twitch's and Kling's): the whole value when absent. */
export type KeyPart = 'id' | 'secret';

const VAR = /^[A-Z_][A-Z0-9_]{0,63}$/;

/** Why this install is refused, or null. `targets` is the allow-list (the demo's points into its own home). */
export function installRefusal(file: string, varName: string, targets: readonly InstallTarget[] = INSTALL_TARGETS): string | null {
  if (!VAR.test(varName)) return `"${varName}" isn't an environment variable name like OPENAI_API_KEY.`;
  if (!targets.some((t) => t.file === file)) return `${file} isn't on the list of service env files the office installs keys into (${targets.map((t) => t.file).join(', ')}). The IT desk never writes other credential files.`;
  return null;
}

/** The value for a part: "id:secret" split at its first colon. Null when the key isn't a pair. */
export function keyPart(value: string, part?: KeyPart): string | null {
  if (!part) return value;
  const i = value.indexOf(':');
  if (i <= 0 || i === value.length - 1) return null;
  return part === 'id' ? value.slice(0, i) : value.slice(i + 1);
}

/** The env file with `name=value` set (replaced where it is, else appended), every other line kept as it was. */
export function envWithVar(text: string, name: string, value: string): string {
  const re = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`);
  const lines = text ? text.replace(/\r?\n$/, '').split(/\r?\n/) : [];
  let done = false;
  const out = lines.flatMap((l) => {
    if (!re.test(l)) return [l];
    if (done) return []; // a second copy would win in some readers: one line only
    done = true;
    return [`${name}=${value}`];
  });
  if (!done) out.push(`${name}=${value}`);
  return `${out.join('\n')}\n`;
}

/** The card's, log's and tool's line: `OPENAI_API_KEY → /etc/clipfarm/clipfarm.env (ends …ab12)`. */
export const installLine = (varName: string, file: string, hint: string) => `${varName} → ${file}${hint ? ` (ends …${hint})` : ''}`;

/** What a pasted key is replaced with in the chat's stored history. */
export const savedMark = (label: string) => `•••• (saved to Providers as ${label})`;

/** The parts of a value worth masking: the whole, and each half of a pair (the manager may paste them apart). */
function pastedParts(value: string): string[] {
  const parts = [value, ...(value.includes(':') ? value.split(':') : [])].map((p) => p.trim()).filter((p) => p.length >= 8);
  return [...new Set(parts)].sort((a, b) => b.length - a.length);
}

/** A message's text with every part of the value masked; null when it had none. */
export function maskPasted(text: string, value: string, label: string): string | null {
  let out = text;
  for (const p of pastedParts(value)) out = out.split(p).join(savedMark(label));
  return out === text ? null : out;
}

// ---------- renewing (#609) ----------

/** A key the office made: renewed this long before it runs out. */
export const RENEW_DAYS = 7;
const DAY = 86_400_000;

/** Whether a made key is due: within RENEW_DAYS of its expiry (or past it). */
export const renewDue = (expiresAt: number | undefined, now: number) => !!expiresAt && expiresAt - now <= RENEW_DAYS * DAY;

/** What the office can do about a provider's keys, said plainly on its card. */
export const RENEW_NOTE: Record<string, string> = {
  cloudflare: `The office makes narrow tokens with only the permissions a use needs (provider_action token_create) and renews them ${RENEW_DAYS} days before they expire.`,
  github: "GitHub's API can't make or renew personal tokens: the office checks this one's permissions, a new one is made on github.com.",
  openai: "The office can't make OpenAI project keys yet: it installs and checks this one.",
  upstash: "Upstash's API can't make per-database tokens for the office: it uses this key as it is.",
  twitch: "Twitch's API can't renew a client secret: it's reset on dev.twitch.tv, then sent to the office.",
  elevenlabs: "ElevenLabs' API can't make or renew keys.",
  youtube: "Google's API can't renew an API key: it doesn't expire unless it's deleted.",
  postiz: "Postiz's API can't renew its key.",
};

/** The card's expiry line: in how many days, and whether the office renews it. */
export function expiryLine(expiresAt: number, now: number, renews: boolean): string {
  const days = Math.ceil((expiresAt - now) / DAY);
  const when = days <= 0 ? 'Expired' : days === 1 ? 'Expires tomorrow' : `Expires in ${days} days`;
  return `${when}${renews ? ` · renews itself ${RENEW_DAYS} days before` : ''}`;
}
