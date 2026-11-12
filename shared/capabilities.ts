// Providers by what they do (#533), pure: the capabilities the office asks for (text, image, video, audio,
// operations, publishing), which catalogue entries cover each (one provider under every capability it covers), each
// capability's default and fallback from the page's cards, the route a request takes (the default, else the fallback
// when the default is limited or down), and the CEO's line. Floors and the CEO ask for a capability, never a provider.
import { PROVIDERS, providerDef, type ProviderCard } from './providers.ts';
import { grantedCaps, oauthDef } from './oauth.ts';
import type { Capability, CapabilityChoice, ProviderCategory, ProviderConnection } from './types.ts';

export const CAPABILITIES: { id: Capability; label: string; blurb: string }[] = [
  { id: 'text', label: 'Text', blurb: 'Language models for writing, summaries and research' },
  { id: 'image', label: 'Image', blurb: 'Making and editing pictures' },
  { id: 'video', label: 'Video', blurb: 'Making video clips' },
  { id: 'audio', label: 'Audio', blurb: 'Voices, transcription, music and sound effects' },
  { id: 'operations', label: 'Operations', blurb: 'DNS, tunnels, hosting, GitHub, cloud machines' },
  { id: 'publishing', label: 'Publishing', blurb: 'YouTube, TikTok and Instagram posts' },
];

/**
 * What each catalogue entry's key covers. Company sign-ins (Google, Meta, TikTok, Microsoft) cover what their granted
 * scopes unlock instead (shared/oauth.ts); coding agents' accounts run agents, not requests.
 */
export const PROVIDER_CAPS: Record<string, Capability[]> = {
  claude: [],
  codex: [],
  opencode: [],
  'gemini-cli': [],
  anthropic: ['text'],
  openai: ['text', 'image', 'audio'],
  gemini: ['text', 'image', 'video'],
  openrouter: ['text'],
  groq: ['text', 'audio'],
  cerebras: ['text'],
  nvidia: ['text'],
  aihubmix: ['text', 'image'],
  elevenlabs: ['audio', 'image', 'video'], // voice, music and SFX, and its Image & Video beta
  'openai-audio': ['audio'],
  'nano-banana': ['image'],
  'openai-images': ['image'],
  runway: ['video', 'image'],
  'gemini-video': ['video'],
  luma: ['video', 'image'],
  kling: ['video'],
  upstash: ['operations'],
  cloudflare: ['operations'],
  github: ['operations'],
  entra: ['operations'],
  hetzner: ['operations'],
  twitch: ['operations'],
  youtube: ['operations'],
  postiz: ['publishing'],
  'other-key': ['operations'],
  google: ['text', 'image', 'video', 'publishing'],
  meta: ['publishing'],
  tiktok: ['publishing'],
  microsoft: ['operations'],
};

/** The capabilities a catalogue entry can cover (a sign-in: with every scope granted). */
export const providerCaps = (provider: string): Capability[] => PROVIDER_CAPS[provider] ?? [];

/** What one card covers now: a sign-in by the scopes it was granted, an MCP server nothing. */
export function cardCaps(c: Pick<ProviderCard, 'provider' | 'category' | 'scopes'>): Capability[] {
  if (c.category === 'mcp' || c.category === 'coding') return [];
  return oauthDef(c.provider) ? grantedCaps(c.provider, c.scopes) : providerCaps(c.provider);
}

/** A card can take requests: not limited, signed out, failing, paused or off. */
const usable = (c: Pick<ProviderCard, 'status'>) => c.status === 'ready' || c.status === 'near' || c.status === 'untested';

export interface CapabilityRoute {
  capability: Capability;
  label: string;
  /** Every card covering it, the default first. */
  cards: ProviderCard[];
  primary: ProviderCard | null;
  fallback: ProviderCard | null;
  /** Where a request goes now: the default, the fallback when the default is limited or down, or nothing. */
  route: ProviderCard | null;
  /** "No video provider: add one", or why the route is the fallback. */
  gap: string | null;
}

const rank = (c: ProviderCard) => (usable(c) ? 0 : 1) * 1000 + Math.max(0, PROVIDERS.findIndex((p) => p.id === c.provider));

/** Each capability's cards, default, fallback and route. The manager's picks win when they still cover it. */
export function capabilityRoutes(cards: readonly ProviderCard[], defaults: Partial<Record<Capability, CapabilityChoice>> = {}): CapabilityRoute[] {
  return CAPABILITIES.map(({ id, label }) => {
    const covering = cards.filter((c) => c.status !== 'off' && cardCaps(c).includes(id));
    const pick = defaults[id] ?? {};
    const sorted = [...covering].sort((a, b) => rank(a) - rank(b));
    const primary = covering.find((c) => c.key === pick.primary) ?? sorted[0] ?? null;
    const rest = sorted.filter((c) => c !== primary);
    const fallback = rest.find((c) => c.key === pick.fallback) ?? rest[0] ?? null;
    const route = primary && usable(primary) ? primary : fallback && usable(fallback) ? fallback : null;
    const lower = label.toLowerCase();
    const gap = !primary
      ? `No ${lower} provider: add one`
      : !route
        ? `No working ${lower} provider: ${primary.label} is ${primary.status === 'limited' ? 'limited' : 'down'}${fallback ? `, and so is ${fallback.label}` : ', with no fallback'}`
        : route !== primary
          ? `${primary.label} is ${primary.status === 'limited' ? 'limited' : 'down'}: ${route.label} takes over`
          : null;
    return { capability: id, label, cards: primary ? [primary, ...rest] : [], primary, fallback, route, gap };
  });
}

/** Where a request for a capability goes now, or null (none connected, or none working). */
export const routeCapability = (capability: Capability, cards: readonly ProviderCard[], defaults?: Partial<Record<Capability, CapabilityChoice>>) =>
  capabilityRoutes(cards, defaults).find((r) => r.capability === capability)?.route ?? null;

/** The CEO's line: "Capabilities: Text → OpenAI API (fallback OpenRouter) · Video → none". */
export function capabilitiesLine(routes: readonly CapabilityRoute[]): string {
  return `Capabilities: ${routes
    .map((r) => `${r.label} → ${r.route ? `${r.route.label}${r.route !== r.primary ? ` (default ${r.primary!.label} limited)` : r.fallback ? ` (fallback ${r.fallback.label})` : ''}` : r.primary ? 'none working' : 'none'}`)
    .join(' · ')}`;
}

const MEDIA: Capability[] = ['text', 'image', 'video', 'audio'];

/** The setup advisor's provider kinds a saved connection gives a floor: its category, and a sign-in's unlocked media. */
export function connectionCategories(c: Pick<ProviderConnection, 'provider' | 'scopes'>): ProviderCategory[] {
  const def = providerDef(c.provider);
  if (!def) return [];
  const media = oauthDef(c.provider) ? grantedCaps(c.provider, c.scopes).filter((x) => MEDIA.includes(x)) : [];
  return [def.category, ...(media as ProviderCategory[])];
}
