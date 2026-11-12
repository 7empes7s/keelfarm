import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { mergeParts } from '../decor/parts';
import { fitGeometry, loadModel, sceneParts } from './glb';

// The props' CC0 models (#536): a model that can't load falls back to its stand-in quietly, and a loaded one is fitted
// into its prop's box.

describe('project prop models', () => {
  it('resolves a model that fails to load to null, once, so its prop keeps the plain-shape stand-in', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const load = vi.fn(() => Promise.reject(new Error('404 Not Found')));
    expect(await loadModel('screen', load)).toBeNull();
    expect(await loadModel('screen', load)).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]).toEqual(['/models/kenney/computerScreen.glb']);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("turns a loaded scene into coloured parts and fits them into the prop's box, standing on the floor", async () => {
    const root = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.4), new THREE.MeshStandardMaterial({ color: '#aa7744' }));
    top.position.set(0.4, 0.3, -0.2);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.05), new THREE.MeshStandardMaterial({ color: '#333333' }));
    leg.position.set(0.1, 0.15, -0.1);
    root.add(top, leg);
    const parts = await loadModel('table', () => Promise.resolve(root));
    expect(parts).toHaveLength(2);
    expect(parts![0].color).toBe('#aa7744');
    const geo = fitGeometry(mergeParts(parts!), { w: 1.4, h: 0.75, d: 0.7 });
    geo.computeBoundingBox();
    const b = geo.boundingBox!;
    expect(b.min.y).toBeCloseTo(0);
    expect(b.max.y).toBeCloseTo(0.75);
    expect(b.max.x - b.min.x).toBeCloseTo(1.4);
    expect(b.min.x + b.max.x).toBeCloseTo(0);
    expect(b.max.z - b.min.z).toBeCloseTo(0.7);
    expect(geo.getAttribute('color')).toBeDefined();
    expect(sceneParts(new THREE.Group())).toEqual([]);
  });
});
