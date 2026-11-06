// Builds client/src/pocket/pocket-icons.woff2 and its @font-face (pocket-icons.css): Lucide's icons (ISC licence,
// lucide.dev, pocket-icons.LICENSE) drawn in place of the emoji that pocket mode shows. The font only covers those
// characters (and the joiners in their sequences), so the text around them keeps its own font and metrics; pocket.css
// puts it first in pocket mode's --font. Nothing else changes: the 3D office keeps its emoji. To rebuild after adding
// an icon to ICONS:
//   npm i --no-save lucide-static@1.68.0 opentype.js@1.3.4 wawoff2@2.0.1 && node scripts/pocketIcons.mjs
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const opentype = require('opentype.js');
const wawoff2 = require('wawoff2');

/** Emoji (as written in the source, variation selector optional) → Lucide icon name. */
export const ICONS = {
  '⚙': 'settings', '🔑': 'key-round', '👥': 'users', '↗': 'arrow-up-right', '⚠': 'triangle-alert',
  '📋': 'clipboard-list', '🏢': 'building-2', '▶': 'play', '✅': 'circle-check', '🧠': 'brain', '🖥': 'monitor',
  '🔍': 'search', '🔎': 'search', '☁': 'cloud', '💬': 'message-circle', '🎉': 'party-popper', '🎙': 'mic',
  '📱': 'smartphone', '👋': 'hand', '✋': 'hand', '⏳': 'hourglass', '❌': 'circle-x', '🔧': 'wrench', '🛠': 'wrench',
  '🛰': 'satellite', '📁': 'folder', '⚡': 'zap', '🔀': 'git-merge', '⌨': 'keyboard', '🧭': 'compass',
  '🩺': 'stethoscope', '🐙': 'git-branch', '🎧': 'headphones', '🔨': 'hammer', '📡': 'radio-tower', '⏸': 'pause',
  '🐢': 'turtle', '➕': 'plus', '📊': 'chart-column', '🎨': 'palette', '📝': 'notebook-pen', '♿': 'accessibility',
  '⏩': 'fast-forward', '🚨': 'siren', '⭐': 'star', '🌦': 'cloud-sun-rain', '🏅': 'medal', '🌐': 'globe',
  '🔗': 'link', '📄': 'file-text', '🗺': 'map', 'ℹ': 'info', '📼': 'film', '🤖': 'bot', '↩': 'undo-2',
  '🔔': 'bell', '🌀': 'orbit', '👤': 'user', '👩': 'user', '👨': 'user', '🧑': 'user', '🔇': 'volume-x', '💾': 'save',
  '🔊': 'volume-2', '🔈': 'volume', '☀': 'sun', '🌧': 'cloud-rain', '⛈': 'cloud-lightning', '🌫': 'cloud-fog',
  '🌨': 'cloud-snow', '🛸': 'rocket', '✨': 'sparkles', '🤝': 'handshake', '🪑': 'armchair', '✉': 'mail',
  '⏹': 'square', '💤': 'moon', '🔥': 'flame', '❓': 'circle-help', '🎮': 'gamepad-2', '📶': 'signal',
  '🔋': 'battery-full', '⏭': 'skip-forward', '🎲': 'dices', '🎥': 'video', '⏱': 'timer', '🔒': 'lock',
  '💻': 'laptop', '💼': 'briefcase-business', '⟳': 'refresh-cw', '↺': 'rotate-ccw', '■': 'square', '📌': 'pin',
  '🗑': 'trash-2', '📨': 'send', '✏': 'pencil', '🔄': 'refresh-cw', '🚀': 'rocket', '🧪': 'flask-conical',
  '📷': 'camera', '🌙': 'moon', '🏆': 'trophy', '💰': 'coins', '📈': 'trending-up', '🕐': 'clock', '⏰': 'alarm-clock',
};

/** Joined emoji drawn as one icon (a ligature over the whole sequence). */
export const SEQUENCES = { '👩‍💻': 'laptop', '🧑‍💼': 'briefcase-business' };

const ZWJ = 0x200d;
const VS16 = 0xfe0f;
// Lucide's glyphs fill 0..1000 above the baseline; scaled and lowered so they sit on the text's middle like an emoji.
const SCALE = 0.86;
const DROP = -105;
const SIDE = 90;

// ---------- cmap format 14 ----------
// An emoji written with U+FE0F (⚙️, ⚠️) asks for emoji presentation, and browsers then skip fonts that don't say they
// draw that sequence. A cmap format 14 subtable says so (each icon's ordinary glyph serves base + FE0F). opentype.js
// doesn't write one, so it is added to the finished font here, and the table directory rebuilt around it.

function format14(bases) {
  const sorted = [...bases].sort((a, b) => a - b);
  const defaults = Buffer.alloc(4 + 4 * sorted.length);
  defaults.writeUInt32BE(sorted.length, 0);
  sorted.forEach((cp, i) => {
    defaults.writeUIntBE(cp, 4 + 4 * i, 3);
    defaults.writeUInt8(0, 7 + 4 * i);
  });
  const head = Buffer.alloc(10 + 11);
  head.writeUInt16BE(14, 0);
  head.writeUInt32BE(head.length + defaults.length, 2);
  head.writeUInt32BE(1, 6); // one selector: FE0F
  head.writeUIntBE(VS16, 10, 3);
  head.writeUInt32BE(head.length, 13); // its default-UVS list follows the header
  head.writeUInt32BE(0, 17); // no non-default mappings
  return Buffer.concat([head, defaults]);
}

function checksum(buf) {
  const padded = Buffer.concat([buf, Buffer.alloc((4 - (buf.length % 4)) % 4)]);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0;
  return sum;
}

function withEmojiSequences(ttf, bases) {
  const numTables = ttf.readUInt16BE(4);
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const at = 12 + 16 * i;
    const tag = ttf.toString('latin1', at, at + 4);
    const offset = ttf.readUInt32BE(at + 8);
    const length = ttf.readUInt32BE(at + 12);
    tables.push({ tag, data: Buffer.from(ttf.subarray(offset, offset + length)) });
  }
  const cmapTable = tables.find((t) => t.tag === 'cmap');
  const old = cmapTable.data;
  const count = old.readUInt16BE(2);
  const records = [];
  for (let i = 0; i < count; i++) records.push({ platform: old.readUInt16BE(4 + 8 * i), encoding: old.readUInt16BE(6 + 8 * i), offset: old.readUInt32BE(8 + 8 * i) });
  const oldHeader = 4 + 8 * count;
  const newHeader = oldHeader + 8;
  const body = old.subarray(oldHeader);
  const sub14 = format14(bases);
  for (const r of records) r.offset += 8;
  records.push({ platform: 0, encoding: 5, offset: newHeader + body.length });
  records.sort((a, b) => a.platform - b.platform || a.encoding - b.encoding);
  const header = Buffer.alloc(newHeader);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(records.length, 2);
  records.forEach((r, i) => {
    header.writeUInt16BE(r.platform, 4 + 8 * i);
    header.writeUInt16BE(r.encoding, 6 + 8 * i);
    header.writeUInt32BE(r.offset, 8 + 8 * i);
  });
  cmapTable.data = Buffer.concat([header, body, sub14]);
  // Rebuild the font: same tables in the same order, each 4-byte aligned, fresh checksums.
  const dir = Buffer.alloc(12 + 16 * numTables);
  ttf.copy(dir, 0, 0, 12);
  let offset = dir.length;
  const chunks = [];
  tables.forEach((t, i) => {
    if (t.tag === 'head') t.data.writeUInt32BE(0, 8); // checkSumAdjustment, set below
    const at = 12 + 16 * i;
    dir.write(t.tag, at, 'latin1');
    dir.writeUInt32BE(checksum(t.data), at + 4);
    dir.writeUInt32BE(offset, at + 8);
    dir.writeUInt32BE(t.data.length, at + 12);
    const pad = Buffer.alloc((4 - (t.data.length % 4)) % 4);
    chunks.push(t.data, pad);
    offset += t.data.length + pad.length;
  });
  const out = Buffer.concat([dir, ...chunks]);
  const head = tables.findIndex((t) => t.tag === 'head');
  out.writeUInt32BE((0xb1b0afba - checksum(out)) >>> 0, out.readUInt32BE(12 + 16 * head + 8) + 8);
  return out;
}

function main() {
  const src = opentype.loadSync(require.resolve('lucide-static/font/lucide.ttf'));
  // Icons by their current names (the font's own glyph names are partly older aliases).
  const codepoints = require('lucide-static/font/codepoints.json');
  const byName = { get: (name) => (name in codepoints ? src.charToGlyph(String.fromCodePoint(codepoints[name])) : undefined) };
  const notdef = new opentype.Glyph({ name: '.notdef', unicode: undefined, advanceWidth: 600, path: new opentype.Path() });
  const glyphs = [notdef];
  const iconGlyph = new Map(); // lucide name → our glyph index
  const iconFor = (name) => {
    if (iconGlyph.has(name)) return iconGlyph.get(name);
    const g = byName.get(name);
    // Lucide dropped its brand icons (github) but kept their names as empty glyphs: an empty one would draw a gap.
    if (!g || !g.path.commands.length) throw new Error(`no Lucide icon named ${name}`);
    const path = new opentype.Path();
    for (const c of g.path.commands) {
      const t = { ...c };
      for (const [x, y] of [['x', 'y'], ['x1', 'y1'], ['x2', 'y2']]) {
        if (x in t) t[x] = Math.round(t[x] * SCALE + SIDE);
        if (y in t) t[y] = Math.round(t[y] * SCALE + DROP);
      }
      path.commands.push(t);
    }
    const ours = new opentype.Glyph({ name: `i-${name}`, advanceWidth: Math.round(1000 * SCALE + 2 * SIDE), path });
    glyphs.push(ours);
    iconGlyph.set(name, glyphs.length - 1);
    return glyphs.length - 1;
  };
  const cmap = new Map(); // code point → glyph index
  for (const [emoji, name] of Object.entries(ICONS)) cmap.set(emoji.codePointAt(0), iconFor(name));
  // The emoji-style selector and the joiner draw nothing, so a sequence never falls back to the emoji font.
  for (const [cp, nm] of [[VS16, 'vs16'], [ZWJ, 'zwj']]) {
    glyphs.push(new opentype.Glyph({ name: nm, advanceWidth: 0, path: new opentype.Path() }));
    cmap.set(cp, glyphs.length - 1);
  }
  const parts = new Set(Object.keys(SEQUENCES).flatMap((s) => [...s].map((c) => c.codePointAt(0))));
  for (const cp of parts) if (!cmap.has(cp)) {
    glyphs.push(new opentype.Glyph({ name: `u${cp.toString(16)}`, advanceWidth: 0, path: new opentype.Path() }));
    cmap.set(cp, glyphs.length - 1);
  }
  // opentype.js takes one code point per glyph; extra code points for a shared icon get a copy of it.
  const used = new Set();
  for (const [cp, idx] of cmap) {
    let i = idx;
    if (used.has(idx)) {
      const g = glyphs[idx];
      glyphs.push(new opentype.Glyph({ name: `${g.name}-${cp.toString(16)}`, advanceWidth: g.advanceWidth, path: g.path }));
      i = glyphs.length - 1;
      cmap.set(cp, i);
    }
    used.add(i);
    glyphs[i].unicode = cp;
    glyphs[i].unicodes = [cp];
  }
  const font = new opentype.Font({ familyName: 'Pocket Icons', styleName: 'Regular', unitsPerEm: 1000, ascender: 800, descender: -200, glyphs });
  for (const [seq, name] of Object.entries(SEQUENCES)) {
    const sub = [...seq].map((c) => cmap.get(c.codePointAt(0)));
    font.substitution.add('liga', { sub, by: iconFor(name) });
  }
  const icons = [...cmap].filter(([cp]) => cp !== VS16 && cp !== ZWJ && glyphs[cmap.get(cp)].path.commands.length).map(([cp]) => cp);
  const ttf = withEmojiSequences(Buffer.from(font.toArrayBuffer()), icons);
  const covered = [...cmap.keys()].sort((a, b) => a - b);
  return wawoff2.compress(ttf).then((woff2) => {
    const dir = new URL('../client/src/pocket/', import.meta.url);
    writeFileSync(new URL('pocket-icons.woff2', dir), woff2);
    // Only these characters come from this font: everything else, the space included, keeps the text's own font.
    const range = covered.map((c) => 'U+' + c.toString(16).toUpperCase()).join(', ');
    const css = `/* Generated by scripts/pocketIcons.mjs: Lucide icons (ISC, lucide.dev) in place of pocket mode's emoji. */
@font-face {
  font-family: 'Pocket Icons';
  src: url('./pocket-icons.woff2') format('woff2');
  font-display: block;
  unicode-range: ${range};
}
`;
    writeFileSync(new URL('pocket-icons.css', dir), css);
    console.log(`pocket-icons.woff2: ${glyphs.length} glyphs, ${woff2.length} bytes; ${covered.length} characters`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
