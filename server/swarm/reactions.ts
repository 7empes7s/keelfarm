// The CEO chat's reactions (#118): the status reaction under the manager's messages as the CEO's job on them moves,
// the CEO's react and reply tools, the manager's reactions (👍 / 👎 on a CEO reply become feedback for its next job),
// and their Telegram side; and the threads' edits and library (#132).
import { HttpError } from '../httpError.ts';
import { CEO_REACTIONS, feedbackLine, isOpen, isReaction, nextStatus, react, reactTarget, telegramReaction, type StatusEvent } from '../../shared/reactions.ts';
import { nextDelivery } from '../../shared/chat.ts';
import { spokenOf } from '../../shared/speech.ts';
import { conversationPatch, conversationsView, editConversation } from '../../shared/conversations.ts';
import type { CeoChat } from '../ceoChat.ts';
import type { MessageReaction, PhoneMessage, ServerDelivery, ServerEvent, StatusReaction } from '../../shared/types.ts';
import { SwarmUpdate } from './update.ts';

export abstract class SwarmReactions extends SwarmUpdate {
  protected ceoFeedback: string[] = []; // for the CEO's next job: the manager's 👍 / 👎 on its replies

  /** Read on one device: the notifications are cancelled or cleared on every other (#210). */
  protected override observe(ev: ServerEvent) {
    super.observe(ev);
    if (ev.type === 'noticesRead') this.notifier.readNotices(ev.ids);
    else if (ev.type === 'phoneRead') this.notifier.readTab('chat');
  }

  /** CEO messages whose notification wasn't sent, as the manager was in the app: their bubbles say so (#210). */
  protected markQuiet(messageIds: number[]) {
    const quiet = this.state.messages.filter((m) => messageIds.includes(m.id) && !m.quiet);
    for (const m of quiet) this.broadcast({ type: 'ceoChat', message: Object.assign(m, { quiet: true }) });
    if (quiet.length) this.save();
  }

  /** Moves the manager's messages along (shared/chat.ts nextDelivery; read: their status too) and tells the phones which ones moved. */
  protected markDelivery(ids: readonly number[] | 'all', ev: 'read' | 'replied') {
    if (ev === 'read' && ids !== 'all') this.markStatus(ids, 'read');
    const moved: number[] = [];
    let to: ServerDelivery | null = null;
    for (const m of this.state.messages) {
      if (m.from !== 'manager' || !m.delivery || (ids !== 'all' && !ids.includes(m.id))) continue;
      const next = nextDelivery(m.delivery, ev);
      if (next === m.delivery) continue;
      m.delivery = next as ServerDelivery;
      to = m.delivery;
      moved.push(m.id);
    }
    if (!to) return;
    this.broadcast({ type: 'delivery', ids: moved, delivery: to });
    this.save();
  }

  /** Moves the status reaction of the manager's messages (`open`: those the CEO has in hand; shared/reactions.ts) and tells the phones and Telegram. Off unless Settings → Status reactions (#193). */
  protected markStatus(ids: readonly number[] | 'open', ev: StatusEvent) {
    if (!this.state.settings.statusReactions) return;
    const moved = new Map<StatusReaction, PhoneMessage[]>();
    for (const m of this.state.messages) {
      if (m.from !== 'manager' || (ids === 'open' ? !isOpen(m) : !ids.includes(m.id))) continue;
      const s = nextStatus(m.status, ev);
      if (!s || s === m.status) continue;
      m.status = s;
      moved.set(s, [...(moved.get(s) ?? []), m]);
    }
    for (const [status, ms] of moved) {
      this.broadcast({ type: 'status', ids: ms.map((m) => m.id), status });
      ms.forEach((m) => this.telegramReact(m));
    }
    if (moved.size) this.save();
  }

  /** The reaction Telegram shows on a message the manager sent from there. */
  private telegramReact(m: PhoneMessage) {
    const emoji = m.tg !== undefined ? telegramReaction(m) : null;
    if (emoji) void this.telegram.react(m.tg!, emoji);
  }

  private setReactions(m: PhoneMessage, reactions: MessageReaction[]) {
    if (reactions.length) m.reactions = reactions;
    else delete m.reactions;
    this.broadcast({ type: 'ceoChat', message: m });
    this.save();
  }

  /** The CEO's react: a reaction under the manager's message, instead of words or with them. */
  protected ceoReact(x: { emoji: string; message_id?: number }): string {
    if (!(CEO_REACTIONS as readonly string[]).includes(x.emoji)) throw new Error(`React with one of ${CEO_REACTIONS.join(' ')}.`);
    const m = reactTarget(this.state.messages, x.message_id);
    if (typeof m === 'string') throw new Error(m);
    this.setReactions(m, react(m.reactions, 'ceo', x.emoji));
    this.telegramReact(m);
    return `Reacted ${x.emoji} to message ${m.id}. If nothing more needs saying, end with no text: the manager sees the reaction.`;
  }

  /** The CEO's reply: an answer quoting the manager's message it is about, on the phone now (for several messages in one job). */
  protected ceoReply(x: { message_id: number; text: string }): string {
    const m = this.state.messages.find((y) => y.id === x.message_id && y.from === 'manager');
    if (!m) throw new Error(`There is no message ${x.message_id} from the manager in this conversation: use the id from "(message N)".`);
    const text = String(x.text ?? '').trim();
    if (!text) throw new Error('Write the answer.');
    this.postMessage('ceo', text, undefined, { replyTo: m.id });
    this.markDelivery([m.id], 'replied');
    this.markStatus([m.id], 'replied');
    return `Answered message ${m.id} on the phone. Don't repeat it in your final message; end with no text when every message is answered.`;
  }

  /** What a new CEO message says aloud (#282): a `closing` text after this job answered with the reply tool only with a useful spoken line. */
  protected ceoSpoken(parts: { text: string; spoken?: string }, closing: boolean) {
    const since = this.ceo().startedAt ?? 0;
    return spokenOf(parts, closing && this.state.messages.some((m) => m.from === 'ceo' && m.replyTo !== undefined && m.at >= since));
  }

  /** POST /api/ceo/conversations/:id/edit (and /pin): a thread renamed, pinned, archived or moved to another project (#132). */
  editConversation(id: string, raw: unknown) {
    try {
      editConversation(this.state.ceo.chats, id, conversationPatch(raw, this.state.repos.map((r) => r.id)));
    } catch (err) {
      throw new HttpError(this.state.ceo.chats.list.some((c) => c.id === id) ? 400 : 404, (err as Error).message);
    }
    this.broadcast({ type: 'ceoChat', conversations: conversationsView(this.state.ceo.chats) });
    this.save();
  }

  /** GET /api/ceo/library: a project's, the Company's or the whole office's artifacts and files, a page at a time (#132). */
  library(q: Parameters<CeoChat['library']>[3]) {
    return this.ceoChat.library(this.state.ceo.chats, this.state.messages, this.files.list(), q, this.state.repos.map((r) => r.id));
  }

  /** POST /api/ceo/messages/:id/react: the manager adds or removes a reaction on a CEO message; a new 👍 / 👎 (with what was wrong) reaches the CEO's next job. */
  reactToMessage(id: number, emoji: string, note = '') {
    const m = this.state.messages.find((x) => x.id === id);
    if (!m) throw new HttpError(404, 'That message is no longer saved');
    if (m.from !== 'ceo') throw new HttpError(400, "Only the CEO's messages take reactions.");
    if (!isReaction(emoji)) throw new HttpError(400, 'Pick a reaction from the bar.');
    const had = m.reactions?.some((r) => r.by === 'manager' && r.emoji === emoji);
    this.setReactions(m, react(m.reactions, 'manager', emoji));
    const line = had ? null : feedbackLine(m, emoji, note);
    if (line) this.ceoFeedback = [...this.ceoFeedback, line].slice(-5);
    return { reactions: m.reactions ?? [] };
  }
}
