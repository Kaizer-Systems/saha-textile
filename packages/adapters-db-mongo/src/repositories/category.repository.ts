import type { Category } from '@saha/contracts';
import type { CategoryRepository } from '@saha/core-domain';

import { toCategory } from '../mappers';
import { type CategoryDoc, CategoryModel } from '../models/index';

export class MongoCategoryRepository implements CategoryRepository {
	async findById(id: string): Promise<Category | null> {
		const doc = await CategoryModel.findById(id).lean<CategoryDoc>().exec();
		return doc ? toCategory(doc) : null;
	}

	async findBySlug(slug: string): Promise<Category | null> {
		const doc = await CategoryModel.findOne({ slug }).lean<CategoryDoc>().exec();
		return doc ? toCategory(doc) : null;
	}

	async listChildren(parentId: string | null): Promise<Category[]> {
		const docs = await CategoryModel.find({ parentId }).sort({ displayOrder: 1 }).lean<CategoryDoc[]>().exec();
		return docs.map(toCategory);
	}

	async tree(): Promise<Category[]> {
		const docs = await CategoryModel.find().sort({ depth: 1, displayOrder: 1 }).lean<CategoryDoc[]>().exec();
		return docs.map(toCategory);
	}

	async save(category: Category): Promise<Category> {
		const { id, ...rest } = category;
		const doc = await CategoryModel.findByIdAndUpdate(
			id,
			{ $set: rest },
			{ upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
		)
			.lean<CategoryDoc>()
			.exec();
		return toCategory(doc as CategoryDoc);
	}

	async deleteById(id: string): Promise<void> {
		await CategoryModel.deleteOne({ _id: id }).exec();
	}
}
