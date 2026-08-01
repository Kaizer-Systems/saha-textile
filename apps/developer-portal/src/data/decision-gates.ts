/* ============================================================================
 * NEXT-GEN-UI · Decision Gate governed-data adapter
 * ----------------------------------------------------------------------------
 * Gate structure lives in docs/_data; status comes from the project-progress
 * truth block and is cross-checked against the roadmap + decision log at build.
 * This adapter keeps the Wave-1 component typed without duplicating facts.
 * ========================================================================= */

import { usePortalData, type DecisionGate, type GateStatus } from './portal-data';

export type Gate = DecisionGate;
export type { GateStatus };

export function useDecisionGateData() {
	return usePortalData().decisionGates;
}
