// The CEO chat's files and "Used" line on the Swarm's side: what the CEO attached and called since its last phone
// message, the manager's attachments checked against the store, attach_file / keep_file, the issue prompts' file
// lines and the "/" picks. Kept out of swarm.ts; the store itself is files.ts.

import os from 'node:os';
import { attachedIds, attachmentLines, MAX_FILES_PER_MESSAGE, type FileRef } from '../shared/files.ts';
import type { PhoneMessage } from '../shared/types.ts';
import { groupUsed, toolCalls, type QuickPicks, type ToolCall } from '../shared/used.ts';
import { checkAttachPath, type FileStore } from './files.ts';
import { HttpError } from './httpError.ts';

export class CeoFiles {
  private attachments: FileRef[] = []; // attach_file's files, sent with the CEO's next phone message
  private calls: ToolCall[] = []; // the CEO's tool calls since its last phone message, for "Used"

  /** `ceoDir`: the CEO's folder, where it may attach files from (with the temp folder and the store). */
  constructor(
    readonly store: FileStore,
    private ceoDir: string,
  ) {}

  /** The CEO's session log entries, for its tool calls. */
  record(entries: Parameters<typeof toolCalls>[0]) {
    this.calls.push(...toolCalls(entries));
  }

  /** Files attached since the CEO's last reply. */
  pending(): boolean {
    return this.attachments.length > 0;
  }

  /** The next CEO reply's attachments and "Used" line, taken. */
  takeReply(): Pick<PhoneMessage, 'attachments' | 'used'> {
    const attachments = this.attachments.splice(0);
    const used = groupUsed(this.calls.splice(0));
    return { ...(attachments.length && { attachments }), ...(used && { used }) };
  }

  /** The CEO's job ended. */
  endJob() {
    this.calls = [];
  }

  /** The manager's message's files, as refs; refuses a message with too many, or one the store no longer has. */
  managerFiles(ids: readonly string[]): FileRef[] {
    if (ids.length > MAX_FILES_PER_MESSAGE) throw new HttpError(400, `At most ${MAX_FILES_PER_MESSAGE} files per message`);
    return ids.map((id) => {
      const f = this.store.get(id);
      if (!f) throw new HttpError(400, 'An attached file is no longer saved: attach it again');
      const { keepReason: _, ...ref } = f;
      return ref;
    });
  }

  /** The block forwarded to the CEO with the manager's files. */
  forwardLines(files: readonly FileRef[]): string {
    return attachmentLines(files, (i) => this.store.pathOf(files[i].id));
  }

  /** attach_file: copies a file the CEO made into the store, for its next phone message. */
  async attach(a: { path: string }): Promise<string> {
    if (this.attachments.length >= MAX_FILES_PER_MESSAGE) throw new Error(`At most ${MAX_FILES_PER_MESSAGE} files per message: send this reply first.`);
    const ok = await checkAttachPath(a.path, [this.ceoDir, os.tmpdir(), this.store.root]);
    const f = await this.store.addCopy(ok.real, { name: ok.name, from: 'ceo' });
    this.attachments.push(f);
    return `Attached ${f.name} (file id ${f.id}). It goes with your next message and is deleted after 30 days unless kept (keep_file). Agents can read it when an issue says "Attached: ${f.id}".`;
  }

  /** keep_file: keep a file past its 30 days, or let it go again. */
  keep(a: { id: string; keep: boolean; reason: string }): string {
    const f = this.store.get(a.id);
    if (!f) throw new Error(`No file ${a.id}: it expired or was deleted, so there is nothing to keep.`);
    this.store.setKeep(f.id, a.keep, a.reason);
    return a.keep ? `${f.name} is kept until someone unkeeps or deletes it.` : `${f.name} is no longer kept: it goes 30 days after it was uploaded.`;
  }

  /** The store files an issue hands its agents ("Attached: <id>"), as prompt lines with their local paths. */
  issueLines(body: string | undefined): string {
    const files = attachedIds(body ?? '')
      .map((id) => this.store.get(id))
      .filter((f) => f !== undefined);
    if (!files.length) return '';
    return ['Files attached to the issue (read only; they live outside your worktree):', ...files.map((f) => `- ${this.store.pathOf(f.id)} (${f.name}, ${f.type})`)].join('\n');
  }
}

/** The "/" list: the manager's installed skills and apps plus the connectors and skills the CEO has used lately. */
export function quickPicks(installed: QuickPicks, messages: readonly PhoneMessage[]): QuickPicks {
  const used = messages.flatMap((m) => m.used?.connectors.map((c) => c.name) ?? []).filter((n) => n !== 'Office');
  const skills = messages.flatMap((m) => m.used?.skills ?? []).filter((n) => n !== 'a skill');
  return { skills: [...new Set([...installed.skills, ...skills])].sort(), apps: [...new Set([...installed.apps, ...used])].sort() };
}
