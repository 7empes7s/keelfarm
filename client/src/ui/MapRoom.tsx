// The map room (#137): the memory map (#136) walked into in the 3D office, its graph as a constellation
// (Constellation.tsx) with the same search, filters, insights, card and time slider as the 2D map (MemoryMap.tsx).
// Opened from the map table in the CEO's office, the phone's Company tab or the 2D map's 🌌 button; a lazy chunk.
import { useStore } from '../store';
import { MemoryMap } from './MemoryMap';
import { Constellation } from './Constellation';
import { Panel } from './Panel';
import './mapRoom.css';

export function MapRoom() {
  const openOverlay = useStore((s) => s.openOverlay);
  return (
    <Panel title="🌌 Map room" wide accent="#9b5de5" className="map-room">
      <MemoryMap
        Stage={Constellation}
        action={
          <button type="button" className="btn mm-filter-btn" onClick={() => openOverlay({ kind: 'manager', tab: 'map' })} aria-label="Open as 2D map">
            🗺️ 2D map
          </button>
        }
      />
    </Panel>
  );
}
