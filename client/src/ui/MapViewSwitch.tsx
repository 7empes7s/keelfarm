// The memory map's 2D / 3D switch (#314) in the console and pocket mode: the choice (mapView.ts), the segmented
// switch for the map's bar, and the 3D stage: the map room's constellation in a lazy chunk, so the 2D map stays light,
// falling back to the 2D canvas if it fails to load or start (never a blank panel).
import { Component, lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import { MapCanvas, type MapStageProps } from './MapCanvas';
import { deviceFor3d, no3dReason, pickMapView, saveMapView, savedMapView, type MapView } from './mapView';

const Constellation = lazy(() => import('./Constellation').then((m) => ({ default: m.Constellation })));

class Fallback2d extends Component<{ children: ReactNode; props: MapStageProps }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <MapCanvas {...this.props.props} /> : this.props.children;
  }
}

/** The constellation as a MemoryMap stage, loaded on first use. */
export function Stage3d(props: MapStageProps) {
  return (
    <Fallback2d props={props}>
      <Suspense fallback={<div className="mm-canvas mm-3d-loading muted small">Loading the 3D map…</div>}>
        <Constellation {...props} />
      </Suspense>
    </Fallback2d>
  );
}

/** This device's map view, the note when 3D can't run here, and the choice (remembered on this device). */
export function useMapView() {
  const reason = useMemo(() => no3dReason(deviceFor3d()), []);
  const [view, setView] = useState<MapView>(() => pickMapView(savedMapView(), !reason));
  const [note, setNote] = useState<string | null>(null);
  const choose = (v: MapView) => {
    if (v === '3d' && reason) return setNote(reason);
    setNote(null);
    setView(v);
    saveMapView(v);
  };
  return { view, note, choose };
}

export function MapViewSwitch({ view, onChoose }: { view: MapView; onChoose: (v: MapView) => void }) {
  return (
    <div className="mm-view" role="group" aria-label="Map view">
      {(['2d', '3d'] as const).map((v) => (
        <button key={v} type="button" className={`mm-seg ${view === v ? 'mm-seg-on' : ''}`} aria-pressed={view === v} aria-label={v === '2d' ? 'Flat 2D map' : 'The map in 3D'} onClick={() => onChoose(v)}>
          {v.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
