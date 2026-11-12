// The ⓘ on each main screen (#109): "What can I do here?", from screenHelp.ts.
import { useState } from 'react';
import { SCREEN_HELP, type ScreenId } from './screenHelp';
import { Sheet } from './Sheet';
import { openWhatsNew } from './tour';
import { Icon } from './Icon';
import { XLabel } from './HoverCard';
import { TutorialsHub } from './TaskTutorial';

/** `className`: the button's look, e.g. a back bar's shared icon button (docs/design.md) instead of the bare glyph. */
export function InfoButton({ screen, className = 'info-btn' }: { screen: ScreenId; className?: string }) {
  const [open, setOpen] = useState(false);
  const h = SCREEN_HELP[screen];
  return (
    <>
      <button className={`${className} xbtn`} data-tour="info" onClick={() => setOpen(true)} aria-label={`What can I do on ${h.title}?`} title="What can I do here?">
        <Icon name="info" />
        <XLabel text="What can I do here?" />
      </button>
      {open && <InfoSheet screen={screen} onClose={() => setOpen(false)} />}
    </>
  );
}

/** "What can I do here?" for `screen`: also opened from pocket mode's ⋯ (#588). */
export function InfoSheet({ screen, onClose }: { screen: ScreenId; onClose: () => void }) {
  const h = SCREEN_HELP[screen];
  return (
    <Sheet
      title={
        <>
          <Icon name="info" /> {h.title}
        </>
      }
      onClose={onClose}
      className="info-sheet"
    >
      <p>{h.shows}</p>
      <h3 className="info-h">What you can do</h3>
      <ol className="info-list">
        {h.actions.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ol>
      <div className="row wrap">
        <a className="btn btn-small" href={h.docs} target="_blank" rel="noreferrer">
          <Icon name="book-open" /> Read more in the docs <Icon name="external-link" />
        </a>
        <button
          className="btn btn-small"
          onClick={() => {
            onClose();
            openWhatsNew();
          }}
        >
          <Icon name="sparkles" /> What's new
        </button>
      </div>
      <TutorialsHub onStart={() => onClose()} />
    </Sheet>
  );
}
