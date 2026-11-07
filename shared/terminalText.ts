// Terminal output made fit to show (#138): colour codes and links stripped, box-drawing rules shortened, capped in
// length, so a notice quoting a tool's output never shows ⊠ boxes or a line too long to wrap.

// The escape characters, by name: ESC, BEL, the 8-bit CSI, ST and OSC, and the ␛ some tools print in ESC's place.
const [ESC, BEL, CSI8, ST8, OSC8] = ['\u001b', '\u0007', '\u009b', '\u009c', '\u009d'];
const g = (source: string) => new RegExp(source, 'g');
// OSC (links, titles) ends with BEL or ST; CSI (colours, cursor) ends with a final byte; then any other ESC pair.
const OSC = g(`(?:${ESC}\\]|${OSC8})[^${BEL}${ESC}${ST8}]*(?:${BEL}|${ESC}\\\\|${ST8})?`);
const CSI = g(`(?:${ESC}\\[|${CSI8}|\u241b\\[)[0-?]*[ -/]*[@-~]`);
const ESC_PAIR = g(`${ESC}[@-_]?`);
// What's left of a colour code whose ESC was already lost.
const BARE_SGR = /\[(?:\d{1,3}(?:;\d{1,3})*)?m/g;
// Box drawing and block elements, three or more in a row (vitest's ──────, progress bars ████).
const BOX_RUN = /[\u2500-\u259f]{3,}/g;
// Control characters other than tab and newline (C0, DEL, C1), and a stray ␛.
const CONTROL = g(`[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u241b]`);

/** `text` without terminal escape codes, with box-drawing runs as one "—", trimmed and at most `max` characters. */
export function cleanTerminalText(text: string, max = 2000): string {
  const out = text
    .replace(OSC, '')
    .replace(CSI, '')
    .replace(ESC_PAIR, '')
    .replace(BARE_SGR, '')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL, '')
    .replace(BOX_RUN, '—')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return out.length > max ? `${out.slice(0, Math.max(0, max - 1)).trimEnd()}…` : out;
}
