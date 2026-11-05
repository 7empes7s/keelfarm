// The latest browser screenshot per agent, kept on disk so monitors survive a server restart.
import fs from 'node:fs/promises';
import path from 'node:path';
import { HOME_DIR } from '../config.ts';

// The latest browser screenshot per agent is kept on disk so monitors survive a server restart.
export const SCREENS_DIR = path.join(HOME_DIR, 'screens');
export const MIME_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
export const screenFile = (agentId: string, mime: string) => path.join(SCREENS_DIR, `${agentId}.${MIME_EXT[mime] ?? 'img'}`);

export async function loadScreen(agentId: string): Promise<{ data: Buffer; mime: string; at: number } | null> {
  for (const [mime, ext] of Object.entries(MIME_EXT)) {
    const file = path.join(SCREENS_DIR, `${agentId}.${ext}`);
    try {
      const [data, stat] = await Promise.all([fs.readFile(file), fs.stat(file)]);
      return { data, mime, at: stat.mtimeMs };
    } catch {
      // try the next extension
    }
  }
  return null;
}

export async function removeScreens(agentId: string) {
  await Promise.all(Object.values(MIME_EXT).map((ext) => fs.rm(path.join(SCREENS_DIR, `${agentId}.${ext}`), { force: true })));
}
