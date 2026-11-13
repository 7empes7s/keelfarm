import { describe, expect, it } from 'vitest';
import { envWithVar, expiryLine, installLine, installRefusal, keyPart, maskPasted, renewDue } from './keyInstall';

const DAY = 86_400_000;

describe('install_key rules (#609)', () => {
  it('sets one line and keeps every other one', () => {
    const before = '# clipfarm\nPORT=8080\nexport OPENAI_API_KEY=old\nTWITCH_CLIENT_ID=x\nOPENAI_API_KEY=dupe\n';
    expect(envWithVar(before, 'OPENAI_API_KEY', 'sk-new')).toBe('# clipfarm\nPORT=8080\nOPENAI_API_KEY=sk-new\nTWITCH_CLIENT_ID=x\n');
    expect(envWithVar('PORT=1', 'TWITCH_CLIENT_SECRET', 's')).toBe('PORT=1\nTWITCH_CLIENT_SECRET=s\n');
    expect(envWithVar('', 'A', 'b')).toBe('A=b\n');
    expect(envWithVar('OPENAI_API_KEY_OLD=1\n', 'OPENAI_API_KEY', 'n')).toBe('OPENAI_API_KEY_OLD=1\nOPENAI_API_KEY=n\n');
  });

  it('takes only the allow-list and real variable names', () => {
    expect(installRefusal('/etc/clipfarm/clipfarm.env', 'OPENAI_API_KEY')).toBeNull();
    expect(installRefusal('/etc/keel/keel.env', 'OPENAI_API_KEY')).toMatch(/isn't on the list of service env files/);
    expect(installRefusal('/etc/clipfarm/../keel/x.env', 'A')).toMatch(/isn't on the list/);
    expect(installRefusal('/etc/clipfarm/clipfarm.env', 'A=1\nB')).toMatch(/isn't an environment variable name/);
    expect(installRefusal('/etc/clipfarm/clipfarm.env', 'lower')).toMatch(/isn't an environment variable name/);
  });

  it('splits a pair, and shows only the last 4 characters', () => {
    expect(keyPart('cid123:sec456', 'id')).toBe('cid123');
    expect(keyPart('cid123:sec456', 'secret')).toBe('sec456');
    expect(keyPart('sk-whole', 'id')).toBeNull();
    expect(keyPart('sk-whole')).toBe('sk-whole');
    expect(installLine('OPENAI_API_KEY', '/etc/clipfarm/clipfarm.env', 'ab12')).toBe('OPENAI_API_KEY → /etc/clipfarm/clipfarm.env (ends …ab12)');
  });

  it('masks a pasted key, and each half of a pair pasted apart', () => {
    const v = 'twitchclientid0001:twitchsecret0000zz';
    expect(maskPasted(`id twitchclientid0001\nsecret: twitchsecret0000zz`, v, 'Twitch')).toBe('id •••• (saved to Providers as Twitch)\nsecret: •••• (saved to Providers as Twitch)');
    expect(maskPasted(`here ${v} thanks`, v, 'Twitch')).toBe('here •••• (saved to Providers as Twitch) thanks');
    expect(maskPasted('nothing here', v, 'Twitch')).toBeNull();
  });

  it('renews within 7 days of expiry, and says so', () => {
    const now = Date.UTC(2026, 10, 12);
    expect(renewDue(now + 8 * DAY, now)).toBe(false);
    expect(renewDue(now + 7 * DAY, now)).toBe(true);
    expect(renewDue(undefined, now)).toBe(false);
    expect(expiryLine(now + 30 * DAY, now, true)).toBe('Expires in 30 days · renews itself 7 days before');
    expect(expiryLine(now - DAY, now, false)).toBe('Expired');
  });
});
