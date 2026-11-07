/**
 * Fills the local database with the 1,000-product showcase catalogue.
 *
 *   pnpm --filter @saha-textile/adapters-db-mongo seed:showcase-catalogue
 *
 * Replaces the demo products by id and removes demo categories the live menu does not have.
 * Refuses a database name that does not contain "local". Safe to run twice. Afterwards run
 * `pnpm --filter @saha-textile/api search:rebuild`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { connectMongo, disconnectMongo } from '../src/connection';
import {
	CategoryModel,
	CategoryPlacementModel,
	ProductBundleModel,
	SeoRouteModel,
} from '../src/models/index';
import { mapDemoCatalogue } from '../src/seed/map-demo-catalogue';
import { assertLocalDatabase, writeCatalogue } from '../src/seed/seed-demo-catalogue';
import { buildShowcaseProducts, categoryIdsFor, finishShowcase } from './showcase-catalogue-build';

const dataFile = <T>(name: string): T[] =>
	(JSON.parse(readFileSync(resolve(__dirname, '../../../apps/storefront/public/assets/data', name), 'utf8')) as { data: T[] }).data;

async function main(): Promise<void> {
	const dbName = assertLocalDatabase(process.env['MONGODB_DB_NAME']);
	if (!dbName.includes('local')) throw new Error('The showcase catalogue is for a local database only.');
	const now = new Date();
	const productIds = dataFile<{ id: number }>('product.json').map((row) => row.id);
	const known = new Map(dataFile<{ id: number; canonical_path: string }>('category.json').map((row) => [row.canonical_path, row.id]));
	const showcase = buildShowcaseProducts({ productIds, categoryIds: categoryIdsFor(known), now });
	const mapped = finishShowcase(mapDemoCatalogue({ products: showcase.products }), showcase, now);

	await connectMongo();
	await ProductBundleModel.deleteMany({}).exec();
	await CategoryPlacementModel.deleteMany({ _id: { $nin: mapped.placements.map((row) => row.id) } }).exec();
	await CategoryModel.deleteMany({ _id: { $nin: mapped.categories.map((row) => row.id) } }).exec();
	await SeoRouteModel.deleteMany({ entityType: { $in: ['product', 'category'] } }).exec();
	const result = await writeCatalogue(dbName, mapped);
	for (const product of mapped.products) {
		const french = product.title['fr'] as string;
		await SeoRouteModel.updateOne(
			{ _id: `seo_fr_product_${product.slug}` },
			{ $set: { title: french, description: product.shortDescription['fr'] } },
		).exec();
	}
	console.log('[seed:showcase-catalogue] done:', result);
	await disconnectMongo();
}

main().catch((error: unknown) => {
	console.error('[seed:showcase-catalogue] failed:', error);
	process.exitCode = 1;
});
