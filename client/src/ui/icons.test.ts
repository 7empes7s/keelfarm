// The one icon pack (#134): no emoji or text glyph is UI chrome anywhere in client/src. Every string, template and JSX
// text is scanned (comments aren't); an icon is `<Icon name=… />` (ui/Icon.tsx). CONTENT lists the files whose emoji
// are content, not chrome: what people type and react with, and what is drawn into the 3D scene or a game.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseSync } from 'oxc-parser';
import { describe, expect, it } from 'vitest';
import { EMOJI_ICONS, ICONS, iconFor, leadingIcon } from './icons';
import { PROVIDERS } from '../../../shared/providers';

const ROOT = path.resolve(__dirname, '..');

/** client/src-relative files (forward slashes) whose emoji are content, and why. */
const CONTENT: Record<string, string> = {
  'ui/icons.ts': 'the emoji → icon map itself',
  'ops.ts': "the floor's wall sign, a canvas texture",
  'photo/overlay.ts': 'the stamp drawn onto a saved photo',
  'ui/AccessibilitySettings.tsx': 'a sample caption, as the caption strip shows it',
  'ui/captionRules.ts': "captions' direction arrows, part of the caption text",
  'ui/ChatReactions.tsx': 'the reactions people and the CEO pick',
  'ui/chatterLines.ts': "agents' chatter lines",
  'ui/chatCardRules.ts': 'reads the ✗ that marks a failed step in saved messages',
  'ui/keymap.ts': "the arrow keys' names, as their key caps show them",
  'ui/statusLook.ts': 'status shapes drawn into canvas textures (KIND_ICON_NAME has the icons)',
  'ui/games/PetGame.tsx': "the desk pet's treats, toys and moods",
  'ui/games/SnakeGame.tsx': 'game pieces and messages on the game canvas',
  'ui/games/TetrisGame.tsx': 'messages on the game canvas',
  'ui/games/pet.ts': "the desk pet's moods and lines",
  'ui/games/petStore.ts': "the desk pet's lines",
  'world/Desk.tsx': "drawn into the 3D scene's canvas textures",
  'world/ItOffice.tsx': "drawn into the 3D scene's canvas textures",
  'world/Jukebox.tsx': "drawn into the 3D scene's canvas textures",
  'world/Lobby.tsx': "drawn into the 3D scene's canvas textures",
  'world/OfficeFloor.tsx': "drawn into the 3D scene's canvas textures",
  'world/PongTable.tsx': "drawn into the 3D scene's canvas textures",
  'world/TestLabScreen.tsx': "drawn into the 3D scene's canvas textures",
  'world/TimeLapseScreen.tsx': "drawn into the 3D scene's canvas textures",
  'world/boardStats.ts': "drawn into the 3D scene's canvas textures",
  'world/camera/BuildingView.tsx': "drawn into the 3D scene's canvas textures",
  'world/decor/Decorations.tsx': "drawn into the 3D scene's canvas textures",
  'world/decor/RewardsCorner.tsx': "drawn into the 3D scene's canvas textures",
  'world/floorThemes/themeDraw.ts': "drawn into the 3D scene's canvas textures",
  'world/floorThemes/studioDraw.ts': "drawn into the 3D scene's canvas textures",
  'world/lobbyDirectory.ts': "drawn into the 3D scene's canvas textures",
  'world/desk/DeskStory.tsx': "drawn into the 3D scene's canvas textures",
  'world/draw.ts': "drawn into the 3D scene's canvas textures",
  'world/drawOps.ts': "drawn into the 3D scene's canvas textures",
  'world/events/news.ts': "drawn into the 3D scene's canvas textures",
  'world/presence/Visitors.tsx': "drawn into the 3D scene's canvas textures",
  'world/roof/Roof.tsx': "drawn into the 3D scene's canvas textures",
  'world/toys/Blasters.tsx': "drawn into the 3D scene's canvas textures",
  'world/Candidates.tsx': "people's speech bubbles in the 3D scene",
  'world/events/watchPlan.ts': "people's speech bubbles in the 3D scene",
  'world/hiring.ts': "people's speech bubbles in the 3D scene",
  'world/meals.ts': "people's speech bubbles in the 3D scene",
  'world/ritualRunner.ts': "people's speech bubbles in the 3D scene",
  'world/roof/RoofPeople.tsx': "people's speech bubbles in the 3D scene",
  'world/socials.ts': "people's speech bubbles in the 3D scene",
  'world/toys/pongRunner.ts': "people's speech bubbles in the 3D scene",
  'world/themes/birthday.tsx': 'holiday screens and speech bubbles in the 3D scene',
  'world/themes/christmas.tsx': 'holiday screens and speech bubbles in the 3D scene',
  'world/themes/newyear.tsx': 'holiday screens and speech bubbles in the 3D scene',
  'world/themes/valentines.tsx': 'holiday screens and speech bubbles in the 3D scene',
  'world/fridge.ts': "the fridge's snacks",
  'world/MapTable.tsx': "drawn into the 3D scene's canvas textures",
};

// Emoji, plus the text glyphs the UI used as icons (#295 added the arrows, carets, dots and marks #134 missed). × stays:
// it is the multiplication sign in "4×" and "600× speed".
const ICON_CHAR = /\p{Extended_Pictographic}|[✕✖✗↗↩↪↺↻⟲⟳⇆⇅⤢⤓↳⛶▲▼▶◀▸▾▴⌄■●○◉◎◌✓✔⋯✻✳♪ⓘ‹›✦]/u;
// A text arrow is a glyph when it leads or ends a short label ("Next →", "↓ Latest"); in prose ("Settings → Voice"), as
// a separator (' → ') and as a key's name in <kbd> it is a word.
const ARROW_LABEL = /^[←→↑↓]\s*\S+(\s+\S+)?$|^(\S+\s+)?\S+\s*[←→↑↓]$|^[←→↑↓]$/u;
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
    const n = node as { type?: string; value?: unknown; start?: number; openingElement?: { name?: { name?: unknown } } };
    if (n.type === 'JSXElement' && n.openingElement?.name?.name === 'kbd') return;
    let text: string | undefined;
    if ((n.type === 'Literal' || n.type === 'JSXText') && typeof n.value === 'string') text = n.value;
    if (n.type === 'TemplateElement') text = (n.value as { cooked?: string; raw: string }).cooked ?? (n.value as { raw: string }).raw;
    const glyph = (t: string) => ICON_CHAR.test(t.replace(NOT_ICONS, '')) || (!/^\s+[←→]\s+$/.test(t) && ARROW_LABEL.test(t.trim()));
    if (text && glyph(text)) found.push(`${lineAt(n.start ?? 0)}: ${text.trim().slice(0, 60)}`);
    for (const [k, v] of Object.entries(n)) if (k !== 'value' || n.type !== 'TemplateElement') visit(v);
  };
  visit(parseSync(file, source).program);
  return found;
}

describe('one icon pack (#134)', () => {
  it('finds emoji and icon glyphs in strings and JSX, not in comments', () => {
    const src = "// ⚙️ settings\nconst a = '⚙️ Settings';\nconst b = <b>✕</b>;\nconst c = `${n}× ok`;\nconst d = 'Café ©';\nconst e = <b>Next →</b>;\nconst f = 'Settings → Voice';\nconst g = list.join(' → ');\nconst h = <b>‹ Back</b>;\nconst i = <b>↻ Restart</b>;\nconst j = <i>{open ? '▾' : '▸'}</i>;\nconst k = <kbd>↑</kbd>;\nconst l = '↓ Latest';";
    expect(iconTexts('x.tsx', src)).toEqual(['2: ⚙️ Settings', '3: ✕', '6: Next →', '9: ‹ Back', '10: ↻ Restart', '11: ▾', '11: ▸', '13: ↓ Latest']);
  });

  it('draws glyphs that still arrive as data with their icon', () => {
    expect(iconFor('⚙️', 'zap')).toBe('settings');
    expect(iconFor('🦄', 'zap')).toBe('zap');
    expect(leadingIcon('⏳ 2 tasks waiting for memory')).toEqual({ icon: 'hourglass', text: '2 tasks waiting for memory' });
    expect(leadingIcon('⭐ 5 first-time passes')).toEqual({ icon: 'star', text: '5 first-time passes' });
    expect(leadingIcon('Plain words')).toEqual({ icon: null, text: 'Plain words' });
    expect(leadingIcon('#3 open')).toEqual({ icon: null, text: '#3 open' });
  });

  it('maps every old glyph to an icon that exists', () => {
    for (const [glyph, name] of Object.entries(EMOJI_ICONS)) expect(ICONS[name], glyph).toBeDefined();
  });

  it("has every Providers catalogue entry's icon", () => {
    for (const p of PROVIDERS) if (p.icon) expect(ICONS, p.id).toHaveProperty(p.icon);
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
