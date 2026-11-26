import { LanguageRecord } from '@saha-textile/contracts';
import type { LanguageRepository } from '@saha-textile/core-domain';

import { LanguageModel, type LanguageDoc } from '../models/index';

const iso = (value: Date | null | undefined): string | null => (value ? new Date(value).toISOString() : null);
const date = (value: string | null): Date | null => (value ? new Date(value) : null);

const toRecord = (doc: LanguageDoc): LanguageRecord =>
	LanguageRecord.parse({
		code: doc._id,
		admin: !!doc.admin,
		shop: doc.shop,
		everOn: !!doc.everOn,
		addedAt: iso(doc.addedAt),
		addedBy: doc.addedBy ?? null,
		changedAt: iso(doc.changedAt),
		changedBy: doc.changedBy ?? null,
		deletedAt: iso(doc.deletedAt),
		deletedBy: doc.deletedBy ?? null,
		remindedAt: iso(doc.remindedAt),
		erasedAt: iso(doc.erasedAt),
	});

const toDoc = (record: LanguageRecord): Omit<LanguageDoc, '_id'> => ({
	admin: record.admin,
	shop: record.shop,
	everOn: record.everOn,
	addedAt: date(record.addedAt),
	addedBy: record.addedBy,
	changedAt: date(record.changedAt),
	changedBy: record.changedBy,
	deletedAt: date(record.deletedAt),
	deletedBy: record.deletedBy,
	remindedAt: date(record.remindedAt),
	erasedAt: date(record.erasedAt),
});

export class MongoLanguageRepository implements LanguageRepository {
	async list(): Promise<LanguageRecord[]> {
		const docs = await LanguageModel.find().sort({ addedAt: 1, _id: 1 }).lean<LanguageDoc[]>().exec();
		return docs.map(toRecord);
	}

	async find(code: string): Promise<LanguageRecord | null> {
		const doc = await LanguageModel.findById(code).lean<LanguageDoc>().exec();
		return doc ? toRecord(doc) : null;
	}

	async save(record: LanguageRecord): Promise<LanguageRecord> {
		const parsed = LanguageRecord.parse(record);
		await LanguageModel.updateOne({ _id: parsed.code }, { $set: toDoc(parsed) }, { upsert: true }).exec();
		return (await this.find(parsed.code)) as LanguageRecord;
	}

	/**
	 * Two API processes starting together may both find the list empty: each row is written only
	 * if absent, so they write the same rows once between them, and a list that already holds rows
	 * (deleted ones included) is never touched.
	 */
	async seedIfEmpty(records: readonly LanguageRecord[]): Promise<boolean> {
		if ((await LanguageModel.estimatedDocumentCount().exec()) > 0) return false;
		let wrote = false;
		for (const record of records) {
			const parsed = LanguageRecord.parse(record);
			try {
				const result = await LanguageModel.updateOne(
					{ _id: parsed.code },
					{ $setOnInsert: toDoc(parsed) },
					{ upsert: true },
				).exec();
				wrote ||= result.upsertedCount > 0;
			} catch (error) {
				// Another process inserted the same row between the read and this write.
				if ((error as { code?: number })?.code !== 11000) throw error;
			}
		}
		return wrote;
	}
}
