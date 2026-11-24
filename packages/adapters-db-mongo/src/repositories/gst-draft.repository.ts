import { GstReturnDraft, Gstr2bImport, type GstDraftType } from '@saha-textile/contracts';
import type { GstAnnualNoteRepository, GstReturnDraftRepository, Gstr2bRepository } from '@saha-textile/core-domain';

import { GstAnnualNoteModel, GstReturnDraftModel, Gstr2bImportModel } from '../models/bank.model';
import type { AggregateDoc } from '../models/purchasing.model';

const draftOf = (doc: AggregateDoc): GstReturnDraft => {
	const { _id, ...rest } = doc;
	return GstReturnDraft.parse({ ...rest, id: _id });
};

/** GST return drafts in MongoDB (`gstReturnDrafts`). */
export class MongoGstReturnDraftRepository implements GstReturnDraftRepository {
	async get(id: string): Promise<GstReturnDraft | null> {
		const doc = await GstReturnDraftModel.findById(id).lean<AggregateDoc>().exec();
		return doc ? draftOf(doc) : null;
	}

	async find(gstRegistrationId: string, returnType: GstDraftType, month: string): Promise<GstReturnDraft | null> {
		const doc = await GstReturnDraftModel.findOne({ gstRegistrationId, returnType, month })
			.lean<AggregateDoc>()
			.exec();
		return doc ? draftOf(doc) : null;
	}

	async listForRegistration(gstRegistrationId: string): Promise<GstReturnDraft[]> {
		const docs = await GstReturnDraftModel.find({ gstRegistrationId })
			.sort({ month: -1, returnType: 1 })
			.lean<AggregateDoc[]>()
			.exec();
		return docs.map(draftOf);
	}

	async save(draft: GstReturnDraft, expectedVersion: number | null): Promise<GstReturnDraft> {
		const { id, ...rest } = draft;
		if (expectedVersion === null) {
			const saved = { ...rest, version: 0 };
			await GstReturnDraftModel.create({ _id: id, ...saved }).catch((error: { code?: number }) => {
				throw error.code === 11000 ? new Error('gst_draft_exists', { cause: error }) : error;
			});
			return { ...draft, version: 0 };
		}
		const next = { ...rest, version: expectedVersion + 1 };
		const result = await GstReturnDraftModel.updateOne(
			{ _id: id, version: expectedVersion },
			{ $set: next },
		).exec();
		if (!result.matchedCount) throw new Error('gst_draft_changed');
		return { ...draft, version: expectedVersion + 1 };
	}
}

const importOf = (doc: AggregateDoc): Gstr2bImport => {
	const { _id, ...rest } = doc;
	return Gstr2bImport.parse({ ...rest, id: _id });
};

/** Imported GSTR-2B files in MongoDB (`gstr2bImports`). */
export class MongoGstr2bRepository implements Gstr2bRepository {
	async find(gstRegistrationId: string, month: string): Promise<Gstr2bImport | null> {
		const doc = await Gstr2bImportModel.findOne({ gstRegistrationId, month }).lean<AggregateDoc>().exec();
		return doc ? importOf(doc) : null;
	}

	async listForRegistration(gstRegistrationId: string): Promise<Gstr2bImport[]> {
		const docs = await Gstr2bImportModel.find({ gstRegistrationId })
			.sort({ month: 1 })
			.lean<AggregateDoc[]>()
			.exec();
		return docs.map(importOf);
	}

	async save(doc: Gstr2bImport, expectedVersion: number | null): Promise<Gstr2bImport> {
		const { id, ...rest } = doc;
		if (expectedVersion === null) {
			await Gstr2bImportModel.create({ _id: id, ...rest, version: 0 }).catch((error: { code?: number }) => {
				throw error.code === 11000 ? new Error('gstr2b_exists', { cause: error }) : error;
			});
			return { ...doc, version: 0 };
		}
		const result = await Gstr2bImportModel.updateOne(
			{ _id: id, version: expectedVersion },
			{ $set: { ...rest, version: expectedVersion + 1 } },
		).exec();
		if (!result.matchedCount) throw new Error('gstr2b_changed');
		return { ...doc, version: expectedVersion + 1 };
	}
}

/** GSTR-9's notes in MongoDB (`gstAnnualNotes`), one document per registration and year. */
export class MongoGstAnnualNoteRepository implements GstAnnualNoteRepository {
	async get(
		gstRegistrationId: string,
		year: string,
	): Promise<{ notes: Record<string, string>; version: number } | null> {
		const doc = await GstAnnualNoteModel.findById(`${gstRegistrationId}|${year}`).lean<AggregateDoc>().exec();
		if (!doc) return null;
		return {
			notes: (doc['notes'] as Record<string, string> | undefined) ?? {},
			version: Number(doc['version'] ?? 0),
		};
	}

	async save(
		gstRegistrationId: string,
		year: string,
		notes: Record<string, string>,
		expectedVersion: number | null,
	): Promise<number> {
		const _id = `${gstRegistrationId}|${year}`;
		if (expectedVersion === null) {
			await GstAnnualNoteModel.create({ _id, gstRegistrationId, year, notes, version: 0 }).catch(
				(error: { code?: number }) => {
					throw error.code === 11000 ? new Error('gst_annual_changed', { cause: error }) : error;
				},
			);
			return 0;
		}
		const result = await GstAnnualNoteModel.updateOne(
			{ _id, version: expectedVersion },
			{ $set: { notes, version: expectedVersion + 1 } },
		).exec();
		if (!result.matchedCount) throw new Error('gst_annual_changed');
		return expectedVersion + 1;
	}
}
