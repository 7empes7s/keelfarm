// Terminal wiring shared by keeper, fallback and Box PTYs. Consume program status before mirroring output.
import type { AgentTerminal } from './terminal.ts';
import type { Pty } from './ptyClient.ts';
import type { OfficeTools } from './ceo.ts';
import { parseProgramStatus, type ProgramStatus } from './programStatus.ts';

interface WiredCli {
  term: AgentTerminal;
  proc: Pty | null;
  token: string;
  lastData?: number;
  lastHook?: number;
  programStatus?: ProgramStatus & { at: number };
  session: { hook(b: Record<string, unknown>): Record<string, unknown>; exited(code: number): void } | null;
}

/** A CLI is running in its terminal: its output, its keys and its hooks are connected. */
export function wireCli<T extends WiredCli>(l: T, ctx: {
  lives: Map<AgentTerminal, T>;
  routes: Map<string, { hook(b: Record<string, unknown>): Record<string, unknown>; office?: OfficeTools }>;
  office?: OfficeTools;
  idleHook(l: T, b: Record<string, unknown>): Record<string, unknown>;
  endLive(l: T): Promise<void>;
  quietly(fn: () => void): void;
}) {
  const { lives, routes, office, idleHook, endLive, quietly } = ctx;
  const p = l.proc!;
  lives.set(l.term, l);
  routes.set(l.token, { hook: (b) => {
    l.lastHook = Date.now();
    return l.session ? l.session.hook(b) : idleHook(l, b);
  }, office });
  l.term.bind({ write: (d) => quietly(() => p.write(d)), resize: (c, r) => quietly(() => p.resize(c, r)) });
  let stream: ReturnType<typeof parseProgramStatus>['state'] | undefined;
  p.onData((data) => {
    if (lives.get(l.term) !== l) return;
    l.lastData = Date.now();
    const parsed = parseProgramStatus(stream, data);
    stream = parsed.state;
    for (const status of parsed.statuses) l.programStatus = { ...status, at: l.lastData };
    l.term.write(parsed.text);
  });
  p.onExit((code) => {
    l.proc = null;
    if (lives.get(l.term) !== l) return; // already replaced or closed
    if (l.session) l.session.exited(code);
    else void endLive(l); // quit while waiting at its prompt
  });
}

