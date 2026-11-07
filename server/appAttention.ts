// Whether the manager is in the app (#210): each open tab's attention, for the notifier's quiet, and the CEO
// messages whose notifications wait, so a bubble can say its notification wasn't sent.
import { parseAttention, type TabAttention } from './notify.ts';

/** An open /ws connection, as far as attention cares: closed ones are forgotten. */
type Tab = { readyState: number; OPEN: number };

const MAX_WAITING = 50;

export class AppAttention {
  private tabs = new Map<Tab, TabAttention>();
  private waiting = new Map<string, number>();

  /** Handles a tab's attention message; false for anything else on /ws. */
  receive(tab: Tab, raw: unknown, now = Date.now()): boolean {
    const att = parseAttention(raw);
    if (att) this.tabs.set(tab, { visible: att.visible, at: now, ...(att.call && { call: true }) });
    return !!att;
  }

  /** The open tabs' attention. */
  all(): TabAttention[] {
    for (const tab of this.tabs.keys()) if (tab.readyState !== tab.OPEN) this.tabs.delete(tab);
    return [...this.tabs.values()];
  }

  /** Remembers the CEO message a notice is about (the newest MAX_WAITING). */
  link(noticeId: string, messageId: number) {
    this.waiting.set(noticeId, messageId);
    if (this.waiting.size > MAX_WAITING) this.waiting.delete(this.waiting.keys().next().value!);
  }

  /** The CEO messages of these notices, forgotten as they're taken. */
  take(noticeIds: string[]): number[] {
    const out: number[] = [];
    for (const id of noticeIds) {
      const m = this.waiting.get(id);
      if (m !== undefined) out.push(m);
      this.waiting.delete(id);
    }
    return out;
  }
}
