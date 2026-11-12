import { describe, expect, it } from 'vitest';
import { OAUTH, authorizeUrl, codeForm, grantedCaps, needsRefresh, oauthDef, readTokens, refreshForm, scopeList } from './oauth.ts';
import { providerDef } from './providers.ts';

describe('one sign-in per company (#533)', () => {
  it('asks each company for every scope the office needs at once', () => {
    expect(Object.fromEntries(OAUTH.map((o) => [o.company, scopeList(o)]))).toEqual({
      google: [
        'openid',
        'email',
        'https://www.googleapis.com/auth/generative-language.retriever',
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/youtube.upload',
        'https://www.googleapis.com/auth/yt-analytics.readonly',
        'https://www.googleapis.com/auth/drive.readonly',
      ],
      meta: ['instagram_basic', 'instagram_content_publish', 'instagram_manage_insights', 'pages_show_list'],
      tiktok: ['user.info.basic', 'video.upload', 'video.publish'],
      microsoft: ['offline_access', 'User.Read', 'Files.Read'],
    });
    for (const o of OAUTH) {
      expect(providerDef(o.company)?.auth).toBe('oauth');
      for (const s of o.scopes) expect(s.plain.length).toBeGreaterThan(10); // plain words before the consent screen
    }
  });

  it("builds the consent URL with the company's own separators and offline access", () => {
    const google = new URL(authorizeUrl(oauthDef('google')!, { clientId: 'cid', redirectUri: 'http://localhost:4317/api/oauth/callback', state: 's1' }));
    expect(google.searchParams.get('scope')?.split(' ')).toContain('https://www.googleapis.com/auth/youtube.upload');
    expect(Object.fromEntries(['client_id', 'access_type', 'prompt', 'state', 'response_type'].map((k) => [k, google.searchParams.get(k)]))).toEqual({ client_id: 'cid', access_type: 'offline', prompt: 'consent', state: 's1', response_type: 'code' });
    const tiktok = new URL(authorizeUrl(oauthDef('tiktok')!, { clientId: 'ck', redirectUri: 'https://x/cb', state: 's' }));
    expect([tiktok.searchParams.get('client_key'), tiktok.searchParams.get('scope')]).toEqual(['ck', 'user.info.basic,video.upload,video.publish']);
  });

  it('unlocks capabilities by the scopes granted', () => {
    expect(grantedCaps('google', undefined)).toEqual(['text', 'image', 'video', 'publishing']);
    expect(grantedCaps('google', ['openid', 'email', 'https://www.googleapis.com/auth/drive.readonly'])).toEqual([]);
    expect(grantedCaps('meta', ['instagram_content_publish'])).toEqual(['publishing']);
    expect(grantedCaps('microsoft', ['https://graph.microsoft.com/Files.Read', 'https://graph.microsoft.com/User.Read', 'offline_access'])).toEqual(['operations']);
    expect(grantedCaps('nobody', [])).toEqual([]);
  });

  it('trades a code and refreshes with the right form, Meta by exchanging its long-lived token', () => {
    const client = { clientId: 'id', clientSecret: 'sec' };
    expect(codeForm(oauthDef('google')!, { ...client, code: 'c', redirectUri: 'r' })).toEqual({ grant_type: 'authorization_code', code: 'c', redirect_uri: 'r', client_id: 'id', client_secret: 'sec' });
    expect(refreshForm(oauthDef('google')!, { ...client, token: 'rt' })).toEqual({ grant_type: 'refresh_token', refresh_token: 'rt', client_id: 'id', client_secret: 'sec' });
    expect(refreshForm(oauthDef('meta')!, { ...client, token: 'll' })).toEqual({ grant_type: 'fb_exchange_token', fb_exchange_token: 'll', client_id: 'id', client_secret: 'sec' });
    expect(refreshForm(oauthDef('tiktok')!, { ...client, token: 'rt' })).toMatchObject({ client_key: 'id' });
  });

  it("reads a token answer, or the company's reason", () => {
    expect(readTokens({ access_token: 'a', refresh_token: 'r', expires_in: 60, scope: 'openid email' }, 1000)).toEqual({ access: 'a', refresh: 'r', expiresAt: 61_000, scopes: ['openid', 'email'] });
    expect(readTokens({ access_token: 'a', scope: 'video.upload,video.publish' }, 0)).toEqual({ access: 'a', expiresAt: 3_600_000, scopes: ['video.upload', 'video.publish'] });
    expect(readTokens({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })).toEqual({ error: 'Token has been expired or revoked.' });
    expect(readTokens(undefined)).toEqual({ error: 'The company sent no token back.' });
  });

  it('refreshes with 5 minutes left, Meta with a week', () => {
    const now = 10_000_000_000;
    expect(needsRefresh(oauthDef('google')!, now + 10 * 60_000, now)).toBe(false);
    expect(needsRefresh(oauthDef('google')!, now + 60_000, now)).toBe(true);
    expect(needsRefresh(oauthDef('google')!, undefined, now)).toBe(true);
    expect(needsRefresh(oauthDef('meta')!, now + 3 * 24 * 3_600_000, now)).toBe(true);
  });
});
