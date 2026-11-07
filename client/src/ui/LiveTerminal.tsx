import { useEffect, useRef, useState } from 'react';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import type { AgentCli, TermClientMessage, TermServerMessage } from '../../../shared/types';
import { activeMods, consumeMods, keySequence, NO_MODS, tapMod, textSequence, type BarKey, type Mod, type ModState } from '../../../shared/termKeys';
import { TermKeyBar, useTermKeysPref } from './TermKeyBar';
import { VIEWPORT_EVENT } from '../viewport';
import { liveStatus, TERM_FONT } from './termLayout';

// An agent's real terminal: their CLI's screen streamed from the office (/ws/term), and what you type sent back to it.
// Opening it late shows everything so far: the office keeps a copy of each agent's screen and scrollback.

/** A finger, not a mouse: the status line says tap (#117). */
const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

const THEME: ITheme = {
  background: '#1b1b29',
  foreground: '#eeeef6', // bright enough that dim text (drawn at half strength) still reads at 4.5:1
  cursor: '#ff9e64',
  cursorAccent: '#1b1b29',
  selectionBackground: '#44475a',
  black: '#21222c',
  red: '#ff6b6b',
  green: '#50fa7b',
  yellow: '#f1fa8c',
  blue: '#8aa4ff',
  magenta: '#ff79c6',
  cyan: '#8be9fd',
  white: '#e8e8f2',
  brightBlack: '#6c6f93',
  brightRed: '#ff8787',
  brightGreen: '#69ff94',
  brightYellow: '#ffffa5',
  brightBlue: '#a4b9ff',
  brightMagenta: '#ff92df',
  brightCyan: '#a4ffff',
  brightWhite: '#ffffff',
};

/**
 * `compact` is the phone window's terminal (#86): no footer (the window shows `onStatus`'s line and the ⌨ toggle, and
 * passes `keys`), and the key bar stays in the window, which already sits above the keyboard.
 */
export function LiveTerminal({
  agentId,
  cli = 'claude',
  className,
  fontSize = TERM_FONT.desktop,
  compact,
  keys,
  onStatus,
}: {
  agentId: string;
  cli?: AgentCli;
  className?: string;
  fontSize?: number;
  compact?: boolean;
  keys?: boolean;
  onStatus?: (line: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false);
  const [connected, setConnected] = useState(true);
  const [focused, setFocused] = useState(false);
  const [keysPref, setKeysOn] = useTermKeysPref();
  const keysOn = keys ?? keysPref;
  const fontRef = useRef(fontSize);
  const refit = useRef<() => void>(() => undefined);
  // The key bar's sticky modifiers, read by the terminal's input too, so they apply to the phone keyboard's next key.
  const [mods, setModsState] = useState<ModState>(NO_MODS);
  const modsRef = useRef(mods);
  const setMods = (m: ModState) => {
    modsRef.current = m;
    setModsState(m);
  };
  const lastModTap = useRef<Partial<Record<Mod, number>>>({});
  const termRef = useRef<Terminal | null>(null);
  const sendRef = useRef<(data: string) => void>(() => undefined);

  useEffect(() => {
    const el = host.current!;
    const term = new Terminal({
      fontFamily: "'JetBrains Mono', Consolas, monospace",
      fontSize: fontRef.current,
      cursorBlink: true,
      cursorInactiveStyle: 'none',
      scrollback: 5000,
      allowProposedApi: true,
      scrollOnEraseInDisplay: true,
      theme: THEME,
      // Coloured output is nudged until it reads at 4.5:1 on the terminal's background (WCAG AA).
      minimumContrastRatio: 4.5,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((_e, uri) => window.open(uri, '_blank', 'noopener')));
    term.open(el);

    let ws: WebSocket | null = null;
    let closed = false;
    let ready = false; // the snapshot is on screen: sizes we send now describe what the viewer sees
    let retry: number | undefined;
    let frame = 0;
    const send = (m: TermClientMessage) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
    };
    termRef.current = term;
    sendRef.current = (data) => send({ t: 'input', data });
    const fitAndTell = () => {
      try {
        fit.fit();
      } catch {
        return; // not laid out yet
      }
      if (ready) send({ t: 'resize', cols: term.cols, rows: term.rows });
    };
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const socket = new WebSocket(`${proto}://${location.host}/ws/term?agent=${encodeURIComponent(agentId)}`);
      ws = socket;
      socket.onopen = () => setConnected(true);
      socket.onmessage = (e) => {
        const m = JSON.parse(String(e.data)) as TermServerMessage;
        if (m.t === 'snapshot') {
          // Replayed at the size it was drawn at, then fitted to this viewer (the CLI redraws for the new size).
          ready = false;
          term.reset();
          term.resize(m.cols, m.rows);
          term.write(m.data, () => {
            ready = true;
            fitAndTell();
            term.scrollToBottom();
          });
          setLive(m.live);
        } else if (m.t === 'data') term.write(m.data);
        else if (m.t === 'size' && (m.cols !== term.cols || m.rows !== term.rows)) term.resize(m.cols, m.rows);
        else if (m.t === 'live') setLive(m.live);
      };
      socket.onclose = (e) => {
        if (ws === socket) ws = null;
        if (closed) return;
        setConnected(false);
        if (e.code !== 4404) retry = window.setTimeout(connect, 1500);
      };
    };
    connect();

    const input = term.onData((data) => {
      const armed = activeMods(modsRef.current);
      if (armed.size && !data.startsWith('\x1b')) {
        data = textSequence(data, armed);
        setMods(consumeMods(modsRef.current));
      }
      send({ t: 'input', data });
    });
    // Esc belongs to the CLI (it interrupts Claude Code) while you're typing in the terminal, not to the panel.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') e.stopPropagation();
    };
    el.addEventListener('keydown', onKey);
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    term.textarea?.addEventListener('focus', onFocus);
    term.textarea?.addEventListener('blur', onBlur);
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fitAndTell);
    };
    refit.current = later;
    const ro = new ResizeObserver(later);
    ro.observe(el);
    // The keyboard and a turned phone change the visual viewport; the box follows it, and so do the rows.
    window.addEventListener(VIEWPORT_EVENT, later);
    window.addEventListener('orientationchange', later);
    void document.fonts?.ready.then(() => !closed && fitAndTell());

    return () => {
      closed = true;
      clearTimeout(retry);
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener(VIEWPORT_EVENT, later);
      window.removeEventListener('orientationchange', later);
      refit.current = () => undefined;
      input.dispose();
      el.removeEventListener('keydown', onKey);
      ws?.close();
      termRef.current = null;
      sendRef.current = () => undefined;
      term.dispose();
    };
  }, [agentId]);

  useEffect(() => {
    fontRef.current = fontSize;
    const term = termRef.current;
    if (!term || term.options.fontSize === fontSize) return;
    term.options.fontSize = fontSize;
    refit.current();
  }, [fontSize]);

  const status = liveStatus({ connected, live, focused, touch: COARSE });
  useEffect(() => onStatus?.(status), [onStatus, status]);

  const press = (k: BarKey) => {
    const term = termRef.current;
    if ('mod' in k) {
      const now = performance.now();
      setMods(tapMod(modsRef.current, k.mod, now - (lastModTap.current[k.mod] ?? -Infinity)));
      lastModTap.current[k.mod] = now;
      return;
    }
    if ('paste' in k) {
      void navigator.clipboard?.readText().then((text) => text && termRef.current?.paste(text), () => undefined);
      return;
    }
    const armed = activeMods(modsRef.current);
    if ('key' in k) sendRef.current(keySequence(k.key, new Set([...armed, ...(k.mods ?? [])]), term?.modes.applicationCursorKeysMode));
    else sendRef.current(textSequence(k.text, armed));
    setMods(consumeMods(modsRef.current));
  };

  return (
    <div className={`live-term ${className ?? ''}`}>
      <div className="live-term-screen" ref={host} />
      {keysOn && <TermKeyBar cli={cli} mods={mods} onPress={press} dock={!compact} />}
      {!compact && (
        <div className="live-term-foot">
          <span className={`live-dot ${live ? 'live-dot-on' : ''}`} />
          <span className="grow">{status}</span>
          <button type="button" className="live-term-keys-toggle" aria-pressed={keysOn} title={keysOn ? 'Hide the terminal key bar' : 'Show a bar of terminal keys: Esc, Tab, arrows, Ctrl…'} onClick={() => setKeysOn(!keysOn)}>
            ⌨ Keys
          </button>
        </div>
      )}
    </div>
  );
}
