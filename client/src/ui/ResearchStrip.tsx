// The Researcher's strip over the chat's message box (#664): the topic being researched, its minutes against the
// budget, what waits and what research cost so far, and Stop (tap twice: what it found so far comes as a partial brief).
// The CEO's chat stays free meanwhile; the brief arrives as a card in it.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { researchLine } from '../../../shared/research';
import { Icon } from './Icon';
import './chatCards.css';

export function ResearchStrip() {
  const v = useStore((s) => s.research);
  const [now, setNow] = useState(() => Date.now());
  const [confirm, setConfirm] = useState(false);
  const running = !!v?.job;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [running]);
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 4000);
    return () => clearTimeout(t);
  }, [confirm]);
  if (!v?.job) return null;
  const topic = v.job.topic;
  return (
    <div className="working-strip research-strip" role="status" data-research={v.job.id}>
      <div className="working-row">
        <span className="working-main">
          <span className="working-icon" aria-hidden>
            <Icon name="search" />
          </span>
          <span className="grow working-text">
            <b className="working-now">
              {v.name} is researching “{topic}”
            </b>
            <span className="working-meta muted">
              {researchLine(v, now)}
              {v.costUsd > 0 && ` · $${v.costUsd.toFixed(2)} on research so far`}
            </span>
          </span>
        </span>
        <button
          type="button"
          className={`working-stop ${confirm ? 'working-stop-confirm' : ''}`}
          onClick={() => (confirm ? (setConfirm(false), void api.stopResearch()) : setConfirm(true))}
          aria-label={confirm ? 'Stop? Tap again: what it found so far comes as a partial brief' : `Stop the research on ${topic}`}
          title="Stop: what it found so far comes as a partial brief"
        >
          {confirm ? 'Stop?' : <Icon name="square" />}
        </button>
      </div>
    </div>
  );
}
