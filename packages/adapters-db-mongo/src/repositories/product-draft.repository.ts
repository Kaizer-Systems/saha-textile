import { ProductDraft } from '@saha-textile/contracts';
import type { Paginated, ProductDraftFilter, ProductDraftRepository } from '@saha-textile/core-domain';

import { ProductDraftModel, type ProductDraftDoc } from '../models/index';

const iso = (value: Date | null | undefined): string | null => (value ? new Date(value).toISOString() : null);

const toDraft = (doc: ProductDraftDoc): ProductDraft =>
	ProductDraft.parse({
		id: doc._id,
		kind: doc.kind,
		productId: doc.productId ?? null,
		title: doc.title ?? '',
		imageAssetId: doc.imageAssetId ?? null,
		form: doc.form ?? {},
		changes: doc.changes ?? [],
		toFix: doc.toFix ?? 0,
		baseSavedAt: iso(doc.baseSavedAt),
		createdBy: doc.createdBy ?? null,
		updatedBy: doc.updatedBy ?? null,
		createdAt: iso(doc.createdAt),
		updatedAt: iso(doc.updatedAt),
	});

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Product drafts: unfinished product-form work, newest save first. */
export class MongoProductDraftRepository implements ProductDraftRepository {
	async findById(id: string): Promise<ProductDraft | null> {
		const doc = await ProductDraftModel.findById(id).lean<ProductDraftDoc>().exec();
		return doc ? toDraft(doc) : null;
	}

	async findEdit(productId: string, createdBy: string | null): Promise<ProductDraft | null> {
		const doc = await ProductDraftModel.findOne({ kind: 'edit', productId, createdBy })
			.lean<ProductDraftDoc>()
			.exec();
		return doc ? toDraft(doc) : null;
	}

	async list(filter: ProductDraftFilter): Promise<Paginated<ProductDraft>> {
		const query: Record<string, unknown> = {};
		if (filter.createdBy) query.createdBy = filter.createdBy;
		if (filter.productId) query.productId = filter.productId;
		const words = (filter.search ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 8);
		if (words.length) query.$and = words.map((word) => ({ title: new RegExp(escapeRegex(word), 'i') }));
		const [docs, total] = await Promise.all([
			ProductDraftModel.find(query)
				.sort({ updatedAt: -1, _id: 1 })
				.skip((filter.page - 1) * filter.pageSize)
				.limit(filter.pageSize)
				.lean<ProductDraftDoc[]>()
				.exec(),
			ProductDraftModel.countDocuments(query).exec(),
		]);
		return { items: docs.map(toDraft), total, page: filter.page, pageSize: filter.pageSize };
	}

	countBy(createdBy: string): Promise<number> {
		return ProductDraftModel.countDocuments({ createdBy }).exec();
	}

	async save(draft: ProductDraft): Promise<ProductDraft> {
		const { id, ...rest } = draft;
		const doc = {
			...rest,
			baseSavedAt: draft.baseSavedAt ? new Date(draft.baseSavedAt) : null,
			createdAt: new Date(draft.createdAt),
			updatedAt: new Date(draft.updatedAt),
		};
		const saved = await ProductDraftModel.findOneAndUpdate({ _id: id }, { $set: doc }, { upsert: true, new: true })
			.lean<ProductDraftDoc>()
			.exec();
		return toDraft(saved as ProductDraftDoc);
	}

	async remove(id: string): Promise<void> {
		await ProductDraftModel.deleteOne({ _id: id }).exec();
	}

	async removeForProduct(productId: string): Promise<number> {
		const result = await ProductDraftModel.deleteMany({ productId }).exec();
		return result.deletedCount ?? 0;
	}
}
