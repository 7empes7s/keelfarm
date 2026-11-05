import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadScreen, removeScreens, SCREENS_DIR, screenFile } from './screens.ts';

const id = `screens-test-${process.pid}`;
afterEach(() => removeScreens(id));

describe('screenshots on disk', () => {
  it('names the file after the agent and the image type', () => {
    expect(screenFile(id, 'image/png')).toBe(path.join(SCREENS_DIR, `${id}.png`));
    expect(screenFile(id, 'image/jpeg')).toBe(path.join(SCREENS_DIR, `${id}.jpg`));
    expect(screenFile(id, 'image/gif')).toBe(path.join(SCREENS_DIR, `${id}.img`));
  });

  it('loads none for an agent without one', async () => {
    expect(await loadScreen(id)).toBeNull();
  });

  it('loads a saved one back with its type, and removes it', async () => {
    await fs.mkdir(SCREENS_DIR, { recursive: true });
    await fs.writeFile(screenFile(id, 'image/webp'), Buffer.from('webp bytes'));
    const shot = await loadScreen(id);
    expect(shot?.mime).toBe('image/webp');
    expect(shot?.data.toString()).toBe('webp bytes');
    expect(shot?.at).toBeGreaterThan(0);
    await removeScreens(id);
    expect(await loadScreen(id)).toBeNull();
  });
});
