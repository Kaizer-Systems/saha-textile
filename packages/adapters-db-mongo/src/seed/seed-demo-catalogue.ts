import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Model } from 'mongoose';

import { seedBundlePriceMethods } from '../migrations/bundles-v2';
import {
	AttributeDefinitionModel,
	CategoryModel,
	CategoryPlacementModel,
	MediaAssetModel,
	ProductBundleModel,
	ProductModel,
	ProductVariantModel,
	SeoRedirectModel,
	SeoRouteModel,
} from '../models/index';
import { AddonTemplateModel } from '../models/merchandising.model';
import { MongoNotificationTemplateRepository } from '../repositories/index';
import { CATALOG_NOTIFICATION_TEMPLATES } from './notification-templates';
import { LEGACY_ADDRESSES, approvedLegacyRows, legacyTargetIsLive } from './legacy-addresses';
import { mapDemoCatalogue, type DemoCatalogue } from './map-demo-catalogue';

export interface DemoCatalogueSeedResult {
	products: number;
	variants: number;
	categories: number;
	placements: number;
	attributes: number;
	bundles: number;
	addonTemplates: number;
	photoAssets: number;
	redirects: number;
	seoRoutes: number;
	written: number;
}

const dataFile = (name: string): { data: unknown[] } =>
	JSON.parse(readFileSync(resolve(__dirname, '../../../../apps/storefront/public/assets/data', name), 'utf8')) as {
		data: unknown[];
	};

/** Refuses any database but a local one, or the throwaway browser-test database. */
export function assertLocalDatabase(name: string | undefined): string {
	if (!name || !(name.toLowerCase().includes('local') || name === 'saha_textile_e2e')) {
		throw new Error(`Refusing to seed catalogue into "${name ?? ''}". The database name must contain "local".`);
	}
	return name;
}

const IGNORED = new Set(['_id', '__v', 'createdAt', 'updatedAt']);

function canon(value: unknown): unknown {
	if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
		const parsed = new Date(value);
		if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
	}
	return value;
}

function norm(value: unknown): unknown {
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'string') return canon(value);
	if (Array.isArray(value)) return value.map(norm);
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(value as object).sort()) {
			if (IGNORED.has(key)) continue;
			const child = (value as Record<string, unknown>)[key];
			if (child === undefined) continue;
			out[key] = norm(child);
		}
		return out;
	}
	return value;
}

/** Compare only the keys the seed writes, so mongoose defaults do not force a rewrite. */
export function sameDocument(current: unknown, desired: unknown): boolean {
	const project = (stored: unknown, shape: unknown): unknown => {
		if (Array.isArray(shape)) {
			return Array.isArray(stored) ? shape.map((item, index) => project(stored[index], item)) : norm(stored);
		}
		if (shape && typeof shape === 'object') {
			const out: Record<string, unknown> = {};
			for (const key of Object.keys(shape as object).sort()) {
				if (IGNORED.has(key)) continue;
				const child = (shape as Record<string, unknown>)[key];
				if (child === undefined) continue;
				const fromStored =
					stored && typeof stored === 'object' ? (stored as Record<string, unknown>)[key] : undefined;
				out[key] = project(fromStored, child);
			}
			return out;
		}
		if (stored instanceof Date) return stored.toISOString();
		return canon(stored);
	};
	return JSON.stringify(project(current, desired)) === JSON.stringify(norm(desired));
}

async function freeUnique<T extends { _id: string }>(model: Model<T>, field: string, docs: T[]): Promise<void> {
	const values = docs.map((doc) => (doc as Record<string, unknown>)[field]).filter((value) => value !== undefined);
	if (values.length === 0) return;
	const conflicts = await model
		.find({ [field]: { $in: values }, _id: { $nin: docs.map((doc) => doc._id) } } as never)
		.select(`_id ${field}`)
		.lean<Array<Record<string, unknown>>>()
		.exec();
	if (conflicts.length === 0) return;
	await model.bulkWrite(
		conflicts.map((row) => ({
			updateOne: {
				filter: { _id: row['_id'] },
				update: { $set: { [field]: `${String(row[field])}-retired-${String(row['_id'])}` } },
			},
		})) as Parameters<Model<T>['bulkWrite']>[0],
	);
}

async function upsertChanged<T extends { _id: string }>(
	model: Model<T>,
	docs: T[],
	uniqueFields: string[] = [],
): Promise<number> {
	for (const field of uniqueFields) await freeUnique(model, field, docs);
	if (docs.length === 0) return 0;
	const existing = await model
		.find({ _id: { $in: docs.map((doc) => doc._id) } })
		.lean<Array<T & { _id: string }>>()
		.exec();
	const byId = new Map(existing.map((doc) => [String(doc._id), doc]));
	const operations = docs.flatMap((doc) => {
		const current = byId.get(doc._id);
		if (current && sameDocument(current, doc)) return [];
		return [{ updateOne: { filter: { _id: doc._id }, update: { $set: doc }, upsert: true } }];
	});
	if (operations.length > 0) {
		console.log(`[seed:demo-catalogue] ${model.collection.collectionName}: ${operations.length}`);
		await model.bulkWrite(operations as Parameters<Model<T>['bulkWrite']>[0]);
	}
	return operations.length;
}

function documents(mapped: DemoCatalogue) {
	return {
		categories: mapped.categories.map(({ id, ...rest }) => ({ _id: id, ...rest })),
		placements: mapped.placements.map(({ id, pathSlugs, ...rest }) => ({
			_id: id,
			...rest,
			pathSlugs,
			pathKey: pathSlugs.join('/'),
		})),
		attributes: mapped.attributeDefinitions.map(({ id, ...rest }) => ({ _id: id, ...rest })),
		products: mapped.products.map(({ id, ...rest }) => ({ _id: id, ...rest })),
		variants: mapped.variants.map(({ id, ...rest }) => ({ _id: id, ...rest })),
		bundles: mapped.bundles.map(({ id, ...rest }) => ({
			_id: id,
			...rest,
			memberIds: [
				...new Set(
					[...rest.levels.flatMap((level) => level.items), ...rest.extras].map((item) => item.productId),
				),
			],
			methodId: rest.pricing.methodId,
		})),
		addonTemplates: mapped.addonTemplates.map((template) => ({
			_id: template.id,
			code: template.code,
			label: template.label,
			priceINR: 0,
			fields: template.fields,
			sizeGuide: template.sizeGuide,
		})),
		photoAssets: mapped.photoAssets.map(({ id, ...rest }) => ({ _id: id, ...rest })),
	};
}

/**
 * Idempotent import of the demo textile catalogue. A second run writes nothing
 * when the documents already match. Photo assets are inserted only when missing,
 * so a real pipeline upload is left alone.
 */
export async function seedDemoCatalogue(dbName: string | undefined): Promise<DemoCatalogueSeedResult> {
	return writeCatalogue(
		dbName,
		mapDemoCatalogue({
			products: dataFile('product.json').data as never,
			attributes: dataFile('attribute.json').data as never,
		}),
	);
}

/** Writes a mapped catalogue. Only documents that differ are touched. */
export async function writeCatalogue(
	dbName: string | undefined,
	mapped: DemoCatalogue,
): Promise<DemoCatalogueSeedResult> {
	assertLocalDatabase(dbName);
	const docs = documents(mapped);
	const existingPhotos = await MediaAssetModel.find({ _id: { $in: docs.photoAssets.map((asset) => asset._id) } })
		.select('_id')
		.lean<Array<{ _id: string }>>()
		.exec();
	const present = new Set(existingPhotos.map((asset) => String(asset._id)));
	const missingPhotos = docs.photoAssets.filter((asset) => !present.has(asset._id));

	await ProductVariantModel.deleteMany({
		productId: { $in: docs.products.map((product) => product._id) },
		_id: { $nin: docs.variants.map((variant) => variant._id) },
	}).exec();

	let written = [
		await upsertChanged(CategoryModel, docs.categories as never, ['slug']),
		await upsertChanged(CategoryPlacementModel, docs.placements as never, ['pathKey']),
		await upsertChanged(AttributeDefinitionModel, docs.attributes as never, ['code']),
		await upsertChanged(ProductModel, docs.products as never, ['slug', 'sku']),
		await upsertChanged(ProductVariantModel, docs.variants as never, ['sku']),
		(await seedBundlePriceMethods(), 0),
		await upsertChanged(ProductBundleModel, docs.bundles as never),
		await upsertChanged(AddonTemplateModel, docs.addonTemplates as never, ['code']),
		await upsertChanged(MediaAssetModel, missingPhotos as never),
	].reduce((sum, count) => sum + count, 0);

	const templates = new MongoNotificationTemplateRepository();
	for (const template of CATALOG_NOTIFICATION_TEMPLATES) await templates.upsert(template);

	const livePaths = new Set(
		(
			await CategoryPlacementModel.find({ status: 'live' })
				.select('pathKey')
				.lean<Array<{ pathKey?: string }>>()
				.exec()
		).map((row) => row.pathKey ?? ''),
	);
	const legacy = approvedLegacyRows(LEGACY_ADDRESSES);
	for (const row of legacy) {
		if (row.statusCode !== 410 && row.targetPath && !legacyTargetIsLive(row.targetPath, livePaths)) {
			throw new Error(`Legacy target is not a live page: ${row.sourcePath} -> ${row.targetPath}`);
		}
	}
	const redirectDocs = legacy.map((row) => ({
		_id: `redir_${row.sourcePath.replace(/[^a-z0-9]+/g, '_')}`,
		sourcePath: row.sourcePath,
		statusCode: row.statusCode,
		...(row.targetPath ? { targetPath: row.targetPath } : {}),
		reason: 'legacy_woo',
	}));
	const seoDocs = seoRouteDocs(mapped);
	written += await upsertChanged(SeoRedirectModel, redirectDocs as never, ['sourcePath']);
	written += await upsertChanged(SeoRouteModel, seoDocs as never);

	return {
		products: mapped.products.length,
		variants: mapped.variants.length,
		categories: mapped.categories.length,
		placements: mapped.placements.length,
		attributes: mapped.attributeDefinitions.length,
		bundles: mapped.bundles.length,
		addonTemplates: mapped.addonTemplates.length,
		photoAssets: mapped.photoAssets.length,
		redirects: redirectDocs.length,
		seoRoutes: seoDocs.length,
		written,
	};
}

function seoRouteDocs(mapped: DemoCatalogue): Array<{ _id: string }> {
	const LOCALES = ['en', 'bn'] as const;
	type Locale = (typeof LOCALES)[number];
	const rows: Array<Record<string, unknown>> = [];
	/** Each language row carries that language's title and description, never another's. */
	const add = (
		path: string,
		text: (locale: Locale) => { title: string; description: string },
		entityType: string,
		entityId: string,
	) => {
		for (const locale of LOCALES) {
			rows.push({
				_id: `seo_${locale}${path.replace(/\//g, '_')}`,
				path,
				locale,
				...text(locale),
				canonicalPath: `/${locale}${path === '/' ? '' : path}`,
				robots: 'index,follow',
				indexable: true,
				entityType,
				entityId,
			});
		}
	};
	const localized = (value: Record<string, string> | undefined, locale: Locale): string =>
		value?.[locale] || value?.['en'] || '';
	add('/', () => ({ title: 'Saha Textile', description: '' }), 'page', 'home');
	for (const product of mapped.products) {
		if (product.status !== 'live') continue;
		add(
			`/product/${product.slug}`,
			(locale) => ({
				title: localized(product.title, locale),
				description: localized(product.description, locale),
			}),
			'product',
			product.id,
		);
	}
	const categoryNames = new Map(mapped.categories.map((row) => [row.id, row.name as Record<string, string>]));
	for (const placement of mapped.placements) {
		if (placement.status !== 'live') continue;
		const path = `/collections/${placement.pathSlugs.join('/')}`;
		add(
			path,
			(locale) => ({
				title:
					locale === 'en'
						? placement.pathLabel
						: placement.pathCategoryIds.map((id) => localized(categoryNames.get(id), locale)).join(' / '),
				description: '',
			}),
			'category',
			placement.id,
		);
	}
	return rows as Array<{ _id: string }>;
}
