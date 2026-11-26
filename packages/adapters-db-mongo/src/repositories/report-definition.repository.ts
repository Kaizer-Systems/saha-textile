import { ReportDefinition } from '@saha-textile/contracts';
import type { ReportDefinitionRepository } from '@saha-textile/core-domain';

import { ReportDefinitionModel } from '../models/bank.model';
import type { AggregateDoc } from '../models/purchasing.model';

const definitionOf = (doc: AggregateDoc): ReportDefinition => {
	const { _id, ...rest } = doc;
	return ReportDefinition.parse({ ...rest, id: _id });
};

/** Saved reports in MongoDB (`reportDefinitions`). */
export class MongoReportDefinitionRepository implements ReportDefinitionRepository {
	async list(): Promise<ReportDefinition[]> {
		const docs = await ReportDefinitionModel.find({}).sort({ folder: 1, name: 1 }).lean<AggregateDoc[]>().exec();
		return docs.map(definitionOf);
	}

	async get(id: string): Promise<ReportDefinition | null> {
		const doc = await ReportDefinitionModel.findById(id).lean<AggregateDoc>().exec();
		return doc ? definitionOf(doc) : null;
	}

	async insert(definition: ReportDefinition): Promise<void> {
		const { id, ...rest } = definition;
		await ReportDefinitionModel.create({ _id: id, ...rest });
	}

	async save(definition: ReportDefinition, expectedVersion: number): Promise<ReportDefinition> {
		const { id, ...rest } = definition;
		const result = await ReportDefinitionModel.updateOne(
			{ _id: id, version: expectedVersion },
			{ $set: { ...rest, version: expectedVersion + 1 } },
		).exec();
		if (!result.matchedCount) throw new Error('report_definition_changed');
		return { ...definition, version: expectedVersion + 1 };
	}

	async remove(id: string): Promise<boolean> {
		const result = await ReportDefinitionModel.deleteOne({ _id: id }).exec();
		return result.deletedCount > 0;
	}
}
