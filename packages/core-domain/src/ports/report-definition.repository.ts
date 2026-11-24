import type { ReportDefinition } from '@saha-textile/contracts';

/** Saved reports (accounts brief V2): the builder's choices, never the figures. */
export interface ReportDefinitionRepository {
	list(): Promise<ReportDefinition[]>;
	get(id: string): Promise<ReportDefinition | null>;
	insert(definition: ReportDefinition): Promise<void>;
	/** Refused with `report_definition_changed` when someone saved since `expectedVersion`; stored one higher. */
	save(definition: ReportDefinition, expectedVersion: number): Promise<ReportDefinition>;
	remove(id: string): Promise<boolean>;
}
