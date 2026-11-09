// OSC 7501 rev 0.4: bounded stream decoding before terminal output reaches the mirror or saved logs.
import { stripVTControlCharacters } from 'node:util';
import { redact } from '../shared/journal.ts';
import type { WatchdogStep } from './unblock.ts';

const PREFIX = '\x1b]7501;';
const MAX_BYTES = 4096;
const HOOK_QUIET_MS = 10_000;
const STATES = ['idle', 'working', 'waiting', 'blocked', 'done', 'clear'] as const;

export interface ProgramStatus {
  state: (typeof STATES)[number];
  app?: string;
  msg?: string;
}

export interface StatusStream {
  mode: 'text' | 'status' | 'drop';
  pending: string;
  bytes: number;
  escape: boolean;
}

function record(body: string): ProgramStatus | null {
  const fields = new Map(body.split(':').map((field) => {
    const at = field.indexOf('=');
    return [field.slice(0, at), field.slice(at + 1)];
  }));
  const state = fields.get('state');
  // Child agents must not change their parent's state. Capability probes are consumed, not interpreted as status.
  if (!STATES.some((s) => s === state) || fields.get('id')) return null;
  const out: ProgramStatus = { state: state as ProgramStatus['state'] };
  if (fields.has('app')) out.app = fields.get('app');
  const msg = fields.get('msg');
  if (msg && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(msg)) out.msg = Buffer.from(msg, 'base64').toString('utf8');
  return out;
}

/** Pure incremental parser: unknown fields disappear; other escape sequences pass through unchanged. */
export function parseProgramStatus(previous: StatusStream | undefined, chunk: string): { state: StatusStream; text: string; statuses: ProgramStatus[] } {
  const state: StatusStream = previous ? { ...previous } : { mode: 'text', pending: '', bytes: 0, escape: false };
  let text = '';
  const statuses: ProgramStatus[] = [];
  for (const ch of chunk) {
    if (state.mode === 'text') {
      state.pending += ch;
      while (state.pending && !PREFIX.startsWith(state.pending)) {
        text += state.pending[0];
        state.pending = state.pending.slice(1);
      }
      if (state.pending === PREFIX) {
        state.mode = 'status';
        state.bytes = Buffer.byteLength(PREFIX);
        state.escape = false;
      }
      continue;
    }
    const end = ch === '\x07' || (state.escape && ch === '\\');
    state.bytes += Buffer.byteLength(ch);
    if (state.mode === 'status' && state.bytes <= MAX_BYTES) {
      state.pending += ch;
      if (end) {
        const status = record(state.pending.slice(PREFIX.length, ch === '\x07' ? -1 : -2));
        if (status) statuses.push(status);
      }
    } else {
      state.mode = 'drop';
      state.pending = '';
    }
    state.escape = ch === '\x1b';
    if (end) Object.assign(state, { mode: 'text', pending: '', bytes: 0, escape: false });
    // A never-terminated record keeps no payload or growing byte count after the cap.
    if (state.mode === 'drop') state.bytes = MAX_BYTES + 1;
  }
  return { state, text, statuses };
}

/** Decoded terminal text is untrusted: strip controls, scrub secrets, then bound the status line. */
export function statusReason(status: ProgramStatus, secrets: readonly string[] = []): string {
  const msg = redact(stripVTControlCharacters(status.msg ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' '), secrets).replace(/\s+/g, ' ').trim();
  return msg.slice(0, 200) || 'the coding agent is waiting for input';
}

/** Hooks remain primary forever for an older record; a newer record gets a short grace period for hooks to arrive. */
export function programStatusStep(status: (ProgramStatus & { at: number }) | undefined, lastHook: number, now: number, secrets: readonly string[] = []): WatchdogStep {
  if (!status || status.at <= lastHook || now - lastHook < HOOK_QUIET_MS || (status.state !== 'waiting' && status.state !== 'blocked')) return { do: 'wait' };
  return { do: 'blocked', reason: statusReason(status, secrets) };
}
