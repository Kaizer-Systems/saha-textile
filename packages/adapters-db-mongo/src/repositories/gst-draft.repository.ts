import { GstReturnDraft, type GstDraftType } from '@saha-textile/contracts';
import type { GstReturnDraftRepository } from '@saha-textile/core-domain';

import { GstReturnDraftModel } from '../models/bank.model';
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
