// Chat mode (#120): whether an agent's window opens on their chat or their terminal. One choice per device, made by the
// window's Chat | Terminal switch, Settings or the HUD's toggle; phones start on chat. A coding agent with no transcript
// to read (Codex, OpenCode, a cloud machine's CLI) always shows the terminal, with a note.
import { create } from 'zustand';
import type { AgentView, QaView, SwarmSettings } from '../../../shared/types';
import { workerCli } from './floorRows';
import { PHONE_WINDOW_QUERY } from './termLayout';

const PREF = 'cubefarm:chatMode';

export type AgentPane = 'chat' | 'terminal';

/** The saved choice ('on' / 'off'), else chat on a phone. */
export function initialChatMode(saved: string | null, phone: boolean): boolean {
  return saved === 'on' ? true : saved === 'off' ? false : phone;
}

/** Why their chat can't be shown (null: it can): the office reads only Claude Code's transcripts on this computer. */
export function chatUnavailable(a: Pick<AgentView, 'cli' | 'role' | 'host'>, settings: Pick<SwarmSettings, 'runtime' | 'defaultCli'>): string | null {
  if (a.role === 'ceo') return 'The CEO talks to you in the chat.';
  const cli = workerCli(a, settings);
  if (cli !== 'claude') return `Chat needs Claude Code's transcript, and ${cli === 'codex' ? 'Codex' : 'OpenCode'} doesn't write one the office reads: showing the terminal.`;
  if (a.host === 'box') return "Chat isn't available for cloud agents yet: showing the terminal.";
  return null;
}

/** The pane a window shows: what it was opened on, else the device's choice; the terminal when there's no chat. */
export function paneFor(opened: AgentPane | undefined, chatMode: boolean, unavailable: string | null): AgentPane {
  if (unavailable) return 'terminal';
  return opened ?? (chatMode ? 'chat' : 'terminal');
}

function read(): boolean {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(PREF);
  } catch {
    // private mode
  }
  return initialChatMode(saved, typeof matchMedia === 'function' && matchMedia(PHONE_WINDOW_QUERY).matches);
}

export const useChatMode = create<{ on: boolean; set: (on: boolean) => void }>((set) => ({
  on: read(),
  set: (on) => {
    set({ on });
    try {
      localStorage.setItem(PREF, on ? 'on' : 'off');
    } catch {
      // private mode: just this visit
    }
  },
}));

/** A PR's live state as a chip in the chat (its milestone card and the verdict card): QA's status, or merged. */
export function prChip(qa: Pick<QaView, 'status' | 'round'> | undefined, merged: boolean): { icon: string; label: string; tone: 'good' | 'bad' | 'warn' | 'plain'; verdict: boolean } {
  if (merged) return { icon: '🎉', label: 'Merged', tone: 'good', verdict: true };
  switch (qa?.status) {
    case 'passed':
      return { icon: '✅', label: `QA passed · round ${qa.round}`, tone: 'good', verdict: true };
    case 'failed':
      return { icon: '❌', label: `QA failed · round ${qa.round}`, tone: 'bad', verdict: true };
    case 'fixing':
      return { icon: '🔧', label: `Fix round ${qa.round}`, tone: 'warn', verdict: true };
    case 'needs-human':
      return { icon: '✋', label: 'Needs you', tone: 'bad', verdict: true };
    case 'testing':
      return { icon: '🔍', label: `QA testing · round ${qa.round}`, tone: 'warn', verdict: false };
    case 'queued':
      return { icon: '⏳', label: 'Waiting for QA', tone: 'plain', verdict: false };
  }
  return { icon: '•', label: 'Opened', tone: 'plain', verdict: false };
}
