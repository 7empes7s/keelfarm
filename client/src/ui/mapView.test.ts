import { afterEach, describe, expect, it, vi } from 'vitest';
import { no3dReason, pickMapView, saveMapView, savedMapView } from './mapView';

describe('the memory map view (#314)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('starts on 2D, and on 3D only when it was chosen and can run here', () => {
    expect(pickMapView(null, true)).toBe('2d');
    expect(pickMapView('3d', true)).toBe('3d');
    expect(pickMapView('3d', false)).toBe('2d');
    expect(pickMapView('2d', true)).toBe('2d');
    expect(pickMapView('junk', true)).toBe('2d');
  });

  it('says why 3D stays off: no WebGL, then low power', () => {
    expect(no3dReason({ webgl: true, lowPower: false })).toBeNull();
    expect(no3dReason({ webgl: false, lowPower: false })).toMatch(/can’t draw 3D/);
    expect(no3dReason({ webgl: true, lowPower: true })).toMatch(/low on power/);
  });

  it('remembers the choice on this device, and survives storage that throws', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    expect(savedMapView()).toBeNull();
    saveMapView('3d');
    expect(pickMapView(savedMapView(), true)).toBe('3d');
    saveMapView('2d');
    expect(pickMapView(savedMapView(), true)).toBe('2d');
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => saveMapView('3d')).not.toThrow();
    expect(savedMapView()).toBeNull();
  });
});
