// One sign-in per company (#533), pure: the companies with OAuth (Google, Meta, TikTok, Microsoft), the scopes the
// office asks for in one consent with each one's plain words and the capabilities it unlocks, the consent URL, the
// token exchange and refresh forms, and reading a token answer. The tokens themselves stay on the server
// (server/providers.ts keeps them in secrets.json); the tabs see only the granted scopes.
import type { Capability } from './types.ts';

type OAuthCompany = 'google' | 'meta' | 'tiktok' | 'microsoft';

interface OAuthScope {
  scope: string;
  /** What it lets the office do, in plain words, shown before the consent screen. */
  plain: string;
  unlocks: Capability[];
}

export interface OAuthDef {
  company: OAuthCompany; // also its catalogue id (shared/providers.ts)
  name: string;
  authUrl: string;
  tokenUrl: string;
  scopes: OAuthScope[];
  /** How the company joins scopes in the consent URL. */
  sep: ' ' | ',';
  /** TikTok calls the client id a client key. */
  clientParam: 'client_id' | 'client_key';
  /** Extra consent URL parameters: Google's offline access, so a refresh token comes back. */
  extra: Record<string, string>;
  /** Meta has no refresh token: its long-lived token is exchanged for a new one before it runs out. */
  refresh: 'refresh_token' | 'fb_exchange_token';
  /** Where the manager makes the OAuth client (its id and secret). */
  consoleUrl: string;
}

export const OAUTH: OAuthDef[] = [
  {
    company: 'google',
    name: 'Google',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: [
      { scope: 'openid email', plain: 'Your email address, to show which Google account is signed in', unlocks: [] },
      { scope: 'https://www.googleapis.com/auth/generative-language.retriever', plain: 'Use Gemini models for text', unlocks: ['text'] },
      { scope: 'https://www.googleapis.com/auth/cloud-platform', plain: 'Make images (Imagen, Nano Banana) and video (Veo) on your Google Cloud project', unlocks: ['image', 'video'] },
      { scope: 'https://www.googleapis.com/auth/youtube.upload', plain: 'Upload videos to your YouTube channel', unlocks: ['publishing'] },
      { scope: 'https://www.googleapis.com/auth/yt-analytics.readonly', plain: "Read your YouTube channel's analytics", unlocks: ['publishing'] },
      { scope: 'https://www.googleapis.com/auth/drive.readonly', plain: 'Read files in your Google Drive (never change or delete them)', unlocks: [] },
    ],
    sep: ' ',
    clientParam: 'client_id',
    extra: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
    refresh: 'refresh_token',
    consoleUrl: 'https://console.cloud.google.com/apis/credentials',
  },
  {
    company: 'meta',
    name: 'Meta',
    authUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v21.0/oauth/access_token',
    scopes: [
      { scope: 'instagram_basic', plain: 'See your Instagram business profile', unlocks: [] },
      { scope: 'instagram_content_publish', plain: 'Post photos, reels and carousels to Instagram', unlocks: ['publishing'] },
      { scope: 'instagram_manage_insights', plain: "Read your posts' reach and engagement", unlocks: ['publishing'] },
      { scope: 'pages_show_list', plain: 'List the Facebook Pages your Instagram account is linked to', unlocks: [] },
    ],
    sep: ',',
    clientParam: 'client_id',
    extra: {},
    refresh: 'fb_exchange_token',
    consoleUrl: 'https://developers.facebook.com/apps/',
  },
  {
    company: 'tiktok',
    name: 'TikTok',
    authUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    scopes: [
      { scope: 'user.info.basic', plain: 'Your TikTok name and avatar', unlocks: [] },
      { scope: 'video.upload', plain: 'Send videos to your TikTok drafts', unlocks: ['publishing'] },
      { scope: 'video.publish', plain: 'Post videos to your TikTok profile', unlocks: ['publishing'] },
    ],
    sep: ',',
    clientParam: 'client_key',
    extra: {},
    refresh: 'refresh_token',
    consoleUrl: 'https://developers.tiktok.com/apps/',
  },
  {
    company: 'microsoft',
    name: 'Microsoft',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: [
      { scope: 'offline_access User.Read', plain: 'Stay signed in, and your name and email', unlocks: [] },
      { scope: 'Files.Read', plain: 'Read files in your OneDrive (never change or delete them)', unlocks: ['operations'] },
    ],
    sep: ' ',
    clientParam: 'client_id',
    extra: { response_mode: 'query' },
    refresh: 'refresh_token',
    consoleUrl: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
  },
];

export const oauthDef = (company: string) => OAUTH.find((o) => o.company === company);

/** Every scope the office asks a company for, one by one ("openid email" is two). */
export const scopeList = (def: OAuthDef) => def.scopes.flatMap((s) => s.scope.split(' '));

/** The capabilities a sign-in unlocks with the scopes it was granted (all of them when the answer didn't say). */
export function grantedCaps(company: string, granted: readonly string[] | undefined): Capability[] {
  const def = oauthDef(company);
  if (!def) return [];
  // Microsoft answers with full names ("https://graph.microsoft.com/Files.Read"); compare case-blind on the tail.
  const has = (s: string) => !granted || granted.some((g) => g === s || g.toLowerCase().endsWith(`/${s.toLowerCase()}`) || g.toLowerCase() === s.toLowerCase());
  const caps = def.scopes.filter((s) => s.scope.split(' ').every(has)).flatMap((s) => s.unlocks);
  return [...new Set(caps)];
}

/** The consent screen's URL, asking for every scope at once. */
export function authorizeUrl(def: OAuthDef, o: { clientId: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({ [def.clientParam]: o.clientId, redirect_uri: o.redirectUri, response_type: 'code', scope: scopeList(def).join(def.sep), state: o.state, ...def.extra });
  return `${def.authUrl}?${q}`;
}

/** The form that trades the consent's code for tokens. */
export function codeForm(def: OAuthDef, o: { clientId: string; clientSecret: string; code: string; redirectUri: string }): Record<string, string> {
  return { grant_type: 'authorization_code', code: o.code, redirect_uri: o.redirectUri, [def.clientParam]: o.clientId, client_secret: o.clientSecret };
}

/** The form that gets a fresh access token: a refresh token, or Meta's long-lived token exchanged. */
export function refreshForm(def: OAuthDef, o: { clientId: string; clientSecret: string; token: string }): Record<string, string> {
  const client = { [def.clientParam]: o.clientId, client_secret: o.clientSecret };
  return def.refresh === 'fb_exchange_token' ? { grant_type: 'fb_exchange_token', fb_exchange_token: o.token, ...client } : { grant_type: 'refresh_token', refresh_token: o.token, ...client };
}

export interface OAuthTokens {
  access: string;
  refresh?: string;
  expiresAt: number;
  scopes?: string[];
}

/** A token answer (TikTok nests nothing; some put it under `data`), or why it failed in the company's words. */
export function readTokens(body: unknown, now = Date.now()): OAuthTokens | { error: string } {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const b = raw.data && typeof raw.data === 'object' ? (raw.data as Record<string, unknown>) : raw;
  const access = typeof b.access_token === 'string' ? b.access_token : '';
  if (!access) {
    const err = b.error_description ?? b.error ?? raw.error_description ?? raw.message ?? (raw.error as { message?: unknown } | undefined)?.message;
    return { error: typeof err === 'string' && err ? err.slice(0, 200) : 'The company sent no token back.' };
  }
  const secs = Number(b.expires_in);
  return {
    access,
    ...(typeof b.refresh_token === 'string' && b.refresh_token ? { refresh: b.refresh_token } : {}),
    expiresAt: now + (Number.isFinite(secs) && secs > 0 ? secs : 3600) * 1000,
    ...(typeof b.scope === 'string' && b.scope ? { scopes: b.scope.split(/[\s,]+/).filter(Boolean) } : {}),
  };
}

/** An access token is refreshed when it has under 5 minutes left (Meta's 60-day one, under a week). */
export function needsRefresh(def: OAuthDef, expiresAt: number | undefined, now = Date.now()): boolean {
  const margin = def.refresh === 'fb_exchange_token' ? 7 * 24 * 3_600_000 : 5 * 60_000;
  return !expiresAt || expiresAt - now < margin;
}

/** Where the consent screen sends the browser back: the office's own address. */
export const callbackPath = '/api/oauth/callback';
