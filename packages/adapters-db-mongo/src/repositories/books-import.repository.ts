import { BooksImport } from '@saha-textile/contracts';
import type { BooksImportRepository } from '@saha-textile/core-domain';

import { BooksImportModel } from '../models/bank.model';
import type { AggregateDoc } from '../models/purchasing.model';

type Stored = BooksImport & { vouchersAtImport: number };

const fromDoc = ({ _id, vouchersAtImport, ...rest }: AggregateDoc): Stored => ({
	...BooksImport.parse({ ...rest, id: _id }),
	vouchersAtImport: Number(vouchersAtImport ?? 0),
});

/** Books brought in from another program, in MongoDB (`booksImports`). */
export class MongoBooksImportRepository implements BooksImportRepository {
	async list(): Promise<Stored[]> {
		const docs = await BooksImportModel.find({}).sort({ createdAt: -1 }).lean<AggregateDoc[]>().exec();
		return docs.map(fromDoc);
	}

	async get(id: string): Promise<Stored | null> {
		const doc = await BooksImportModel.findById(id).lean<AggregateDoc>().exec();
		return doc ? fromDoc(doc) : null;
	}

	async save(entry: Stored): Promise<void> {
		const { id, ...rest } = entry;
		await BooksImportModel.updateOne({ _id: id }, { $set: rest }, { upsert: true }).exec();
	}
}
