import type { LegalPage, LegalPageSlug } from '@saha-textile/contracts';
import type { LegalPageRepository } from '@saha-textile/core-domain';

import { LegalPageModel, LegalPageRevisionModel, type LegalPageDoc } from '../models/index';

const toPage = (doc: LegalPageDoc): LegalPage => ({
	slug: doc._id as LegalPageSlug,
	title: doc.title ?? {},
	content: doc.content ?? {},
	metaTitle: doc.metaTitle ?? {},
	metaDescription: doc.metaDescription ?? {},
	metaImageAssetId: doc.metaImageAssetId ?? null,
	version: doc.version,
	updatedAt: new Date(doc.updatedAt).toISOString(),
	updatedBy: doc.updatedBy ?? null,
});

const toDoc = (page: LegalPage) => ({
	title: page.title,
	content: page.content,
	metaTitle: page.metaTitle,
	metaDescription: page.metaDescription,
	metaImageAssetId: page.metaImageAssetId,
	version: page.version,
	updatedAt: new Date(page.updatedAt),
	updatedBy: page.updatedBy,
});

/** The four legal pages, and every earlier version kept beside them (Legal Pages brief, choice 3). */
export class MongoLegalPageRepository implements LegalPageRepository {
	async list(): Promise<LegalPage[]> {
		const docs = await LegalPageModel.find({}).lean<LegalPageDoc[]>().exec();
		return docs.map(toPage);
	}

	async find(slug: LegalPageSlug): Promise<LegalPage | null> {
		const doc = await LegalPageModel.findById(slug).lean<LegalPageDoc>().exec();
		return doc ? toPage(doc) : null;
	}

	async save(page: LegalPage, replaced: LegalPage | null): Promise<void> {
		const session = await LegalPageModel.db.startSession();
		try {
			await session.withTransaction(async () => {
				if (replaced) {
					await LegalPageRevisionModel.updateOne(
						{ _id: `${replaced.slug}:${replaced.version}` },
						{ $set: { slug: replaced.slug, ...toDoc(replaced) } },
						{ upsert: true, session },
					).exec();
				}
				await LegalPageModel.updateOne(
					{ _id: page.slug },
					{ $set: toDoc(page) },
					{ upsert: true, session },
				).exec();
			});
		} finally {
			await session.endSession();
		}
	}

	async createIfMissing(page: LegalPage): Promise<boolean> {
		const result = await LegalPageModel.updateOne(
			{ _id: page.slug },
			{ $setOnInsert: toDoc(page) },
			{ upsert: true },
		).exec();
		return result.upsertedCount > 0;
	}
}
