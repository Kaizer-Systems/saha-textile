/* ============================================================================
 * NEXT-GEN-UI · Mission Control governed-data adapter
 * ----------------------------------------------------------------------------
 * Facts live in docs/_data + the project-progress Portal truth block. The
 * build-time compiler validates and merges them; this file exposes types and a
 * focused hook so the component never owns or silently defaults project state.
 * ========================================================================= */

import { usePortalData, type ChunkStatus, type GateStatus, type MissionChunk, type MissionGate } from './portal-data';

export type Chunk = MissionChunk;
export type Gate = MissionGate;
export type { ChunkStatus, GateStatus };

export function useMissionControlData() {
	return usePortalData().missionControl;
}
