import { describe, expect, it } from 'vitest';
import { CAPABILITIES, PROVIDER_CAPS, capabilitiesLine, connectionCategories, capabilityRoutes, cardCaps, routeCapability } from './capabilities.ts';
import { PROVIDERS, providerCards, type ProviderCard } from './providers.ts';
import { EMPTY_CLOUD } from './cloud.ts';
import type { ProviderConnection } from './types.ts';

const card = (key: string, provider: string, status: ProviderCard['status'] = 'ready', extra: Partial<ProviderCard> = {}): ProviderCard => ({
  key,
  provider,
  name: provider,
  label: key,
  category: PROVIDERS.find((p) => p.id === provider)?.category ?? 'text',
  status,
  note: '',
  plan: '',
  keyHint: '',
  uses: [],
  settings: null,
  check: 'live',
  ...extra,
});

describe('capabilities per catalogue entry (#533)', () => {
  it('maps every catalogue entry, and nothing that is not in it', () => {
    expect(Object.keys(PROVIDER_CAPS).sort()).toEqual(PROVIDERS.map((p) => p.id).sort());
    const ids = CAPABILITIES.map((c) => c.id);
    for (const caps of Object.values(PROVIDER_CAPS)) for (const c of caps) expect(ids).toContain(c);
  });

  it('shows one provider under every capability it covers', () => {
    expect(PROVIDER_CAPS.openai).toEqual(['text', 'image', 'audio']);
    expect(PROVIDER_CAPS.google).toEqual(['text', 'image', 'video', 'publishing']);
    expect(PROVIDER_CAPS.elevenlabs).toEqual(['audio', 'image', 'video']);
    expect(PROVIDER_CAPS.cloudflare).toEqual(['operations']);
    expect(PROVIDER_CAPS.claude).toEqual([]); // coding agents run agents, not requests
  });

  it("covers a sign-in's capabilities by the scopes it was granted", () => {
    expect(cardCaps(card('g', 'google', 'ready', { scopes: ['openid', 'email', 'https://www.googleapis.com/auth/youtube.upload'] }))).toEqual(['publishing']);
    expect(cardCaps(card('g', 'google'))).toEqual(['text', 'image', 'video', 'publishing']); // the answer named no scopes
    expect(cardCaps(card('m', 'mcp', 'ready', { category: 'mcp' }))).toEqual([]);
  });

  it("gives the setup advisor a sign-in's media, so a Google sign-in meets a floor's video need", () => {
    expect(connectionCategories({ provider: 'google' })).toEqual(['signin', 'text', 'image', 'video']);
    expect(connectionCategories({ provider: 'meta' })).toEqual(['signin']);
    expect(connectionCategories({ provider: 'runway' })).toEqual(['video']);
    expect(connectionCategories({ provider: 'gone' })).toEqual([]);
  });
});

describe('default and fallback routing (#533)', () => {
  const openai = card('connection:oa', 'openai');
  const router = card('connection:or', 'openrouter');
  const voice = card('voice', 'elevenlabs', 'ready', { category: 'audio' });

  it('picks a working default and fallback, and says what is missing', () => {
    const routes = capabilityRoutes([openai, router, voice]);
    const text = routes.find((r) => r.capability === 'text')!;
    expect([text.primary?.key, text.fallback?.key, text.route?.key, text.gap]).toEqual(['connection:oa', 'connection:or', 'connection:oa', null]);
    expect(routes.find((r) => r.capability === 'audio')!.cards.map((c) => c.key)).toEqual(['connection:oa', 'voice']);
    expect(routes.find((r) => r.capability === 'publishing')!.gap).toBe('No publishing provider: add one');
  });

  it("routes to the fallback while the default is limited, and keeps the manager's picks", () => {
    const limited = { ...openai, status: 'limited' as const };
    const defaults = { text: { primary: 'connection:oa', fallback: 'connection:or' } };
    expect(routeCapability('text', [limited, router], defaults)?.key).toBe('connection:or');
    const text = capabilityRoutes([limited, router], defaults).find((r) => r.capability === 'text')!;
    expect(text.primary?.key).toBe('connection:oa');
    expect(text.gap).toBe('connection:oa is limited: connection:or takes over');
    expect(routeCapability('text', [openai, router], { text: { primary: 'connection:or' } })?.key).toBe('connection:or');
    expect(routeCapability('text', [limited, { ...router, status: 'error' }], defaults)).toBeNull();
    // a pick that no longer covers it is ignored
    expect(routeCapability('video', [voice], { video: { primary: 'connection:gone' } })?.key).toBe('voice');
  });

  it('puts every capability on the CEO line', () => {
    expect(capabilitiesLine(capabilityRoutes([openai, router]))).toBe(
      'Capabilities: Text → connection:oa (fallback connection:or) · Image → connection:oa · Video → none · Audio → connection:oa · Operations → none · Publishing → none',
    );
  });

  it("lights up Text, Image, Video and Publishing at once from one Google sign-in's card", () => {
    const google: ProviderConnection = { id: 'g1', provider: 'google', label: 'Google', addedAt: 1, keyHint: '', test: { at: 1, ok: true, note: 'Key works', result: 'live' }, tags: [], usedFor: 'both', scopes: ['openid', 'email', 'https://www.googleapis.com/auth/generative-language.retriever', 'https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/youtube.upload'] };
    const cards = providerCards({ accounts: [], voiceKeySet: false, voiceKeyHint: '', cloud: EMPTY_CLOUD, providers: { connections: [google], mcp: [] }, clis: [], agentName: (id) => id, cloudAgents: 0 });
    const lit = capabilityRoutes(cards).filter((r) => r.route?.key === 'connection:g1').map((r) => r.capability);
    expect(lit).toEqual(['text', 'image', 'video', 'publishing']);
  });
});
