/**
 * Live catalog check for the Chunk F slice (local replica set only).
 *
 *   pnpm --filter @saha-textile/api e2e:catalog-chunk-f
 *
 * Writes a throwaway product, two SKUs, and a redirect chain, then deletes them.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import {
	MongoProductRepository,
	MongoProductVariantRepository,
	MongoSeoRedirectRepository,
	ProductModel,
	ProductVariantModel,
	SeoRedirectModel,
	buildMongoConfig,
	connectMongo,
	disconnectMongo,
} from '@saha-textile/adapters-db-mongo';
import { Product, ProductVariant } from '@saha-textile/contracts';

import { CatalogService } from '../src/catalog/catalog.service';

const check = (ok: boolean, label: string) => {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
	if (!ok) process.exitCode = 1;
};

async function main(): Promise<void> {
	const { dbName } = buildMongoConfig();
	if (!dbName.includes('local')) {
		throw new Error(`refusing to run against non-local database "${dbName}"`);
	}

	const stamp = randomUUID().slice(0, 8);
	const productId = `e2e_prod_${stamp}`;
	const slug = `e2e-banarasi-${stamp}`;
	const redId = `e2e_var_${stamp}_red`;
	const greenId = `e2e_var_${stamp}_green`;
	const sourceA = `/e2e/${stamp}/a`;
	const sourceB = `/e2e/${stamp}/b`;
	const sourceC = `/e2e/${stamp}/c`;

	const products = new MongoProductRepository();
	const variants = new MongoProductVariantRepository();
	const redirects = new MongoSeoRedirectRepository();
	const catalog = new CatalogService(products, {} as never, variants, redirects);

	await connectMongo();
	try {
		await products.save(
			Product.parse({
				id: productId,
				type: 'variable',
				sku: `E2E-${stamp}`,
				title: { en: 'E2E Banarasi' },
				slug,
				basePriceINR: 2450,
				status: 'live',
			}),
		);
		const row = (id: string, sku: string, priceINR: number, isBaseVariant: boolean) =>
			ProductVariant.parse({
				id,
				productId,
				sku,
				status: 'live',
				optionSelections: [{ attributeCode: 'color', termCode: sku }],
				optionSelectionHash: `color:${sku}`,
				isBaseVariant,
				priceINR,
				stock: { quantity: 2 },
			});
		await variants.save(row(redId, `E2E-${stamp}-RED`, 2450, true));
		await variants.save(row(greenId, `E2E-${stamp}-GREEN`, 3950, false));

		const view = await catalog.productRead(slug);
		check(view.price?.kind === 'range' && view.price.minINR === 2450 && view.price.maxINR === 3950, 'card range');
		check(view.selected?.sku === `E2E-${stamp}-RED`, 'default SKU is the base variant');
		check(!('variants' in view), 'read model has no variant matrix');

		const known = await catalog.productRead(slug, `E2E-${stamp}-GREEN`);
		check(known.unknownVariant === false && known.selected?.sku === `E2E-${stamp}-GREEN`, 'known variant');
		const unknown = await catalog.productRead(slug, 'missing');
		check(
			unknown.unknownVariant === true && unknown.selected?.sku === `E2E-${stamp}-RED`,
			'unknown variant keeps default',
		);

		await catalog.saveRedirect({
			sourcePath: sourceB,
			statusCode: 301,
			targetPath: sourceC,
			reason: 'slug_change',
		});
		const collapsed = await catalog.saveRedirect({
			sourcePath: sourceA,
			statusCode: 301,
			targetPath: sourceB,
			reason: 'slug_change',
		});
		check(collapsed.targetPath === sourceC, 'redirect chain collapses to one hop');

		let looped = false;
		try {
			await catalog.saveRedirect({
				sourcePath: sourceC,
				statusCode: 301,
				targetPath: sourceA,
				reason: 'slug_change',
			});
		} catch (error) {
			looped = error instanceof Error && error.message === 'redirect loop';
		}
		check(looped && (await redirects.findBySource(sourceC)) === null, 'loop is rejected and not stored');

		await expectGone(catalog);
	} finally {
		await SeoRedirectModel.deleteMany({ sourcePath: { $in: [sourceA, sourceB, sourceC] } }).exec();
		await ProductVariantModel.deleteMany({ productId }).exec();
		await ProductModel.deleteOne({ _id: productId }).exec();
		await disconnectMongo();
	}
	if (process.exitCode === 1) throw new Error('catalog chunk F e2e failed');
}

async function expectGone(catalog: CatalogService): Promise<void> {
	let missing = false;
	try {
		await catalog.productRead('e2e-no-such-saree');
	} catch {
		missing = true;
	}
	check(missing, 'unknown slug is not found');
}

void main();
