import type { DocumentFormat, DocumentKind } from '@saha-textile/contracts';
import type { DocumentFormatRepository } from '@saha-textile/core-domain';
import mongoose from 'mongoose';

import { DocumentFormatModel, type DocumentFormatDoc } from '../models/index';

const toFormat = (doc: DocumentFormatDoc): DocumentFormat =>
	({
		id: doc._id,
		doc: doc.doc,
		name: doc.name,
		about: doc.about ?? '',
		paper: doc.paper ?? 'a4',
		blocks: doc.blocks ?? [],
		active: doc.active === true,
		seeded: doc.seeded === true,
		version: doc.version ?? 1,
		updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
		updatedBy: doc.updatedBy ?? null,
	}) as DocumentFormat;

/** Settings › Document formats (bundle builder brief F): exactly one active format per document. */
export class MongoDocumentFormatRepository implements DocumentFormatRepository {
	async list(): Promise<DocumentFormat[]> {
		const docs = await DocumentFormatModel.find({})
			.sort({ doc: 1, seeded: -1, createdAt: 1, _id: 1 })
			.lean()
			.exec();
		return docs.map((doc) => toFormat(doc as DocumentFormatDoc));
	}

	async findById(id: string): Promise<DocumentFormat | null> {
		const doc = await DocumentFormatModel.findById(id).lean().exec();
		return doc ? toFormat(doc as DocumentFormatDoc) : null;
	}

	async findActive(doc: DocumentKind): Promise<DocumentFormat | null> {
		const found = await DocumentFormatModel.findOne({ doc, active: true }).lean().exec();
		return found ? toFormat(found as DocumentFormatDoc) : null;
	}

	async create(format: DocumentFormat): Promise<DocumentFormat> {
		const { id, updatedAt: _u, ...rest } = format;
		const created = await DocumentFormatModel.create({ _id: id, ...rest });
		return toFormat(created.toObject() as DocumentFormatDoc);
	}

	async update(format: DocumentFormat, expectedVersion: number): Promise<DocumentFormat | null> {
		const { id, updatedAt: _u, active: _a, seeded: _s, doc: _d, ...rest } = format;
		const saved = await DocumentFormatModel.findOneAndUpdate(
			{ _id: id, version: expectedVersion },
			{ $set: { ...rest, version: expectedVersion + 1 } },
			{ new: true },
		)
			.lean()
			.exec();
		return saved ? toFormat(saved as DocumentFormatDoc) : null;
	}

	async switchOn(id: string, by: string): Promise<{ on: DocumentFormat; off: DocumentFormat | null } | null> {
		const session = await mongoose.startSession();
		try {
			let result: { on: DocumentFormat; off: DocumentFormat | null } | null = null;
			await session.withTransaction(async () => {
				const chosen = await DocumentFormatModel.findById(id).session(session).lean().exec();
				if (!chosen) {
					result = null;
					return;
				}
				const previous = await DocumentFormatModel.findOne({ doc: chosen.doc, active: true, _id: { $ne: id } })
					.session(session)
					.lean()
					.exec();
				// Off first: the partial unique index allows one active format per document at any moment.
				if (previous) {
					await DocumentFormatModel.updateOne(
						{ _id: previous._id },
						{ $set: { active: false, updatedBy: by } },
						{ session },
					).exec();
				}
				const on = await DocumentFormatModel.findOneAndUpdate(
					{ _id: id },
					{ $set: { active: true, updatedBy: by } },
					{ new: true, session },
				)
					.lean()
					.exec();
				result = {
					on: toFormat(on as DocumentFormatDoc),
					off: previous ? toFormat({ ...(previous as DocumentFormatDoc), active: false }) : null,
				};
			});
			return result;
		} finally {
			await session.endSession();
		}
	}
}
