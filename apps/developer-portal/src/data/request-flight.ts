/* ============================================================================
 * NEXT-GEN-UI · Request Flight governed-data adapter
 * ----------------------------------------------------------------------------
 * The request trace is authored as versioned JSON and source-path validated by
 * the shared build-time compiler. Components receive typed compiled data here;
 * no current/target claim is hidden inside the visual implementation.
 * ========================================================================= */

import { usePortalData, type RequestStage, type StageKind } from './portal-data';

export type Stage = RequestStage;
export type { StageKind };

export function useRequestFlightData() {
	return usePortalData().requestFlight;
}
