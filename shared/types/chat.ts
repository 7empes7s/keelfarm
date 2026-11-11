// The phone chat between the manager and the CEO, and the CEO's job queue. Imported through shared/types.ts.
import type { ChatAction } from '../ceoActions.ts';
import type { CeoSessionView } from '../ceoAwake.ts';
import type { CeoRunsOn } from '../ceoRunsOn.ts';
import type { MemoryNote } from '../ceoMemory.ts';
import type { CeoLive, StepLog } from '../ceoStream.ts';
import type { ChatVisual } from '../chatVisuals.ts';
import type { Conversation } from '../conversations.ts';
import type { FileRef } from '../files.ts';
import type { AgentQuestion } from '../questions.ts';
import type { UsedView } from '../used.ts';
import type { KeyTrouble } from './agents.ts';
import type { VoiceProvider } from './voice.ts';

/**
 * Where a manager's message to the CEO is (shared/chat.ts nextDelivery): sending and failed live only in the phone
 * that sent it; the office records sent, read (the CEO's session took it, or their reply job started) and replied.
 */
export type Delivery = 'sending' | 'sent' | 'read' | 'replied' | 'failed';
export type ServerDelivery = Extract<Delivery, 'sent' | 'read' | 'replied'>;

/** One message in the phone thread between the manager and the CEO. */
export interface PhoneMessage {
  id: number;
  from: 'ceo' | 'manager' | 'office'; // office = notes from the building itself (decisions, errors)
  text: string;
  at: number;
  requestId?: string; // a hire / let-go proposal this message is about
  voice?: Exclude<VoiceProvider, 'off'>; // who read it aloud when it arrived (absent: nobody), for the phone's ▶ replay
  telegram?: 'in' | 'out'; // in: the manager sent it from Telegram; out: the CEO's message also went there
  quiet?: true; // the CEO's: its notification wasn't sent, as the manager was in the app (#210)
  replyTo?: number; // replies to this one (its id): the manager's quote, or the CEO's answer to it (shared/reactions.ts)
  clientId?: string; // the manager's: the phone's id for the send, so a resend after a reload is taken once (#216)
  delivery?: ServerDelivery; // the manager's messages only (absent on messages saved before delivery was tracked)
  suggestions?: string[]; // the CEO's tappable replies (shared/chatParts.ts)
  ask?: string; // the CEO's: the question those replies answer, when it named one (a `? …` first line, #183)
  spoken?: string; // the CEO's: the short summary read aloud instead of the text (a ```spoken block, #282; shared/speech.ts)
  silent?: true; // the CEO's: nothing worth reading aloud (bookkeeping, or a turn's closing text after its replies, #282)
  artifacts?: ChatArtifact[]; // the CEO's longer content, shown as cards that open full-screen
  visuals?: ChatVisual[]; // the CEO's charts, tables and dashboards (#146, shared/chatVisuals.ts)
  attachments?: FileRef[]; // files sent with it, in the office's files store (shared/files.ts)
  used?: UsedView; // the CEO's: the skills, connectors and tools it used for this reply (shared/used.ts)
  refs?: ChatRef[]; // the office things it names (@Ada, floor 2 #13, file: …), in text order (shared/chatRefs.ts)
  research?: { topic: string; repoId?: string }; // the CEO's reply to a research job (repoId: from a floor's Plan dialog); a reply to it becomes a plan (server/research.ts)
  question?: string; // the CEO's: it asks the manager this agent question (its id): answers go to the agent
  steps?: string[]; // the CEO's, before #150: the steps it took for this reply, as labels
  log?: StepLog; // the CEO's: the steps it took for this reply, timed (shared/ceoStream.ts)
  summary?: string; // the CEO's: its turn's closing text after this reply, folded into the steps row (#378, shared/reactions.ts)
  actions?: ChatAction[]; // the CEO's: what its office tools changed for this reply, as cards (shared/ceoActions.ts)
  idea?: ChatIdea; // the CEO's: a suggestion about the office's structure, as a card with Accept (shared/chatParts.ts)
  edited?: number; // when its sender last edited it (#125: anyone's, shared/messageEdits.ts)
  versions?: MessageVersion[]; // its earlier texts, oldest first (at most MESSAGE_VERSIONS_MAX with the current one)
  status?: StatusReaction; // the manager's: the office's reaction as the CEO's job on it moves (shared/reactions.ts)
  reactions?: MessageReaction[]; // the manager's and the CEO's, oldest first
  tg?: number; // its Telegram message id, for one the manager sent from there
  notice?: ChatNotice; // the office's: a system notice (an update held back, rolled back…) shown as a card
  hidden?: true; // the CEO's, hidden by the manager (#145): kept for the CEO, never sent to a phone (shared/chatPage.ts)
  signIn?: ChatSignIn; // the office's: cloud agents to sign in after the API key stopped working (#258), as a card
  switch?: ChatSwitch; // the office's: the CEO moved to another account (#248), shown as a pill
  ceoRuns?: { back: CeoRunsOn }; // the office's: the manager moved the CEO to another coding agent (#418), a pill with Undo to `back`
  ceoStuck?: ChatCeoStuck; // the office's: the CEO's session is stuck (#375), as a card with Open terminal, Sign in and Switch back
  pacing?: true; // the office's: pacing started on a usage warning, as a card with Resume full speed and Always keep full speed (#323)
  ceoJob?: CeoJobTag; // the CEO's reply to a job the office started (#332): its model, and Redo on Opus
}

/** A CEO job's reply in the chat (#332): which job, the model it ran on, and the links between a job and its redo. */
export interface CeoJobTag {
  job: number; // the job's number, as in the CEO jobs log
  kind: CeoJobKind;
  model: string;
  usd?: number; // what the job cost, once it ended
  redoOf?: CeoJobLink; // this reply is a redo's
  redoneBy?: CeoJobLink; // this job was redone (message: null while the redo runs, or when it said nothing)
}

interface CeoJobLink {
  job: number;
  message: number | null;
}

/** The CEO moved off an account that was limited or signed out (to: null, every account is out). Labels only. */
interface ChatSwitch {
  from: string;
  to: string | null;
  until: number | null; // when the first account is back
  useKey?: string; // every account is out but this paused API key: "Use API key" resumes it
}

/** The CEO's session stuck on a sign-in, a setup screen or silence (#375): what the card offers. */
export interface ChatCeoStuck {
  kind: 'sign-in' | 'setup' | 'silent' | 'other';
  account: string | null; // the account it's stuck on (its id; null: the built-in login)
  back: string | null; // the account binding Switch back sets ('' the office default), null when there's nowhere to go back to
  backLabel?: string;
}

/** Cloud agents whose API key ran out of credit or was turned away, and now wait for their own sign-in: one card per burst. */
export interface ChatSignIn {
  why: KeyTrouble;
  cli: 'claude' | 'codex';
  agents: { id: string; name: string }[];
}

/** The office's own reaction under a manager's message (#118): 🕓 queued, 👀 seen, ⏳ working, ✅ done, ⚠️ failed or stopped. */
export type StatusReaction = 'queued' | 'seen' | 'working' | 'done' | 'failed';
export interface MessageReaction { emoji: string; by: 'ceo' | 'manager' }

/** An earlier text of an edited message: when it was written, and why its sender replaced it (the CEO's edit_message). */
export interface MessageVersion {
  text: string;
  at: number;
  reason?: string;
}

/** A system notice in the chat (#138), shown as a card headed by the message's text: the cleaned output behind it, and links to what it's about. */
export interface ChatNotice {
  details?: string;
  links?: { label: string; url: string }[];
}

/** The CEO chat beyond its messages (#51): the reply being written, the conversations and the manager's pinned notes. */
export interface CeoChatView {
  live: CeoLive | null;
  current: string; // the conversation the phone shows
  conversations: Conversation[];
  memory: MemoryNote[];
}

/** Something in the office a chat message names; `start`/`end` are its span in the message's text. */
export type ChatRef = { start: number; end: number } & (
  | { kind: 'agent'; agentId: string; terminal?: true }
  | { kind: 'floor'; repoId: string }
  | { kind: 'issue'; repoId: string; number: number } // an issue or a pull request
  | { kind: 'file'; repoId: string; path: string; line?: number }
  | { kind: 'qa'; repoId: string; number: number }
  | { kind: 'preview'; repoId: string; number?: number } // a PR's in the PR theatre, else the floor's app
);

/** GET /api/messages/:id/refs/:index/file: a file ref's text from the floor's default branch, size-capped. */
export interface RefFileView {
  path: string;
  line: number | null;
  text: string;
  url: string; // the file on GitHub, at the line
}

/** A CEO message's ```idea block: a change to how the office works, which Accept sends as `message`. */
export interface ChatIdea {
  kind: 'objective' | 'focus' | 'mandate' | 'experiment' | 'research' | 'charter' | 'team' | 'plan';
  title: string;
  message: string;
}

/** A CEO message's artifact: a titled markdown document shown as a card. */
export interface ChatArtifact {
  id: string; // `<message id>-<n>`
  title: string;
  lead: string; // its first line, plain words, for the card
  markdown?: string; // absent when the snapshot left it out: GET /api/messages/:id/artifacts/:artifactId
}

export type CeoJobKind = 'onboard' | 'plan' | 'review' | 'chat' | 'triage' | 'followup' | 'research' | 'changes';

export interface CeoInfo {
  queue: { kind: CeoJobKind; label: string }[]; // jobs waiting for the CEO
  job: { kind: CeoJobKind; label: string } | null; // what the CEO is doing now
  lastReviewAt: number | null;
  nextReviewAt: number | null; // null when the heartbeat is off
  followups?: { pending: string[]; startsAt: number | null; held: 'usage' | 'cap' | null }; // events waiting for a follow-up job (absent in old journals)
  session?: CeoSessionView; // its kept session (#28; absent in old journals)
  held?: CeoHeld | null; // why the manager's queued message can't start a CEO turn (server/ceoLane.ts)
  questions?: AgentQuestion[]; // agents waiting on an answer, oldest first (shared/questions.ts; absent in old journals)
}

/** Only Claude's usage limit holds the CEO's chat (#46): the phone shows it above the composer, with the reset time. */
export interface CeoHeld {
  reason: 'usage';
  until: number;
}
