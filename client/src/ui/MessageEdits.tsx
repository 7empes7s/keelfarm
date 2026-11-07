// Message edits (#125), shared by the CEO chat and agents' chats: a diff of two texts (old words struck through, new
// ones marked), and the Versions sheet of an edited message (each version with its time and who wrote it, a diff
// between any two, Copy). The rules are pure, in shared/messageEdits.ts.
import { useMemo, useState } from 'react';
import { useStore } from '../store';
import type { PhoneMessage } from '../../../shared/types';
import { allVersions, wordDiff } from '../../../shared/messageEdits';
import { Sheet } from './ChatArtifacts';
import { useBackLayer } from './Panel';
import { copyText } from './clipboard';
import './messageEdits.css';

const when = (t: number) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** `from` → `to`, word by word: removed words struck through, added ones highlighted. */
function DiffText({ from, to }: { from: string; to: string }) {
  const parts = useMemo(() => wordDiff(from, to), [from, to]);
  return (
    <div className="edit-diff">
      {parts.map((p, i) => (p.op === 'del' ? <del key={i}>{p.text}</del> : p.op === 'add' ? <ins key={i}>{p.text}</ins> : <span key={i}>{p.text}</span>))}
    </div>
  );
}

const copy = (text: string) => void copyText(text).then((ok) => useStore.getState().pushToast(ok ? 'success' : 'error', ok ? 'Copied' : "Couldn't reach the clipboard"));

/** Every version of an edited message, newest first, and the changes between any two (by default the last edit's). */
export function MessageVersions({ m, author, onClose }: { m: Pick<PhoneMessage, 'text' | 'at' | 'edited' | 'versions'>; author: string; onClose: () => void }) {
  useBackLayer(onClose);
  const all = allVersions(m);
  const [pair, setPair] = useState<[number, number]>([all.length - 2, all.length - 1]);
  const label = (i: number) => `Version ${i + 1}${i === all.length - 1 ? ' (now)' : ''}`;
  const pick = (side: 0 | 1, v: number) => setPair((p) => (side ? [p[0], v] : [v, p[1]]));
  return (
    <Sheet label={`Versions · ${all.length}`} onClose={onClose} className="versions-sheet">
      <div className="artifact-body versions-body">
        <section className="versions-compare" aria-label="Compare two versions">
          <div className="versions-pick">
            {([0, 1] as const).map((side) => (
              <label key={side} className="versions-select">
                <span className="small muted">{side ? 'To' : 'From'}</span>
                <select value={pair[side]} onChange={(e) => pick(side, Number(e.target.value))}>
                  {all.map((_, i) => (
                    <option key={i} value={i}>
                      {label(i)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <DiffText from={all[pair[0]].text} to={all[pair[1]].text} />
        </section>
        <ol className="versions-list" reversed>
          {all.map((v, i) => ({ v, i })).reverse().map(({ v, i }) => (
            <li key={i} className="versions-item">
              <div className="versions-head">
                <b className="grow">{label(i)}</b>
                <button type="button" className="btn btn-small" onClick={() => copy(v.text)} aria-label={`Copy ${label(i)}`}>
                  📋 Copy
                </button>
              </div>
              <div className="small muted">
                {i ? `Edited by ${author}` : `Written by ${author}`} · {when(v.at)}
                {i > 0 && all[i - 1].reason && ` · ${all[i - 1].reason}`}
              </div>
              <div className="versions-text">{v.text}</div>
            </li>
          ))}
        </ol>
      </div>
    </Sheet>
  );
}
