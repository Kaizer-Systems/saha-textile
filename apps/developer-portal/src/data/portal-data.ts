/* ============================================================================
 * NEXT-GEN-UI · Typed client boundary for governed portal data
 * ----------------------------------------------------------------------------
 * WHAT: TypeScript view of the datasets emitted by portal-data-plugin.
 * WHY: components get editor-safe shapes without owning roadmap/gate facts.
 * HOW: the dependency-free Node compiler validates JSON + KB truth before
 * Docusaurus publishes it; this hook is the single React access point.
 * TUNING: extend PortalData only after the compiler and manifest accept the new
 * dataset. Never add fallback facts here—they would bypass governance.
 * ========================================================================= */

import { usePluginData } from '@docusaurus/useGlobalData';

export type ChunkStatus = 'done' | 'partial' | 'next' | 'planned';
export type GateStatus = 'open' | 'resolved';
export type StageKind = 'real' | 'ghost';

export type MissionChunk = {
	id: string;
	title: string;
	status: ChunkStatus;
	deps: string[];
	blockingGates: string[];
	summary: string;
	dod: string;
};

export type MissionGate = {
	id: string;
	status: GateStatus;
	label: string;
};

export type DecisionGate = {
	id: string;
	label: string;
	question: string;
	status: GateStatus;
	source: string;
	blocksChunks: string[];
	blocksCollections: string[];
	blocksFeatures: string[];
	seamsOk: string;
	resolvedNote?: string;
};

export type RequestStage = {
	id: string;
	label: string;
	sublabel: string;
	kind: StageKind;
	chunk?: string;
	file: string;
	current: string;
	target: string;
};

export type PortalData = {
	schemaVersion: 1;
	lastVerified: string;
	instruments: Array<{
		id: number;
		key: string;
		catalogHeading: string;
		wave: number;
		status: 'built' | 'locked';
		route?: string;
	}>;
	missionControl: {
		lastVerified: string;
		sourceOfTruth: string[];
		chunks: MissionChunk[];
		gates: MissionGate[];
	};
	decisionGates: {
		lastVerified: string;
		sourceOfTruth: string[];
		impactChunks: string[];
		impactCollections: string[];
		gates: DecisionGate[];
	};
	requestFlight: {
		schemaVersion: 1;
		lastVerified: string;
		sourceOfTruth: string[];
		method: string;
		path: string;
		title: string;
		summary: string;
		stages: RequestStage[];
	};
};

export function usePortalData(): PortalData {
	const data = usePluginData('portal-data-plugin') as PortalData | undefined;
	if (!data) {
		throw new Error(
			'Governed portal data is unavailable. Ensure portal-data-plugin is enabled and validation passes.',
		);
	}
	return data;
}
