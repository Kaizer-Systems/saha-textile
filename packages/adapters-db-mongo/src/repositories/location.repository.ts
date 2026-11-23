import { Location, AdminUserLocations } from '@saha-textile/contracts';
import { type LocationRepository, StaleVersionError } from '@saha-textile/core-domain';

import { LocationModel, AdminUserLocationsModel } from '../models/locations.model';
import type { AggregateDoc } from '../models/purchasing.model';

const strip = (doc: AggregateDoc): Record<string, unknown> => {
	const { _id, ...rest } = doc;
	void _id;
	return rest;
};

export class MongoLocationRepository implements LocationRepository {
	async list(): Promise<Location[]> {
		const docs = await LocationModel.find({}).sort({ active: -1, name: 1 }).lean<AggregateDoc[]>().exec();
		return docs.map((doc) => Location.parse({ ...strip(doc), id: doc._id }));
	}

	async get(id: string): Promise<Location | null> {
		const doc = await LocationModel.findById(id).lean<AggregateDoc>().exec();
		return doc ? Location.parse({ ...strip(doc), id: doc._id }) : null;
	}

	async save(location: Location, expectedUpdatedAt: string | null): Promise<void> {
		const { id, ...rest } = location;
		try {
			if (expectedUpdatedAt === null) {
				await LocationModel.create({ _id: id, ...rest });
				return;
			}
			const result = await LocationModel.updateOne(
				{ _id: id, updatedAt: expectedUpdatedAt },
				{ $set: rest },
			).exec();
			if (result.matchedCount === 1) return;
		} catch (error) {
			if ((error as { code?: number }).code !== 11000) throw error;
			if (
				expectedUpdatedAt === null &&
				(error as { keyPattern?: Record<string, unknown> }).keyPattern?.['shortCode']
			)
				throw new Error('short_code_taken', { cause: error });
		}
		const now = await this.get(id);
		throw new StaleVersionError('location', id, {
			version: 0,
			updatedAt: now?.updatedAt ?? '',
			updatedBy: now?.updatedBy ?? null,
		});
	}

	async adminUserLocations(userId: string): Promise<AdminUserLocations | null> {
		const doc = await AdminUserLocationsModel.findById(userId).lean<AggregateDoc>().exec();
		return doc ? AdminUserLocations.parse({ ...strip(doc), userId: doc._id }) : null;
	}

	async saveAdminUserLocations(value: AdminUserLocations): Promise<void> {
		const { userId, ...rest } = value;
		await AdminUserLocationsModel.updateOne({ _id: userId }, { $set: rest }, { upsert: true }).exec();
	}

	async allAdminUserLocations(): Promise<AdminUserLocations[]> {
		const docs = await AdminUserLocationsModel.find({}).lean<AggregateDoc[]>().exec();
		return docs.map((doc) => AdminUserLocations.parse({ ...strip(doc), userId: doc._id }));
	}
}
