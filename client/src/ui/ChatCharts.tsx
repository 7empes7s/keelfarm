// The chat's 📊 (#270): a sheet of ready chart prompts, grouped, with the manager's pins on top (saved on this device)
// and the chart prompts the CEO suggested, ready to pin. A tap sends the prompt; the CEO answers with a live chart.
import { useEffect, useId, useRef, useState } from 'react';
import { useStore } from '../store';
import { CHART_GROUPS, CHART_PROMPTS, ceoChartPrompts, readPins, togglePin, type ChartPromptId } from '../../../shared/chartPrompts';
import { useDialogFocus } from './dialogFocus';
import { pushLayer } from './backStack';
import { CloseButton, Icon } from './Icon';
import type { IconName } from './icons';
import { XLabel } from './HoverCard';
import './chatCharts.css';

const ICONS: Record<ChartPromptId, IconName> = { money: 'coins', 'per-merge': 'git-merge', waste: 'trash-2', working: 'users', backlog: 'clipboard-list', merges: 'trending-up', server: 'server', memory: 'cpu', usage: 'gauge' };
const iconOf = (text: string): IconName => ICONS[CHART_PROMPTS.find((p) => p.text === text)?.id as ChartPromptId] ?? 'sparkle';

const PINS_KEY = 'cubefarm.chartPins';
function loadPins(): string[] {
  try {
    return readPins(localStorage.getItem(PINS_KEY));
  } catch {
    return [];
  }
}

/** 📊 and its sheet. */
export function ChartsButton({ ceoName, onPrompt }: { ceoName: string; onPrompt: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" data-tour="chat-charts" className="chat-tool xbtn" aria-haspopup="dialog" aria-expanded={open} aria-label="Charts" title={`Charts: ready questions ${ceoName} answers with a live chart`} onClick={() => setOpen(true)}>
        <Icon name="chart-column" />
        <XLabel text="Charts" />
      </button>
      {open && (
        <ChartsSheet
          ceoName={ceoName}
          onClose={() => setOpen(false)}
          onPick={(t) => {
            setOpen(false);
            onPrompt(t);
          }}
        />
      )}
    </>
  );
}

function ChartsSheet({ ceoName, onPick, onClose }: { ceoName: string; onPick: (text: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [pins, setPins] = useState(loadPins);
  const messages = useStore((s) => s.messages);
  const suggested = ceoChartPrompts(messages).filter((t) => !pins.includes(t));
  useDialogFocus(ref);
  useEffect(() => ref.current?.querySelector<HTMLButtonElement>('.chart-prompt')?.focus(), []);
  useEffect(() => pushLayer(onClose), []); // eslint-disable-line react-hooks/exhaustive-deps
  const pin = (text: string) => {
    const next = togglePin(pins, text);
    setPins(next);
    try {
      localStorage.setItem(PINS_KEY, JSON.stringify(next));
    } catch {
      // private window: pinned for now only
    }
  };
  const row = (text: string) => {
    const on = pins.includes(text);
    return (
      <li key={text} className="chart-row">
        <button type="button" className="chart-prompt" onClick={() => onPick(text)}>
          <Icon name={iconOf(text)} />
          <span className="chart-prompt-text">{text}</span>
        </button>
        <button type="button" className={`chart-pin ${on ? 'chart-pin-on' : ''}`} aria-pressed={on} aria-label={on ? `Unpin “${text}”` : `Pin “${text}” to the top`} title={on ? 'Unpin' : 'Pin to the top'} onClick={() => pin(text)}>
          <Icon name={on ? 'star' : 'pin'} />
        </button>
      </li>
    );
  };
  const group = (title: string, list: string[]) =>
    list.length > 0 && (
      <section key={title} aria-label={title}>
        <div className="chat-menu-title">{title}</div>
        <ul className="chart-list">{list.map(row)}</ul>
      </section>
    );
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
          if (e.key !== 'Escape') return;
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
      >
        <div className="chart-sheet-head">
          <b id={titleId} className="grow">
            <Icon name="chart-column" /> Charts
          </b>
          <CloseButton label="Close the charts" onClick={onClose} />
        </div>
        <p className="muted small chart-sheet-note">Tap one and {ceoName} answers with a live chart.</p>
        {group('Pinned', pins)}
        {group(`Suggested by ${ceoName}`, suggested)}
        {CHART_GROUPS.map((g) => group(g, CHART_PROMPTS.filter((p) => p.group === g && !pins.includes(p.text)).map((p) => p.text)))}
      </div>
    </div>
  );
}
