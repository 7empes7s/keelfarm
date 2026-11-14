// Files in the CEO chat, their pure rules: what may be attached (any type; size and count), how names are cleaned, how long a
// file stays on the office server (30 days unless kept), what the CEO is told about the manager's attachments, and
// which files an issue hands to its agents ("Attached: <file id>").

/** A file in the office's files store, as a phone message refers to it. The bytes never travel in the snapshot. */
export interface FileRef {
  id: string;
  name: string;
  type: string; // MIME type
  size: number; // bytes
  from: 'manager' | 'ceo' | 'agent';
  at: number; // uploaded, epoch ms: it's deleted RETENTION_MS later unless kept
  keep: boolean;
}

/** A file in the Files list: its ref, why it's kept, and when it goes (null: kept). */
export interface FileView extends FileRef {
  keepReason?: string;
  expiresAt: number | null;
}

export const MAX_FILE_BYTES = 500 * 1024 * 1024;
/** Uploads and copies are refused while the disk has less than this free after them (#148). */
export const MIN_FREE_BYTES = 10 * 1024 * 1024 * 1024;
/** Images up to this size get a thumbnail in a bubble; bigger ones show as a chip, drawn only when opened. */
const THUMB_MAX_BYTES = 15 * 1024 * 1024;
export const MAX_FILES_PER_MESSAGE = 10;
export const RETENTION_MS = 30 * 24 * 3600_000;
/** How often the office looks for expired files. */
export const SWEEP_MS = 24 * 3600_000;

/** 'file': anything else, kept as it is and only ever downloaded (#660). */
export type FileKind = 'image' | 'video' | 'audio' | 'pdf' | 'document' | 'slides' | 'sheet' | 'text' | 'archive' | 'file';

const KINDS: Record<string, FileKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', avif: 'image', heic: 'image', heif: 'image', bmp: 'image', svg: 'image',
  mp4: 'video', mov: 'video', webm: 'video', m4v: 'video',
  m4a: 'audio', mp3: 'audio', wav: 'audio', aac: 'audio', ogg: 'audio', opus: 'audio', flac: 'audio', caf: 'audio',
  pdf: 'pdf',
  doc: 'document', docx: 'document', odt: 'document', rtf: 'document', pages: 'document',
  ppt: 'slides', pptx: 'slides', odp: 'slides', key: 'slides',
  xls: 'sheet', xlsx: 'sheet', ods: 'sheet', csv: 'sheet', tsv: 'sheet', numbers: 'sheet',
  txt: 'text', md: 'text', markdown: 'text', json: 'text', log: 'text', yaml: 'text', yml: 'text', html: 'text',
  zip: 'archive',
};

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp', svg: 'image/svg+xml',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/mp4',
  m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', caf: 'audio/x-caf',
  pdf: 'application/pdf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', odt: 'application/vnd.oasis.opendocument.text', rtf: 'application/rtf',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', odp: 'application/vnd.oasis.opendocument.presentation',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ods: 'application/vnd.oasis.opendocument.spreadsheet', csv: 'text/csv', tsv: 'text/tab-separated-values',
  txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', json: 'application/json', log: 'text/plain', yaml: 'text/yaml', yml: 'text/yaml', html: 'text/html',
  zip: 'application/zip',
};

const ext = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';

/** The kind of file by its extension, else its MIME type, else 'file'. */
export function fileKind(name: string, type = ''): FileKind {
  const k = KINDS[ext(name)];
  if (k) return k;
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type === 'application/pdf') return 'pdf';
  return 'file';
}

/** Raster images a browser draws without running anything: the only ones shown inline or as thumbnails. */
const SAFE_IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp', 'image/heic', 'image/heif']);

/**
 * The MIME type the office serves a file with: from its extension (never trusting the browser's guess for that), else
 * the given one only when it is a safe image, audio, video or PDF; anything else is application/octet-stream (#660).
 */
export function fileType(name: string, given = ''): string {
  const known = MIME[ext(name)];
  if (known) return known;
  const safe = /^(audio|video)\/[\w.+-]+$/.test(given) || SAFE_IMAGES.has(given) || given === 'application/pdf';
  return safe ? given : 'application/octet-stream';
}

/** Shown in the browser rather than downloaded: safe images (not SVG, which can run script), PDFs, videos and audio. */
export const inlineType = (type: string) => SAFE_IMAGES.has(type) || type === 'application/pdf' || type.startsWith('video/') || type.startsWith('audio/');

/** A file name safe to save and show: no folders, control or reserved characters, at most 120 characters. */
export function sanitizeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const printable = [...base].filter((c) => c.charCodeAt(0) > 31 && c.charCodeAt(0) !== 127).join('');
  let n = printable.replace(/[<>:"|?*]/g, '').replace(/\s+/g, ' ').trim().replace(/^[.\s]+|[.\s]+$/g, '');
  if (n.length > 120) {
    const e = ext(n);
    n = e && e.length < 10 ? `${n.slice(0, 119 - e.length).trimEnd()}.${e}` : n.slice(0, 120);
  }
  return n || 'file';
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** A size for people: "820 B", "14 KB", "3.2 MB", "12.4 GB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`;
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  return `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`;
}

/** Why these files can't go in one message, or null when they can: the count, then each one's type and size. */
export function attachmentProblem(files: readonly { name: string; type?: string; size: number }[], already = 0): string | null {
  if (files.length + already > MAX_FILES_PER_MESSAGE) return `At most ${MAX_FILES_PER_MESSAGE} files per message.`;
  for (const f of files) {
    if (f.size > MAX_FILE_BYTES) return `${sanitizeName(f.name)} is too big (${formatSize(f.size)}): files can be at most ${formatSize(MAX_FILE_BYTES)}.`;
    if (f.size <= 0) return `${sanitizeName(f.name)} is empty.`;
  }
  return null;
}

/** Why the disk can't take `incoming` more bytes (it would leave less than MIN_FREE_BYTES free), or null when it can. */
export function diskProblem(free: number, incoming: number, reserve = MIN_FREE_BYTES): string | null {
  if (free - incoming >= reserve) return null;
  const need = incoming > 0 ? `That's ${formatSize(incoming)}, but the` : 'The';
  return `${need} office's disk is nearly full (${formatSize(Math.max(0, free))} free; it keeps ${formatSize(reserve)} free). Delete some files in Files, or free space on the server, then try again.`;
}

/** An upload's line under its progress bar: "120 MB of 450 MB · 4.1 MB/s · 1 min left" (speed once a second has passed). */
export function uploadStatus(loaded: number, total: number, elapsedMs: number): string {
  const done = `${formatSize(loaded)} of ${formatSize(total)}`;
  if (elapsedMs < 1000 || loaded <= 0) return done;
  const rate = loaded / (elapsedMs / 1000);
  const left = Math.max(0, (total - loaded) / rate);
  const eta = left < 60 ? `${Math.ceil(left)} s left` : `${Math.ceil(left / 60)} min left`;
  return `${done} · ${formatSize(Math.round(rate))}/s · ${eta}`;
}

/** Images small enough to draw as a thumbnail in a bubble. */
export const thumbnailable = (f: Pick<FileRef, 'type' | 'size'>) => SAFE_IMAGES.has(f.type) && f.size <= THUMB_MAX_BYTES;

/**
 * A message's files as Telegram text: a download link on the office for each (the bot sends no files, and Telegram
 * refuses any over 50 MB), or, with no office address set, where to find them.
 */
export function fileLinks(files: readonly Pick<FileRef, 'id' | 'name' | 'size'>[], officeUrl: string): string {
  return files
    .map((f) => {
      const where = officeUrl ? new URL(`api/files/${f.id}?download`, officeUrl.replace(/\/*$/, '/')).href : "in the office's Files";
      return `📎 ${f.name} (${formatSize(f.size)}): ${where}`;
    })
    .join('\n');
}

/** Store ids: 24 hex characters, nothing that could be a path. */
export const isFileId = (id: string) => /^[a-f0-9]{24}$/.test(id);

// ---------- retention ----------

/** When an unkept file is deleted: 30 days after upload. Keeping it and unkeeping it later never moves this. */
export const expiry = (f: Pick<FileRef, 'at'>) => f.at + RETENTION_MS;

/** The sweep's decision: an unkept file past its expiry goes; a kept file never does. */
export const expired = (f: Pick<FileRef, 'at' | 'keep'>, now: number) => !f.keep && now >= expiry(f);

/** Whole days until an unkept file is deleted (0: today, or overdue); null when kept. */
export const daysLeft = (f: Pick<FileRef, 'at' | 'keep'>, now: number) => (f.keep ? null : Math.max(0, Math.ceil((expiry(f) - now) / (24 * 3600_000))));

// ---------- what the CEO and agents are told ----------

/** Files the CEO can read with Read: images, PDFs and text. Videos, audio, office files, zips and the rest are only stored. */
const ceoReadable = (f: Pick<FileRef, 'name' | 'type'>) => ['image', 'pdf', 'text'].includes(fileKind(f.name, f.type));

/** The lines added to the manager's message for the CEO: each attachment's absolute path, name and type, to read with Read. */
export function attachmentLines(files: readonly Pick<FileRef, 'name' | 'type' | 'size'>[], pathOf: (i: number) => string): string {
  if (!files.length) return '';
  return [
    'Attached (read with Read; a file\'s name in the store is its file id):',
    ...files.map((f, i) => `- ${pathOf(i)} (${f.name}, ${f.type}, ${formatSize(f.size)}${ceoReadable(f) ? '' : '; stored, not readable by the CEO'})`),
  ].join('\n');
}

/** The store ids an issue body hands to its agents: "Attached: <id>[, <id>…]" lines. */
export function attachedIds(body: string): string[] {
  const ids = new Set<string>();
  for (const line of body.matchAll(/^\s*[-*]?\s*Attached:\s*(.+)$/gim)) for (const id of line[1].match(/\b[a-f0-9]{24}\b/g) ?? []) ids.add(id);
  return [...ids];
}
