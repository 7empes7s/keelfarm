// The demo's agent chats (#120): a fake session's scripted terminal lines, read back as the transcript events a real
// Claude Code session would write (shared/agentChat.ts), so the chat view shows reads, edits, test runs and a PR live.
// A Codex or OpenCode agent, or a cloud one, gets none: their window falls back to the terminal, as in a real office.
import path from 'node:path';
import type { TranscriptEvent } from '../shared/agentChat.ts';
import type { LogEntry, SessionCallbacks, SessionOptions } from './agentRunner.ts';

const many = (n: number, word: string) => Array.from({ length: n }, (_, i) => `${word} ${i + 1}`).join('\n');

/** A scripted tool line ("⏺ Read src/App.tsx", "⏺ $ npm test") as the tool call's input. */
function demoToolInput(cwd: string, tool: string, text: string): Record<string, unknown> {
  const rest = text.replace(/^⏺\s*/, '').replace(/^🌐\s*\w+\s*/, '');
  const arg = rest.replace(/^\w+\s+/, '');
  switch (tool) {
    case 'Bash':
      return { command: rest.replace(/^\$\s*/, '') };
    case 'Read':
      return { file_path: path.join(cwd, arg) };
    case 'Edit':
      return { file_path: path.join(cwd, arg), old_string: many(3, 'old line'), new_string: many(8, 'new line') };
    case 'Write':
      return { file_path: path.join(cwd, arg), content: many(24, 'line') };
    case 'Grep':
      return { pattern: arg.replace(/^"|"$/g, '') };
    case 'Glob':
      return { pattern: arg };
    case 'mcp__playwright__browser_navigate':
      return { url: rest };
    case 'mcp__playwright__browser_click':
      return { element: rest.replace(/^"|"$/g, '') };
  }
  return {};
}

/** A batch of a fake session's lines as transcript events; `open`: the tool call still waiting for its result, updated. */
export function demoEvents(cwd: string, entries: readonly LogEntry[], open: { id: string | null; n: number }, now = Date.now()): TranscriptEvent[] {
  const out: TranscriptEvent[] = [];
  let results: string[] = [];
  const settle = (error = false) => {
    if (open.id && (results.length || error)) {
      out.push({ kind: 'result', t: now, id: open.id, text: results.join('\n'), error });
      open.id = null;
    }
    results = [];
  };
  for (const e of entries) {
    if (e.kind === 'result') results.push(e.text.replace(/^\s*⎿\s?/, '').trim());
    else if (e.kind === 'error' && open.id) {
      results.push(e.text.replace(/^\s*⎿\s?/, ''));
      settle(true);
    } else if (e.kind === 'tool' && e.tool) {
      settle();
      if (open.id) out.push({ kind: 'result', t: now, id: open.id, text: '', error: false });
      open.id = `demo-tool-${++open.n}`;
      out.push({ kind: 'tool', t: now, id: open.id, name: e.tool, input: demoToolInput(cwd, e.tool, e.text) });
    } else if (e.kind === 'text') {
      settle();
      const text = e.text.replace(/^●\s*/, '').trim();
      // one message in each build arrives already reacted to, so a demo chat shows a reaction
      if (text) out.push({ kind: 'text', t: now, text, ...(/single hook/.test(text) && { reactions: ['👍' as const] }) });
    }
  }
  settle();
  return out;
}

/** Tool ids count on across sessions: a later session's results must not land on an earlier one's steps. */
let toolIds = 0;

/** A fake session's callbacks that also feed its chat, for a Claude Code agent on this computer. */
export function withDemoChat(opts: SessionOptions, cb: SessionCallbacks): SessionCallbacks {
  if ((opts.cli ?? 'claude') !== 'claude' || opts.box || opts.role === 'ceo') return cb;
  const open = { id: null as string | null, n: toolIds };
  cb.chat?.([{ kind: 'prompt', t: Date.now(), text: opts.prompt }]);
  return {
    ...cb,
    log: (entries) => {
      cb.log(entries);
      const events = demoEvents(opts.cwd, entries, open);
      toolIds = Math.max(toolIds, open.n);
      if (events.length) cb.chat?.(events);
    },
    finished: (r) => {
      if (open.id) cb.chat?.([{ kind: 'result', t: Date.now(), id: open.id, text: '', error: !r.ok }]);
      open.id = null;
      cb.finished(r);
    },
  };
}
