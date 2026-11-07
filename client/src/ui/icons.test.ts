// The one icon pack (#134): no emoji or text glyph is UI chrome anywhere in client/src. Every string, template and JSX
// text is scanned (comments aren't); an icon is `<Icon name=… />` (ui/Icon.tsx). CONTENT lists the files whose emoji
// are content, not chrome: what people type and react with, and what is drawn into the 3D scene or a game.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseSync } from 'oxc-parser';
import { describe, expect, it } from 'vitest';
import { EMOJI_ICONS, ICONS } from './icons';

const ROOT = path.resolve(__dirname, '..');

/** client/src-relative files (forward slashes) whose emoji are content, and why. */
const CONTENT: Record<string, string> = {
  'ui/icons.ts': 'the emoji → icon map itself',
};

// Emoji, plus the text glyphs the UI used as icons. × stays: it is the multiplication sign in "4×" and "600× speed".
const ICON_CHAR = /\p{Extended_Pictographic}|[✕✖↗↩↪↺⟳▲▼▶◀■✓✔⋯✻✳♪]/u;
const NOT_ICONS = /[©®™‼⁉]/gu;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return files(full);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
  });
}

/** Every string, template piece and JSX text in `source` with an icon character, as `line: text`. */
function iconTexts(file: string, source: string): string[] {
  const found: string[] = [];
  const lineAt = (offset: number) => source.slice(0, offset).split('\n').length;
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    const n = node as { type?: string; value?: unknown; start?: number };
    let text: string | undefined;
    if ((n.type === 'Literal' || n.type === 'JSXText') && typeof n.value === 'string') text = n.value;
    if (n.type === 'TemplateElement') text = (n.value as { cooked?: string; raw: string }).cooked ?? (n.value as { raw: string }).raw;
    if (text && ICON_CHAR.test(text.replace(NOT_ICONS, ''))) found.push(`${lineAt(n.start ?? 0)}: ${text.trim().slice(0, 60)}`);
    for (const [k, v] of Object.entries(n)) if (k !== 'value' || n.type !== 'TemplateElement') visit(v);
  };
  visit(parseSync(file, source).program);
  return found;
}

describe('one icon pack (#134)', () => {
  it('finds emoji and icon glyphs in strings and JSX, not in comments', () => {
    const src = "// ⚙️ settings\nconst a = '⚙️ Settings';\nconst b = <b>✕</b>;\nconst c = `${n}× ok`;\nconst d = 'Café ©';";
    expect(iconTexts('x.tsx', src)).toEqual(['2: ⚙️ Settings', '3: ✕']);
  });

  it('maps every old glyph to an icon that exists', () => {
    for (const [glyph, name] of Object.entries(EMOJI_ICONS)) expect(ICONS[name], glyph).toBeDefined();
  });

  it('uses no emoji or icon glyph as UI chrome in client/src', () => {
    const offenders = files(ROOT).flatMap((full) => {
      const rel = path.relative(ROOT, full).split(path.sep).join('/');
      if (rel in CONTENT) return [];
      return iconTexts(full, readFileSync(full, 'utf8')).map((t) => `${rel}:${t}`);
    });
    expect(offenders, 'use <Icon name=… /> (ui/icons.ts maps the old glyphs), or list a content file in CONTENT').toEqual([]);
  });

  it('lists only content files that exist and still have emoji', () => {
    for (const rel of Object.keys(CONTENT)) {
      const full = path.join(ROOT, ...rel.split('/'));
      expect(iconTexts(full, readFileSync(full, 'utf8')).length, rel).toBeGreaterThan(0);
    }
  });
});
