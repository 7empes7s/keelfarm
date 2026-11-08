// The phone: the CEO's messages (read aloud, announced, chirped), the live chat, files, decisions, toasts and the
// notification centre, and desktop notifications.
import { CEO_ID } from '../../../../shared/types';
import { settleOutbox } from '../../../../shared/chat';
import { addNotice, markRead, noticeOf } from '../../../../shared/notices';
import { messageSpeech } from '../../../../shared/speech';
import { applyChat, EMPTY_CHAT } from '../../ceoChat';
import { clearDesktopNotes, showDesktopNote } from '../../notifications';
import { announce } from '../../ui/announce';
import { audioUnlocked, chirp } from '../../ui/sfx';
import { claimVoice } from '../../ui/voiceClaim';
import { callOn, callVoice, holdNote } from '../../ui/voiceCallStore';
import { speakable } from '../../ui/voiceQueue';
import type { ApplyHandlers, SnapshotPart } from './types';

export const handlers = {
  message: (ev, { set, get, live, replay }) => {
    set({ messages: [...get().messages.slice(-199), ev.message], chatOutbox: settleOutbox(get().chatOutbox, ev.message) });
    if (replay) return; // a replayed message is only shown on the phone
    const o = get().overlay;
    const reading = get().chatDocked || (o?.kind === 'phone' && (o.tab ?? 'chat') === 'chat');
    // Read aloud, in this tab or another (always in a voice call); the voice plays the chirp itself if it can't. Locked audio can't speak.
    const speak = live && audioUnlocked() && speakable(ev.message, callVoice(get().settings.voice), Date.now());
    if (speak) {
      const arrived = Date.now();
      const wait = claimVoice(ev.message.id);
      void import('../../ui/voiceMessages').then((v) => v.speakMessage(ev.message, arrived, wait));
    }
    // Screen readers hear every message from the CEO, in words (no markdown or emoji), wherever focus is.
    if (live && ev.message.from === 'ceo') announce(`Message from ${get().agents[CEO_ID]?.name ?? 'the CEO'}: ${messageSpeech(ev.message, 600)}`);
    if (ev.message.from === 'ceo' && !reading && !speak && !callOn()) chirp(); // its toast is the office's notice (#107)
  },
  ceoChat: (ev, { set, get }) => set(applyChat(get(), ev)),
  // The CEO talking while it works (#286): a chip, and said by one tab when its voice may (voiceMessages.ts speakLine).
  voiceLine: (ev, { set, get, cues }) => {
    if (!cues) return;
    set({ voiceLine: ev.line });
    if (!audioUnlocked() || callVoice(get().settings.voice).provider === 'off') return;
    const arrived = Date.now();
    const wait = claimVoice(-ev.line.id); // negative: never a message's id
    void import('../../ui/voiceMessages').then((v) => v.speakLine(ev.line, arrived, wait));
  },
  files: (ev, { set }) => set({ files: ev.files }),
  delivery: (ev, { set, get }) => set({ messages: get().messages.map((m) => (ev.ids.includes(m.id) ? { ...m, delivery: ev.delivery } : m)) }),
  status: (ev, { set, get }) => set({ messages: get().messages.map((m) => (ev.ids.includes(m.id) ? { ...m, status: ev.status } : m)) }),
  phoneRead: (ev, { set, get }) => set({ phoneReadAt: Math.max(get().phoneReadAt, ev.at) }),
  decisions: (ev, { set }) => set({ decisions: ev.decisions }),
  toast: (ev, { set, get, replay }) => {
    const n = noticeOf(ev);
    if (n && !replay) set({ notices: addNotice(get().notices, n, Date.now()) }); // the centre is live-only
    const o = get().overlay;
    // The chat on screen shows the CEO's message itself (ui/Notices.tsx marks it read); a voice call holds it till its end.
    if (!(n?.kind === 'ceo' && o?.kind === 'phone' && (o.tab ?? 'chat') === 'chat') && !holdNote({ level: ev.level, text: ev.text, ...(n && { notice: n }) })) get().pushToast(ev.level, ev.text, n ?? undefined);
  },
  noticesRead: (ev, { set, get }) => set({ notices: markRead(get().notices, ev.ids) }),
  notifyClear: (ev) => clearDesktopNotes(ev.events),
  // This tab shows it only while it's hidden (notifications.ts); a visible office already chimes and toasts.
  notify: (ev, { get }) => showDesktopNote(ev.note, get().settings.notify?.channels.desktop !== false && !callOn()),
} satisfies ApplyHandlers;

export const snapshot: SnapshotPart = (d) => ({
  messages: d.messages,
  chat: d.chat ?? EMPTY_CHAT,
  files: d.files ?? [],
  phoneReadAt: d.phoneReadAt,
  notices: d.notices ?? [],
  decisions: d.decisions ?? [],
});
