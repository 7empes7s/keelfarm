import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { enterBuilding, enterOverview, exitView, rotateView, useCameraView, visitFloor } from '../world/camera/rig';
import { watchPads } from '../world/gamepad';
import { useLookPrefs } from '../world/look';
import { requestLook } from '../world/Player';
import { keyName } from './controls';
import { Icon } from './Icon';
import { Key, MoveKeys } from './Key';

// The camera's HUD: the overview button (on the floor card), the overview's and the building's toolbars (turn, the
// building, back) with what a click would open, the follow cam's banner, and a reticle for the gamepad's A in a view.

/** Back to first person from a click: the click may grab the mouse again (if that setting is on). */
function back() {
  exitView();
  if (useLookPrefs.getState().grabOnClose) requestLook();
}

/** On the floor card: fly up to the overview (the HUD button for Tab). */
export function OverviewButton() {
  const onFoot = useCameraView((s) => s.mode) === 'first';
  const started = useStore((s) => s.started);
  const travel = useStore((s) => s.travel);
  if (!started || !onFoot || travel) return null;
  return (
    <button
      className="cam-btn"
      title={`See the whole floor from above (${keyName('overview')}; twice for the building)`}
      onClick={(e) => {
        e.currentTarget.blur();
        enterOverview();
      }}
    >
      <Icon name="map" /> <Key action="overview" />
    </button>
  );
}

export function CameraHud() {
  const mode = useCameraView((s) => s.mode);
  const following = useCameraView((s) => s.following);
  const hover = useCameraView((s) => s.hover);
  const started = useStore((s) => s.started);
  const overlay = useStore((s) => s.overlay);
  const floor = useStore((s) => s.floor);
  const [pad, setPad] = useState(false);
  useEffect(() => watchPads((on) => setPad(on)), []);
  if (!started || overlay || mode === 'first') return null;

  if (mode === 'follow') {
    return (
      <div className="cam-follow" role="status">
        <Icon name="video" /> Following <b>{following}</b> · <MoveKeys joined /> or <kbd>Esc</kbd> to take over
        <button className="btn btn-small" onClick={back}>
          <Icon name="x" /> Stop
        </button>
      </div>
    );
  }

  const tip =
    mode === 'overview' ? 'Drag to pan · scroll to zoom · click someone, a desk, the whiteboard or the app screen' : 'Click a floor to go there · drag up and down · scroll to zoom';
  return (
    <>
      {pad && <div className="crosshair cam-reticle" />}
      <div className="cam-bar" role="toolbar" aria-label={mode === 'overview' ? 'Overview' : 'Building'}>
        <span className="cam-title">
          {mode === 'overview' ? (
            <>
              <Icon name="map" /> Overview
            </>
          ) : (
            <>
              <Icon name="building-2" /> The building
            </>
          )}
        </span>
        {mode === 'overview' ? (
          <>
            <button className="btn btn-small" onClick={() => rotateView(-1)} title="Turn the view left">
              <Icon name="rotate-ccw" /> <Key action="rotateLeft" />
            </button>
            <button className="btn btn-small" onClick={() => rotateView(1)} title="Turn the view right">
              <Icon name="rotate-cw" /> <Key action="rotateRight" />
            </button>
            <button className="btn btn-small" onClick={() => enterBuilding()} title={`Every floor at once (${keyName('overview')} twice)`}>
              <Icon name="building-2" /> Building
            </button>
          </>
        ) : (
          <button className="btn btn-small" onClick={() => visitFloor(floor)} title="Back down to the overview of this floor">
            <Icon name="map" /> This floor
          </button>
        )}
        <button className="btn btn-small btn-good" onClick={back} title="Fly back to where you were standing">
          <Icon name="x" /> Back <Key action="overview" />
        </button>
      </div>
      <div className="cam-tip">{hover ? `Click: ${hover}` : tip}</div>
    </>
  );
}
