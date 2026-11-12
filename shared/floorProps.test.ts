import { describe, expect, it } from 'vitest';
import { cleanPropSet, deskToolFor, floorPropSet, PROP_SET_INFO, PROP_SETS, propSetFor, propSetOf } from './floorProps.ts';
import type { UseCase } from './types.ts';

describe("a floor's project props (#536)", () => {
  it("picks each of the office's floors from its profile", () => {
    expect(propSetFor({ fullName: '7empes7s/keel', description: 'KEEL — Microsoft 365 / Entra configuration backup, drift governance and cross-tenant restore', useCase: 'web-app' })).toBe('vault');
    expect(propSetFor({ fullName: '7empes7s/Democracy2.0', description: '', useCase: 'web-app' })).toBe('civic');
    expect(propSetFor({ fullName: '7empes7s/keelfarm', description: 'Private copy of leonvanzyl/cubefarm (MIT)', mission: 'AI coding agents run from a phone', useCase: 'web-app' })).toBe('workshop');
    expect(propSetFor({ fullName: '7empes7s/clipfarm', description: '', useCase: 'video' })).toBe('broadcast');
    expect(propSetFor({ fullName: 'acme/shop', summary: 'Short clips for TikTok', useCase: 'web-app' })).toBe('broadcast');
  });

  it("gives any other floor its use case's default set, and the device lab without one", () => {
    const cases: [UseCase, string][] = [['game-3d', 'arcade'], ['api', 'servers'], ['ops', 'servers'], ['design', 'devices'], ['mobile', 'devices'], ['video', 'broadcast']];
    for (const [useCase, set] of cases) expect(propSetFor({ fullName: 'acme/thing', description: 'A thing', useCase }), useCase).toBe(set);
    expect(propSetFor({ fullName: 'acme/thing' })).toBe('devices');
    expect(propSetFor({ fullName: 'acme/thing', useCase: null })).toBe('devices');
  });

  it("matches whole words only, so 'restored' furniture or a 'clipboard' app don't change the set", () => {
    expect(propSetFor({ fullName: 'acme/clipboard', description: 'A clipboard manager', useCase: 'cli-library' })).toBe('servers');
    expect(propSetFor({ fullName: 'acme/agenda', description: 'Meeting agendas', useCase: 'web-app' })).toBe('devices');
  });

  it("lets the manager's pick win over the profile, per floor", () => {
    const keel = { fullName: '7empes7s/keel', description: 'backup and restore' };
    expect(floorPropSet(keel)).toBe('vault');
    expect(floorPropSet({ ...keel, props: 'arcade' })).toBe('arcade');
  });

  it('keeps only known sets and refuses others with a message the manager can act on', () => {
    expect(propSetOf('civic')).toBe('civic');
    expect(propSetOf('casino')).toBeUndefined();
    expect(propSetOf(undefined)).toBeUndefined();
    expect(cleanPropSet('vault')).toBe('vault');
    expect(cleanPropSet('auto')).toBeUndefined();
    expect(cleanPropSet(null)).toBeUndefined();
    expect(() => cleanPropSet('casino')).toThrow(/props must be auto or one of vault/);
    for (const s of PROP_SETS) expect(PROP_SET_INFO[s].name.length).toBeGreaterThan(0);
  });

  it('puts a tool on the desks that matches the stack', () => {
    expect(deskToolFor('game-3d', 'devices')).toBe('controller');
    expect(deskToolFor('api', 'devices')).toBe('terminal');
    expect(deskToolFor('design', 'devices')).toBe('tablet');
    expect(deskToolFor(null, 'arcade')).toBe('controller');
    expect(deskToolFor(undefined, 'broadcast')).toBe('camera');
    // a theme with a tool of its own puts it on every desk, whatever the use case (#570)
    expect(deskToolFor('api', 'servers', 'game-studio')).toBe('controller');
    expect(deskToolFor('web-app', 'devices', 'newsroom')).toBe('notebook');
    expect(deskToolFor('api', 'servers', 'trading')).toBe('terminal');
  });
});
