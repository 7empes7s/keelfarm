// The CEO's terminal (#596) as a window of its own: its CLI live, or once that has closed the last screen of its
// session, said plainly; the log lines when it runs without a terminal (the SDK runtime).
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { CEO_ID } from '../../../shared/types';
import { useStore } from '../store';
import { LiveTerminal } from './LiveTerminal';
import { Panel } from './Panel';
import { Icon } from './Icon';
import { ceoTermNote } from './ceoTermRules';
import './ceoTerminal.css';

export function CeoTerminal() {
  const ceo = useStore((s) => s.agents[CEO_ID]);
  const log = useStore((s) => s.logs[CEO_ID]) ?? [];
  const [live, setLive] = useState<boolean | null>(null);
  const onStatus = useCallback((line: string) => setLive(!line.startsWith('Not running')), []);
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length]);
  const name = ceo?.name ?? 'The CEO';
  const note = ceo && ceoTermNote(name, ceo.terminal, live);
  return (
    <Panel
      wide
      accent={ceo?.color}
      className="ceo-terminal"
      title={
        <>
          <Icon name="terminal" /> {name}'s terminal
        </>
      }
    >
      {!ceo ? (
        <p className="muted">The corner office is empty.</p>
      ) : (
        <>
          {note && (
            <p className="ceo-terminal-note" role="status">
              {note}
            </p>
          )}
          {ceo.terminal ? (
            <LiveTerminal agentId={CEO_ID} onStatus={onStatus} />
          ) : (
            <div className="term" ref={scroller}>
              {log.length === 0 && <div className="term-line term-system">(nothing yet)</div>}
              {log.map((l) => (
                <div key={l.id} className={`term-line term-${l.kind}`}>
                  {l.text || ' '}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
