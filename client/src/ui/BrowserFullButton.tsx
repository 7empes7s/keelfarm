// The top bar's browser full screen button (#415), in the 3D office's HUD and pocket mode's wide header; nothing where
// the browser has no Fullscreen API (iPhones).
import { canGoFullscreen, toggleBrowserFull, useBrowserFull } from './browserFull';
import { XLabel } from './HoverCard';
import { Icon } from './Icon';

export function BrowserFullButton({ className }: { className: string }) {
  const on = useBrowserFull();
  if (!canGoFullscreen()) return null;
  const label = on ? 'Exit full screen' : 'Full screen';
  return (
    <button type="button" className={`${className} xbtn`} aria-pressed={on} aria-label={label} title={`${label} (F11)`} onClick={() => toggleBrowserFull()}>
      <Icon name={on ? 'minimize' : 'maximize'} />
      <XLabel text={label} keys="F11" />
    </button>
  );
}
