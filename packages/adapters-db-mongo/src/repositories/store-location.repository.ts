import { StoreLocation, WEEKDAYS } from '@saha-textile/contracts';
import { type StoreLocationRepository, compareStoreLocations } from '@saha-textile/core-domain';

import { StoreLocationModel, type StoreLocationDoc } from '../models/index';

const iso = (value: Date | null | undefined): string | undefined => (value ? new Date(value).toISOString() : undefined);

/** A stored week, always seven days Monday first, whatever an older row holds. */
const toHours = (stored: StoreLocationDoc['hours']): StoreLocation['hours'] =>
	WEEKDAYS.map((day) => {
		const entry = stored?.find((row) => row.day === day);
		return entry?.open && entry.opens && entry.closes
			? { day, open: true, opens: entry.opens, closes: entry.closes }
			: { day, open: false, opens: null, closes: null };
	});

const toStore = (doc: StoreLocationDoc): StoreLocation => ({
	id: doc._id,
	name: doc.name ?? {},
	address: doc.address ?? {},
	landmark: doc.landmark ?? {},
	pinCode: doc.pinCode,
	mapUrl: doc.mapUrl,
	geo: doc.geo && typeof doc.geo.lat === 'number' ? { lat: doc.geo.lat, lng: doc.geo.lng } : null,
	phone: doc.phone ?? null,
	hours: toHours(doc.hours),
	photoAssetIds: doc.photoAssetIds ?? [],
	imageVersions: doc.imageVersions ?? {},
	displayOrder: doc.displayOrder ?? 0,
	active: !!doc.active,
	createdAt: iso(doc.createdAt),
	updatedAt: iso(doc.updatedAt),
});

export class MongoStoreLocationRepository implements StoreLocationRepository {
	async list(): Promise<StoreLocation[]> {
		const docs = await StoreLocationModel.find().lean<StoreLocationDoc[]>().exec();
		return docs.map(toStore).sort(compareStoreLocations);
	}

	async findById(id: string): Promise<StoreLocation | null> {
		const doc = await StoreLocationModel.findById(id).lean<StoreLocationDoc>().exec();
		return doc ? toStore(doc) : null;
	}

	async save(store: StoreLocation): Promise<StoreLocation> {
		const { id, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = StoreLocation.parse(store);
		await StoreLocationModel.updateOne({ _id: id }, { $set: rest }, { upsert: true }).exec();
		return (await this.findById(id)) as StoreLocation;
	}

	async remove(id: string): Promise<void> {
		await StoreLocationModel.deleteOne({ _id: id }).exec();
	}

	async setOrder(ids: readonly string[]): Promise<void> {
		if (!ids.length) return;
		await StoreLocationModel.bulkWrite(
			ids.map((id, index) => ({ updateOne: { filter: { _id: id }, update: { $set: { displayOrder: index } } } })),
		);
	}
}
