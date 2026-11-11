// What a session really runs on (#376): "Max · keelops · Opus 5.5", and "(pinned: Claude Ultra, limited)" when the
// rotation moved it off its pin. On agent cards, the agent window, the CEO's chat header and threads, the CEO jobs log.
import type { SessionRun } from '../../../shared/types';
import { runLabel, runPinNote, runText } from '../../../shared/sessionRun';
import { Icon } from './Icon';
import './runChip.css';

export function RunChip({ run, className }: { run: SessionRun | null | undefined; className?: string }) {
  if (!run) return null;
  const pin = runPinNote(run);
  return (
    <span className={`chip run-chip ${pin ? 'run-chip-moved' : ''} ${className ?? ''}`} title={runText(run)} aria-label={`Running on ${runText(run)}`}>
      <Icon name={pin ? 'arrow-left-right' : 'key-round'} />
      <span className="run-chip-text">
        {runLabel(run)}
        {pin && <span className="run-chip-pin"> ({pin})</span>}
      </span>
    </span>
  );
}
