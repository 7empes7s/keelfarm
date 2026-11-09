import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { pushLayer } from './backStack';
import { useDialogFocus } from './dialogFocus';
import { Icon } from './Icon';
import { CHART_GROUPS, chartSuggestions, iconFor, parsePins, PINS_KEY, togglePin } from './chartPromptList';
import './chartPrompts.css';

// The chat's 📊 Charts sheet (#270): ready prompts in groups, the manager's pinned ones on top and the CEO's latest
// chart suggestions to pin; a tap sends the prompt to the CEO, who answers with a live chart or dashboard.

function loadPins(): string[] {
  try {
    return parsePins(localStorage.getItem(PINS_KEY));
  } catch {
    return [];
  }
}

export function ChartPrompts({ ceoName, suggested, onSend, onClose }: { ceoName: string; suggested: readonly string[]; onSend: (prompt: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [pins, setPins] = useState(loadPins);
  useDialogFocus(ref); // focus goes back to 📊 when it closes
  useEffect(() => ref.current?.querySelector<HTMLButtonElement>('.chart-prompt')?.focus(), []);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => pushLayer(() => close.current()), []); // Back closes it
  const pin = (text: string) => {
    const next = togglePin(pins, text);
    setPins(next);
    try {
      localStorage.setItem(PINS_KEY, JSON.stringify(next));
    } catch {
      // private window or blocked storage: pinned for this visit only
    }
  };
  const row = (text: string, icon = iconFor(text)) => {
    const on = pins.includes(text);
    return (
      <li key={text} className="chart-prompt-row">
        <button
          type="button"
          className="chart-prompt"
          onClick={() => {
            onClose();
            onSend(text);
          }}
        >
          <Icon name={icon} /> <span>{text}</span>
        </button>
        <button type="button" className={`chat-tool chart-pin ${on ? 'chart-pin-on' : ''}`} aria-pressed={on} aria-label={on ? `Unpin “${text}”` : `Pin “${text}” to the top`} title={on ? 'Unpin' : 'Pin to the top'} onClick={() => pin(text)}>
          <Icon name="pin" />
        </button>
      </li>
    );
  };
  const theirs = chartSuggestions(suggested).filter((s) => !pins.includes(s));
  return (
    <div className="chat-sheet-back chart-sheet-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className="chat-sheet chart-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(e) => {
          // Esc closes the sheet only, not the chat under it.
          if (e.key !== 'Escape') return;
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
      >
        <div className="chart-sheet-head">
          <b id={titleId}>Charts</b>
          <span className="muted small grow">{ceoName} answers with a live chart</span>
          <button type="button" className="chat-tool" aria-label="Close" title="Close (Esc)" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        {pins.length > 0 && <Group title="Pinned">{pins.map((p) => row(p))}</Group>}
        {theirs.length > 0 && <Group title={`${ceoName} suggested`}>{theirs.map((s) => row(s))}</Group>}
        {CHART_GROUPS.map((g) => {
          const left = g.prompts.filter((p) => !pins.includes(p.text));
          return (
            left.length > 0 && (
              <Group key={g.title} title={g.title}>
                {left.map((p) => row(p.text, p.icon))}
              </Group>
            )
          );
        })}
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="chart-group">
      <div className="chat-menu-title">{title}</div>
      <ul className="chart-list">{children}</ul>
    </section>
  );
}
