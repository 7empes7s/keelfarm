import { useStore } from './store';
import { restartExpected, shouldReload } from './officeUpdate';
import type { ClientEvent, ServerEvent } from '../../shared/types';
import { currentWatch } from './watch';
import { hitchWs } from './hitches';
import { onResume, onTick, type SocketLook } from '../../shared/heartbeat';
import { socketUrl } from './socketUrl';
import { report, watchAttention } from './attention';

let retry = 0;
let socket: WebSocket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
// When the socket started connecting, and when it last opened or brought a message (shared/heartbeat.ts).
let startedAt = 0;
let heardAt = 0;
let sentWatch = '';

/** Tells the office what this tab shows (watch.ts) whenever that changes, so it sends only the lines it needs. */
function sendWatch() {
  const watch = JSON.stringify({ type: 'lines', ...currentWatch(useStore.getState()) } satisfies ClientEvent);
  if (socket?.readyState !== WebSocket.OPEN || watch === sentWatch) return;
  sentWatch = watch;
  socket.send(watch);
}
let watching = false;
// Back from the time-lapse: everything waits for the fresh snapshot asked for, so nothing applies on top of the replay.
let awaitingSnapshot = false;
// Presence too: the other visitors are live people, there in a replay as much as in the live office.
const OUTSIDE_REPLAY = new Set<ServerEvent['type']>(['notify', 'notifyClear', 'notifyChannels', 'settings', 'officeUpdate', 'clis', 'models', 'voiceKey', 'voiceCache', 'progress', 'visitors', 'visitorPose', 'visitorEmote', 'visitorPing']);
let opens = 0;
/** Characters in and out on /ws since the page loaded, and in for presence alone (its probe turns them into rates). */
export const wsTraffic = { in: 0, out: 0, presence: 0 };

/** Sends a message on /ws; false while disconnected, when it's dropped. */
export function sendWs(msg: ClientEvent) {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  const text = JSON.stringify(msg);
  socket.send(text);
  wsTraffic.out += text.length;
  return true;
}

/** How many times the socket has opened: a new one means the server has forgotten this tab (presence tells it again). */
export const wsOpens = () => opens;

/** The time-lapse stopped: asks for the live office again (a reconnect brings a snapshot anyway). */
export function requestSnapshot() {
  awaitingSnapshot = true;
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'resync' } satisfies ClientEvent));
}

// The commit this tab last reloaded for, so a new office commit reloads the page at most once.
const RELOAD_KEY = 'office-swarm:reloaded-for';

function reloadedFor(): string | null {
  try {
    return sessionStorage.getItem(RELOAD_KEY);
  } catch {
    return null;
  }
}

/** The server came back on a different commit: load the client that goes with it. */
function reloadForNewCommit(commit: string): boolean {
  if (!shouldReload(useStore.getState().officeCommit, commit, reloadedFor())) return false;
  try {
    sessionStorage.setItem(RELOAD_KEY, commit);
  } catch {
    return false; // without storage we can't promise a single reload, so keep the old client
  }
  location.reload();
  return true;
}

const look = (): SocketLook => ({ readyState: socket?.readyState ?? WebSocket.CLOSED, startedAt, heardAt });

/** The socket is gone (closed, or dropped by us as dead): the HUD says so, and the office's restart is looked for. */
function lost() {
  const s = useStore.getState();
  s.setConnected(false);
  // A drop while the office updates itself is the restart: say so, and look for it coming back sooner.
  const restarting = s.restarting || restartExpected(s.officeUpdate);
  if (restarting !== s.restarting) s.setRestarting(restarting);
  return restarting;
}

/** Drops a socket that went quiet (a phone's background leaves it half-open, with no close) and connects again now. */
function reconnectNow() {
  const old = socket;
  if (old) {
    old.onopen = old.onmessage = old.onclose = null;
    old.close();
  }
  socket = null;
  clearTimeout(retryTimer);
  lost();
  retry = 0;
  connect(); // the new socket's first message is a fresh snapshot
}

/** Back in the foreground (or a tapped notification): reconnect at once unless the socket is plainly alive (#93). */
function resume() {
  if (onResume(look(), Date.now()) === 'reconnect') reconnectNow();
}

function listen() {
  // subscribed here, not as the module loads: the store imports this module (through presence) before it exists
  useStore.subscribe(sendWatch);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && resume());
  for (const ev of ['pageshow', 'online', 'focus', 'cubefarm:open']) window.addEventListener(ev, resume);
  setInterval(() => onTick(look(), Date.now()) === 'reconnect' && reconnectNow(), 5_000);
  watchAttention(sendWs);
}

export function connect() {
  if (!watching) {
    watching = true;
    listen();
  }
  const ws = new WebSocket(socketUrl('/ws'));
  socket = ws;
  startedAt = Date.now();
  ws.onopen = () => {
    heardAt = Date.now();
    retry = 0;
    sentWatch = '';
    opens++;
    useStore.getState().setConnected(true);
    sendWatch();
    report(sendWs, false, true); // a new socket is a tab the office doesn't know yet
  };
  ws.onmessage = (e) => {
    const bytes = typeof e.data === 'string' ? e.data.length : 0;
    wsTraffic.in += bytes;
    heardAt = Date.now();
    const from = performance.now();
    let type = 'other';
    try {
      const ev = JSON.parse(e.data) as ServerEvent;
      type = ev.type;
      if (ev.type === 'beat') return;
      if (ev.type.startsWith('visitor')) wsTraffic.presence += e.data.length;
      if (ev.type === 'snapshot' && ev.data.officeCommit && reloadForNewCommit(ev.data.officeCommit)) return;
      // While the time-lapse plays it owns the office; it asks for a fresh snapshot when it stops. What isn't part of
      // the replayed office (notifications, settings, the office's own update…) still applies.
      if (!OUTSIDE_REPLAY.has(ev.type)) {
        if (useStore.getState().replaying) return;
        if (awaitingSnapshot) {
          if (ev.type !== 'snapshot') return;
          awaitingSnapshot = false;
        }
      }
      useStore.getState().apply(ev);
    } catch (err) {
      console.error('bad server event', err);
    }
    hitchWs(type, bytes, performance.now() - from); // the hitch recorder: what each message cost to apply
  };
  ws.onclose = () => {
    const restarting = lost();
    retryTimer = setTimeout(connect, Math.min(restarting ? 2000 : 8000, 500 * 2 ** retry++));
  };
}
