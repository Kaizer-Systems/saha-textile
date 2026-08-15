/* ============================================================================
 * NEXT-GEN-UI · Schema Nebula governed-data adapter
 * ----------------------------------------------------------------------------
 * The 65-node physical-collection inventory lives in docs/_data and is checked
 * against current Mongo model files, KB sources, open decisions, graph
 * references, and the portal manifest at build time. This adapter exposes the
 * compiled types without allowing React to own or default architecture facts.
 * ========================================================================= */

import {
	usePortalData,
	type SchemaCluster,
	type SchemaCollection,
	type SchemaCollectionState,
	type SchemaTargetAction,
} from './portal-data';

export type Cluster = SchemaCluster;
export type Collection = SchemaCollection;
export type CollectionState = SchemaCollectionState;
export type TargetAction = SchemaTargetAction;

export function useSchemaNebulaData() {
	return usePortalData().schemaNebula;
}
