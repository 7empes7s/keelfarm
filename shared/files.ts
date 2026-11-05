// Files in the CEO chat, their pure rules: what may be attached (type, size, count), how names are cleaned, how long a
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

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_FILES_PER_MESSAGE = 10;
export const RETENTION_MS = 30 * 24 * 3600_000;
/** How often the office looks for expired files. */
export const SWEEP_MS = 24 * 3600_000;

export type FileKind = 'image' | 'video' | 'pdf' | 'document' | 'slides' | 'sheet' | 'text' | 'archive';

const KINDS: Record<string, FileKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', avif: 'image', heic: 'image', heif: 'image', bmp: 'image', svg: 'image',
  mp4: 'video', mov: 'video', webm: 'video', m4v: 'video',
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
  pdf: 'application/pdf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', odt: 'application/vnd.oasis.opendocument.text', rtf: 'application/rtf',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', odp: 'application/vnd.oasis.opendocument.presentation',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ods: 'application/vnd.oasis.opendocument.spreadsheet', csv: 'text/csv', tsv: 'text/tab-separated-values',
  txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', json: 'application/json', log: 'text/plain', yaml: 'text/yaml', yml: 'text/yaml', html: 'text/html',
  zip: 'application/zip',
};

/** What the file picker offers: every extension a message may carry. */
export const ACCEPT = Object.keys(KINDS).map((e) => `.${e}`).join(',') + ',image/*,video/*';

const ext = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';

/** The kind of file by its extension, else its MIME type; null: not something a message may carry. */
export function fileKind(name: string, type = ''): FileKind | null {
  const k = KINDS[ext(name)];
  if (k) return k;
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type === 'application/pdf') return 'pdf';
  return null;
}

/** The MIME type the office serves a file with: from its extension (never trusting the browser's guess for that), else the given one. */
export function fileType(name: string, given = ''): string {
  return MIME[ext(name)] ?? (/^[\w.+-]+\/[\w.+-]+$/.test(given) ? given : 'application/octet-stream');
}

/** Shown in the browser rather than downloaded: images (not SVG, which can run script), PDFs and videos. */
export const inlineType = (type: string) => (type.startsWith('image/') && type !== 'image/svg+xml') || type === 'application/pdf' || type.startsWith('video/');

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

/** A size for people: "820 B", "14 KB", "3.2 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`;
}

/** Why these files can't go in one message, or null when they can: the count, then each one's type and size. */
export function attachmentProblem(files: readonly { name: string; type?: string; size: number }[], already = 0): string | null {
  if (files.length + already > MAX_FILES_PER_MESSAGE) return `At most ${MAX_FILES_PER_MESSAGE} files per message.`;
  for (const f of files) {
    if (!fileKind(f.name, f.type)) return `${sanitizeName(f.name)}: that kind of file can't be attached. Images, videos, PDFs, office documents, text, CSV, JSON and zip files can.`;
    if (f.size > MAX_FILE_BYTES) return `${sanitizeName(f.name)} is too big (${formatSize(f.size)}): files can be at most ${formatSize(MAX_FILE_BYTES)}.`;
    if (f.size <= 0) return `${sanitizeName(f.name)} is empty.`;
  }
  return null;
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

/** The lines added to the manager's message for the CEO: each attachment's absolute path, name and type, to read with Read. */
export function attachmentLines(files: readonly Pick<FileRef, 'name' | 'type' | 'size'>[], pathOf: (i: number) => string): string {
  if (!files.length) return '';
  return ['Attached (read with Read; a file\'s name in the store is its file id):', ...files.map((f, i) => `- ${pathOf(i)} (${f.name}, ${f.type}, ${formatSize(f.size)})`)].join('\n');
}

/** The store ids an issue body hands to its agents: "Attached: <id>[, <id>…]" lines. */
export function attachedIds(body: string): string[] {
  const ids = new Set<string>();
  for (const line of body.matchAll(/^\s*[-*]?\s*Attached:\s*(.+)$/gim)) for (const id of line[1].match(/\b[a-f0-9]{24}\b/g) ?? []) ids.add(id);
  return [...ids];
}
