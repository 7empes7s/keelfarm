import { useRef } from 'react';
import { useStore, type Focus } from '../store';
import { peelAimed } from '../world/boardHands';
import { followAgent } from '../world/camera/rig';
import { greet } from '../world/Chatter';
import { runFocusAction } from '../world/Player';
import { focusAgent, holdOptions, type HoldOptionId } from '../world/touch/holdOptions';
import { closeHoldMenu, useHoldMenu } from '../world/touch/touchState';
import { useDialogFocus } from './dialogFocus';

// The hold menu: a bottom sheet of what you can do with the thing you held a finger on (or opened with the aim
// card's ⋯ button), from holdOptions.ts. A tap on the dimmed view, or Cancel, closes it.

function run(id: HoldOptionId) {
  const focus = useHoldMenu.getState().focus;
  closeHoldMenu();
  if (!focus) return;
  const agent = focusAgent(focus);
  if (id === 'use') runFocusAction(focus, 'click');
  else if (id === 'follow' && agent) followAgent(agent);
  else if (id === 'greet' && agent && !greet(agent)) useStore.getState().pushToast('info', "👋 They're busy right now: say hi when they're free");
  else if (id === 'carry') peelAimed(focus);
}

export function HoldMenu() {
  const focus = useHoldMenu((s) => s.focus);
  return focus ? <Sheet focus={focus} /> : null;
}

function Sheet({ focus }: { focus: Focus }) {
  const box = useRef<HTMLDivElement>(null);
  // Only a press that starts on the backdrop closes it: the click that follows the finger lifting (which opened the
  // menu) lands on the backdrop too.
  const pressed = useRef(false);
  useDialogFocus(box);
  return (
    <div
      className="hold-backdrop"
      onPointerDown={(e) => (pressed.current = e.target === e.currentTarget)}
      onClick={(e) => {
        if (pressed.current && e.target === e.currentTarget) closeHoldMenu();
        pressed.current = false;
      }}
    >
      <div ref={box} className="hold-sheet" role="dialog" aria-modal="true" aria-label={`Options: ${focus.label}`} tabIndex={-1} onKeyDown={(e) => e.key === 'Escape' && closeHoldMenu()}>
        <div className="hold-title">{focus.label}</div>
        {holdOptions(focus).map((o) => (
          <button key={o.id} className="hold-option" onClick={() => run(o.id)}>
            {o.label}
          </button>
        ))}
        <button className="hold-option hold-cancel" onClick={closeHoldMenu}>
          Cancel
        </button>
      </div>
    </div>
  );
}
