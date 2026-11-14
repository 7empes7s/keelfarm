// The CEO's context files (#663): NOTES.md grew past what the Read tool takes (256 KB) and the CEO couldn't read its
// notes. Before each job the office keeps the CURRENT part in the file and appends the rest (what sits under the
// "ARCHIVE BELOW" line, else whatever doesn't fit) to <name>-archive.md, never losing a line. splitNotes is pure.
import fs from 'node:fs';
import path from 'node:path';

/** Past this size a context file is split. */
const NOTES_SPLIT_BYTES = 150_000;
const MARK = /ARCHIVE BELOW/i;

/** NOTES.md's archive: NOTES-archive.md next to it. */
export const archiveFileOf = (file: string) => path.join(path.dirname(file), `${path.basename(file, path.extname(file))}-archive${path.extname(file) || '.md'}`);

const pointer = (archive: string) => `ARCHIVE BELOW: older notes moved to ${archive} (Grep it; append, never rewrite it)`;

/** What stays (`current`) and what moves to the archive, or null when the text is small enough. Every line ends up in one of them. */
export function splitNotes(text: string, max = NOTES_SPLIT_BYTES, archiveName = 'NOTES-archive.md'): { current: string; archive: string } | null {
  if (Buffer.byteLength(text) <= max) return null;
  const all = text.split(/\r?\n/);
  const at = all.findIndex((l) => MARK.test(l));
  const head = at < 0 ? all : all.slice(0, at);
  const tail = at < 0 ? [] : all.slice(at); // the marker line goes too: the pointer replaces it
  const tip = pointer(archiveName);
  let size = Buffer.byteLength(tip) + 1;
  let keep = 0;
  while (keep < head.length && size + Buffer.byteLength(head[keep]) + 1 <= max) size += Buffer.byteLength(head[keep++]) + 1;
  const moved = [...head.slice(keep), ...tail].filter((l, i, xs) => !(i === xs.length - 1 && l === '') && !(l.startsWith('ARCHIVE BELOW: older notes moved to')));
  return { current: [...head.slice(0, keep), tip].join('\n') + '\n', archive: moved.join('\n') };
}

/** Splits `file` when it passed `max`; true when it did. A missing file is fine. */
export function tidyContextFile(file: string, max = NOTES_SPLIT_BYTES): boolean {
  let text: string;
  try {
    if (fs.statSync(file).size <= max) return false;
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  const archive = archiveFileOf(file);
  const s = splitNotes(text, max, path.basename(archive));
  if (!s) return false;
  if (s.archive.trim()) fs.appendFileSync(archive, `\n${s.archive}\n`); // first: a crash after it leaves a duplicate, never a loss
  fs.writeFileSync(`${file}.tmp`, s.current);
  fs.renameSync(`${file}.tmp`, file);
  return true;
}
