// The ⓘ on each main screen (#109): "What can I do here?", from screenHelp.ts.
import { useState } from 'react';
import { SCREEN_HELP, type ScreenId } from './screenHelp';
import { Sheet } from './Sheet';

export function InfoButton({ screen }: { screen: ScreenId }) {
  const [open, setOpen] = useState(false);
  const h = SCREEN_HELP[screen];
  return (
    <>
      <button className="info-btn" onClick={() => setOpen(true)} aria-label={`What can I do on ${h.title}?`} title="What can I do here?">
        ⓘ
      </button>
      {open && (
        <Sheet title={`ⓘ ${h.title}`} onClose={() => setOpen(false)} className="info-sheet">
          <p>{h.shows}</p>
          <h3 className="info-h">What you can do</h3>
          <ol className="info-list">
            {h.actions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ol>
          <a className="btn btn-small" href={h.docs} target="_blank" rel="noreferrer">
            📖 Read more in the docs ↗
          </a>
        </Sheet>
      )}
    </>
  );
}
