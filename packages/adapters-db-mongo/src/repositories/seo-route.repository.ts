import type { SeoRoute } from '@saha-textile/contracts';
import type { SeoRouteRepository } from '@saha-textile/core-domain';

import { SeoRouteModel, type SeoRouteDoc } from '../models/seoRoute.model';

const toRoute = (doc: SeoRouteDoc): SeoRoute => ({
	id: doc._id,
	path: doc.path,
	locale: doc.locale,
	title: doc.title,
	description: doc.description,
	canonicalPath: doc.canonicalPath,
	robots: doc.robots,
	indexable: doc.indexable,
	...(doc.entityType ? { entityType: doc.entityType } : {}),
	...(doc.entityId ? { entityId: doc.entityId } : {}),
});

export class MongoSeoRouteRepository implements SeoRouteRepository {
	async find(path: string, locale: 'en' | 'fr'): Promise<SeoRoute | null> {
		const doc = await SeoRouteModel.findOne({ path, locale }).lean<SeoRouteDoc>().exec();
		return doc ? toRoute(doc) : null;
	}

	async listIndexable(): Promise<SeoRoute[]> {
		const docs = await SeoRouteModel.find({ indexable: true }).lean<SeoRouteDoc[]>().exec();
		return docs.map(toRoute);
	}

	async save(route: SeoRoute): Promise<SeoRoute> {
		const { id, ...rest } = route;
		await SeoRouteModel.findByIdAndUpdate(id, { $set: rest }, { upsert: true, setDefaultsOnInsert: true }).exec();
		return route;
	}
}
