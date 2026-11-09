import { SearchTerm } from '@saha-textile/contracts';
import { termWords, type Paginated, type SearchTermFilter, type SearchTermRepository } from '@saha-textile/core-domain';

import { SearchTermModel, type SearchTermDoc } from '../models/index';

/** The contract fills a missing list or status, so an old row without them still reads. */
const toTerm = (doc: SearchTermDoc): SearchTerm =>
	SearchTerm.parse({
		id: doc._id,
		name: doc.name ?? {},
		spellings: doc.spellings,
		categoryIds: doc.categoryIds,
		productIds: doc.productIds,
		status: doc.status,
		createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : undefined,
		updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : undefined,
	});

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class MongoSearchTermRepository implements SearchTermRepository {
	async list({ search, status, page, pageSize }: SearchTermFilter): Promise<Paginated<SearchTerm>> {
		const words = (search ?? '').toLocaleLowerCase('en').split(/\s+/).filter(Boolean);
		const filter = {
			...(status ? { status } : {}),
			...(words.length ? { $and: words.map((word) => ({ searchText: { $regex: escape(word) } })) } : {}),
		};
		const [docs, total] = await Promise.all([
			SearchTermModel.find(filter)
				.sort({ updatedAt: -1, _id: 1 })
				.skip((page - 1) * pageSize)
				.limit(pageSize)
				.lean<SearchTermDoc[]>()
				.exec(),
			SearchTermModel.countDocuments(filter).exec(),
		]);
		return { items: docs.map(toTerm), total, page, pageSize };
	}

	async listLive(): Promise<SearchTerm[]> {
		const docs = await SearchTermModel.find({ status: 'live' }).sort({ _id: 1 }).lean<SearchTermDoc[]>().exec();
		return docs.map(toTerm);
	}

	async findById(id: string): Promise<SearchTerm | null> {
		const doc = await SearchTermModel.findById(id).lean<SearchTermDoc>().exec();
		return doc ? toTerm(doc) : null;
	}

	async findManyByIds(ids: readonly string[]): Promise<SearchTerm[]> {
		if (!ids.length) return [];
		const docs = await SearchTermModel.find({ _id: { $in: [...ids] } })
			.lean<SearchTermDoc[]>()
			.exec();
		return docs.map(toTerm);
	}

	async save(term: SearchTerm): Promise<SearchTerm> {
		const { id, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = term;
		await SearchTermModel.updateOne(
			{ _id: id },
			{ $set: { ...rest, searchText: termWords(term).join(' ') } },
			{ upsert: true },
		).exec();
		return (await this.findById(id)) ?? term;
	}

	async remove(id: string): Promise<void> {
		await SearchTermModel.deleteOne({ _id: id }).exec();
	}
}
