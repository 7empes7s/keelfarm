import { describe, expect, it } from 'vitest';
import { attachedIds, attachmentLines, attachmentProblem, daysLeft, diskProblem, expired, expiry, fileKind, fileLinks, fileType, formatSize, inlineType, isFileId, MAX_FILE_BYTES, MAX_FILES_PER_MESSAGE, MIN_FREE_BYTES, RETENTION_MS, sanitizeName, thumbnailable, uploadStatus } from './files.ts';

const DAY = 24 * 3600_000;

describe('attachment validation', () => {
  it('accepts the kinds a message may carry and refuses the rest', () => {
    expect(fileKind('photo.HEIC')).toBe('image');
    expect(fileKind('clip.mov')).toBe('video');
    expect(fileKind('deck.pptx')).toBe('slides');
    expect(fileKind('data.csv')).toBe('sheet');
    expect(fileKind('notes.md')).toBe('text');
    expect(fileKind('bundle.zip')).toBe('archive');
    expect(fileKind('image', 'image/png')).toBe('image');
    expect(fileKind('setup.exe')).toBeNull();
    expect(fileKind('script.sh', 'text/x-sh')).toBeNull();
  });

  it('refuses too many, too big, empty or the wrong type, with a reason', () => {
    const f = { name: 'a.png', type: 'image/png', size: 10 };
    expect(attachmentProblem([f])).toBeNull();
    expect(attachmentProblem(Array(MAX_FILES_PER_MESSAGE + 1).fill(f))).toMatch(/At most 10/);
    expect(attachmentProblem([f], MAX_FILES_PER_MESSAGE)).toMatch(/At most 10/);
    expect(attachmentProblem([{ ...f, size: 450 * 1024 * 1024 }])).toBeNull();
    expect(attachmentProblem([{ ...f, size: 501 * 1024 * 1024 }])).toMatch(/too big \(501 MB\): files can be at most 500 MB/);
    expect(attachmentProblem([{ ...f, size: MAX_FILE_BYTES + 1 }])).toMatch(/at most 500 MB/);
    expect(attachmentProblem([{ ...f, size: 0 }])).toMatch(/empty/);
    expect(attachmentProblem([{ name: 'virus.exe', size: 5 }])).toMatch(/can't be attached/);
  });

  it('cleans names: no folders, control or reserved characters, bounded length', () => {
    expect(sanitizeName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeName('C:\\Users\\me\\Report "Q3".pdf')).toBe('Report Q3.pdf');
    expect(sanitizeName('a\u0000b<>|?*.txt')).toBe('ab.txt');
    expect(sanitizeName('...')).toBe('file');
    const long = sanitizeName(`${'x'.repeat(300)}.docx`);
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith('.docx')).toBe(true);
  });

  it('serves by extension and only shows images (not SVG), PDFs and video inline', () => {
    expect(fileType('a.pdf', 'text/html')).toBe('application/pdf');
    expect(fileType('weird', 'bad type')).toBe('application/octet-stream');
    expect(inlineType('image/png')).toBe(true);
    expect(inlineType('image/svg+xml')).toBe(false);
    expect(inlineType('application/pdf')).toBe(true);
    expect(inlineType('text/html')).toBe(false);
  });

  it('only takes 24-hex ids', () => {
    expect(isFileId('0123456789abcdef01234567')).toBe(true);
    expect(isFileId('../0123456789abcdef0123')).toBe(false);
    expect(isFileId('0123456789ABCDEF01234567')).toBe(false);
  });
});

describe('retention', () => {
  const at = 1_000_000;
  it('deletes an unkept file 30 days after upload, never a kept one', () => {
    expect(expiry({ at })).toBe(at + RETENTION_MS);
    expect(expired({ at, keep: false }, at + 29 * DAY)).toBe(false);
    expect(expired({ at, keep: false }, at + 30 * DAY)).toBe(true);
    expect(expired({ at, keep: true }, at + 365 * DAY)).toBe(false);
  });

  it('unkeeping restarts nothing: the original expiry, or at once when it has passed', () => {
    expect(expired({ at, keep: false }, at + 10 * DAY)).toBe(false); // unkept on day 10: still day 30
    expect(expired({ at, keep: false }, at + 40 * DAY)).toBe(true); // unkept on day 40: goes now
    expect(daysLeft({ at, keep: false }, at + 10 * DAY)).toBe(20);
    expect(daysLeft({ at, keep: false }, at + 40 * DAY)).toBe(0);
    expect(daysLeft({ at, keep: true }, at)).toBeNull();
  });
});

describe('what the CEO and agents are told', () => {
  it("lists each attachment's path, name and type", () => {
    const text = attachmentLines(
      [
        { name: 'brief.pdf', type: 'application/pdf', size: 2048 },
        { name: 'photo.jpg', type: 'image/jpeg', size: 3 * 1024 * 1024 },
      ],
      (i) => `/store/id${i}`,
    );
    expect(text).toContain('Read');
    expect(text).toContain('- /store/id0 (brief.pdf, application/pdf, 2 KB)');
    expect(text).toContain('- /store/id1 (photo.jpg, image/jpeg, 3.0 MB)');
    expect(attachmentLines([], () => '')).toBe('');
  });

  it('says a video or zip is stored, not readable by the CEO', () => {
    const text = attachmentLines([{ name: 'demo.mp4', type: 'video/mp4', size: 400 * 1024 * 1024 }, { name: 'notes.md', type: 'text/markdown', size: 10 }], (i) => `/store/id${i}`);
    expect(text).toContain('- /store/id0 (demo.mp4, video/mp4, 400 MB; stored, not readable by the CEO)');
    expect(text).toContain('- /store/id1 (notes.md, text/markdown, 10 B)');
  });

  it('finds "Attached: <id>" lines in an issue', () => {
    const a = '0123456789abcdef01234567';
    const b = 'fedcba9876543210fedcba98';
    expect(attachedIds(`Build it.\n\nAttached: ${a}, ${b}\n- Attached: ${a}`)).toEqual([a, b]);
    expect(attachedIds(`See ${a} somewhere`)).toEqual([]);
  });
});

describe('big files (#148)', () => {
  const GB = 1024 ** 3;
  it('keeps 10 GB free on the disk', () => {
    expect(diskProblem(50 * GB, 500 * 1024 ** 2)).toBeNull();
    expect(diskProblem(MIN_FREE_BYTES + 100, 100)).toBeNull();
    expect(diskProblem(MIN_FREE_BYTES + 100, 101)).toMatch(/^That's 101 B, but the office's disk is nearly full \(10\.0 GB free; it keeps 10\.0 GB free\)/);
    expect(diskProblem(8 * GB, 0)).toMatch(/^The office's disk is nearly full.*Delete some files/);
  });

  it('shows sizes in GB from 1 GB', () => {
    expect(formatSize(500 * 1024 ** 2)).toBe('500 MB');
    expect(formatSize(12.4 * GB)).toBe('12.4 GB');
  });

  it("says an upload's bytes, speed and time left", () => {
    const MB = 1024 ** 2;
    expect(uploadStatus(0, 450 * MB, 0)).toBe('0 B of 450 MB');
    expect(uploadStatus(40 * MB, 450 * MB, 10_000)).toBe('40 MB of 450 MB · 4.0 MB/s · 2 min left');
    expect(uploadStatus(440 * MB, 450 * MB, 110_000)).toBe('440 MB of 450 MB · 4.0 MB/s · 3 s left');
  });

  it('draws thumbnails only for images up to 15 MB', () => {
    expect(thumbnailable({ type: 'image/png', size: 2 * 1024 ** 2 })).toBe(true);
    expect(thumbnailable({ type: 'image/png', size: 200 * 1024 ** 2 })).toBe(false);
    expect(thumbnailable({ type: 'video/mp4', size: 10 })).toBe(false);
  });

  it("links Telegram to the office's downloads instead of sending files", () => {
    const f = { id: '0123456789abcdef01234567', name: 'demo.mp4', size: 450 * 1024 ** 2 };
    expect(fileLinks([f], 'http://office.tail1234.ts.net:4317/')).toBe('📎 demo.mp4 (450 MB): http://office.tail1234.ts.net:4317/api/files/0123456789abcdef01234567?download');
    expect(fileLinks([f], '')).toBe("📎 demo.mp4 (450 MB): in the office's Files");
    expect(fileLinks([], 'http://x/')).toBe('');
  });
});
