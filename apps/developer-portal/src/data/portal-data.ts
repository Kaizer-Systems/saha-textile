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
export type SchemaCollectionState = 'existing' | 'planned';
export type SchemaTargetAction = 'refactor' | 'add';
export type PortalPageStatus = 'implemented' | 'scaffolded' | 'planned' | 'deferred' | 'deprecated';
export type CommandTargetSource = 'journey-pages' | 'decision-gates' | 'document-status';
export type CommandTargetKind = 'journey' | 'gate' | 'status';
export type FirstFlightPersonaId = 'beginner' | 'frontend' | 'backend' | 'operator';

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

export type SchemaCluster = {
	id: string;
	label: string;
	summary: string;
	owningChunks: string[];
};

export type SchemaCollection = {
	id: string;
	label: string;
	cluster: string;
	currentState: SchemaCollectionState;
	targetAction: SchemaTargetAction;
	owningChunks: string[];
	blockingDecisions: string[];
	purpose: string;
	source: string;
	currentModel?: string;
	references: string[];
};

export type CommandVerbTarget = {
	id: string;
	title: string;
	path: string;
	kind: CommandTargetKind;
	section: string;
	status: PortalPageStatus | GateStatus;
	keywords: string;
};

export type CommandVerb = {
	id: 'trace' | 'gate' | 'status';
	token: 'trace' | 'gate' | 'status';
	label: string;
	description: string;
	example: string;
	targetSource: CommandTargetSource;
	emptyRoute: string;
	routePrefixes?: string[];
	includeRoutes?: string[];
	targets: CommandVerbTarget[];
};

export type FirstFlightTargetContract = {
	primary: 'stable-heading-id';
	enhancementAttribute: 'data-first-flight-anchor';
	missingTarget: 'fail-build';
};

export type FirstFlightProgressPolicy = {
	mode: 'device-local';
	storageKey: string;
	payloadVersion: 1;
	optIn: 'explicit-per-persona';
	resumeStrategy: 'furthest-reached';
	completionScope: 'per-persona';
	resettable: true;
	telemetry: false;
	writesToApplicationApis: false;
	writesToRepository: false;
};

export type FirstFlightDebriefPolicy = {
	trigger: 'final-checkpoint';
	presentation: 'route-overlay';
	requiresStoredProgress: false;
	persistsCompletionOnlyWhenOptedIn: true;
};

export type FirstFlightNavigationPolicy = {
	mode: 'url-query';
	personaParam: 'firstFlight';
	stepParam: 'step';
	persistsProgress: false;
};

export type FirstFlightStop = {
	id: string;
	route: string;
	anchor: string;
	title: string;
	instruction: string;
	why: string;
	pageTitle: string;
	pageStatus: PortalPageStatus;
	sourcePath: string;
};

export type FirstFlightPersona = {
	id: FirstFlightPersonaId;
	label: string;
	summary: string;
	outcome: string;
	durationMinutes: number;
	stops: FirstFlightStop[];
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
		page?: string;
		component?: string;
		dataset?: string;
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
	schemaNebula: {
		schemaVersion: 1;
		lastVerified: string;
		route: string;
		title: string;
		summary: string;
		sourceOfTruth: string[];
		sourceAliases: Record<string, string>;
		inventory: {
			nodeCount: number;
			existingModelCount: number;
			targetOnlyCount: number;
			countPolicy: string;
			statusPolicy: string;
		};
		clusters: SchemaCluster[];
		collections: SchemaCollection[];
	};
	commandVerbs: {
		schemaVersion: 1;
		lastVerified: string;
		title: string;
		summary: string;
		sourceOfTruth: string[];
		verbs: CommandVerb[];
	};
	firstFlight: {
		schemaVersion: 1;
		lastVerified: string;
		route: string;
		title: string;
		summary: string;
		sourceOfTruth: string[];
		targetContract: FirstFlightTargetContract;
		navigationPolicy: FirstFlightNavigationPolicy;
		progressPolicy: FirstFlightProgressPolicy;
		debriefPolicy: FirstFlightDebriefPolicy;
		personas: FirstFlightPersona[];
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
