import type { Schema } from 'mongoose';
import { describe, expect, it } from 'vitest';

import * as models from '../src/models/index';
import {
	eraseUpdate,
	heldTextFilter,
	LOCALIZED_TEXT_REGISTRY,
	missingTextFilter,
} from '../src/repositories/localized-text-registry';

/**
 * The schema walker behind Settings › Languages (step 0d). Erase must reach every stored text, and
 * the to-do counts must see every field a form asks for, so the registry is not maintained by
 * memory: every free-form (`Mixed`) field of every model is either listed in the registry or named
 * below as holding no per-language text, and a new one fails this test until someone decides.
 */
interface WalkableModel {
	modelName: string;
	collection: { collectionName: string };
	schema: Schema;
}

const exportedModels = (Object.values(models) as unknown[]).filter(
	(value): value is WalkableModel => typeof value === 'function' && 'modelName' in value && 'schema' in value,
);

/** Free-form fields that hold no per-language text, each with what they hold. */
const NOT_TEXT: Readonly<Record<string, string>> = {
	'AdminUser.adminProfile': 'name, avatar and preferences of an operator',
	'Cart.lines': 'product ids, quantities and prices',
	'CategoryFacetConfig.facets': 'attribute codes and display styles; labels come from the attributes',
	'Category.media': 'photo ids',
	'ConsentEvent.categories': 'cookie choices',
	'ContentBlock.images': 'photo ids per screen size',
	'ContentBlock.link': 'an address',
	'SiteSetting.value': 'typed settings without per-language text',
	'RatingAggregate.buckets': 'counts',
	'Customer.addresses': 'a customer’s own words, never translated',
	'Customer.contacts': 'phone numbers and emails',
	'Customer.savedSizes': 'measurements',
	'Customer.measurementProfiles': 'measurements',
	'Customer.consent': 'consent choices',
	'AuditLog.diffs': 'history, kept as written',
	'AuditLog.metadata': 'history, kept as written',
	'Order.lines': 'what was sold, frozen as written',
	'Order.shipping': 'an address, frozen as written',
	'Order.promotionsApplied': 'frozen as written',
	'Order.statusTimeline': 'history',
	'Mailbox.token': 'an encrypted access token',
	'MediaAsset.derivatives': 'file sizes and keys',
	'MediaAsset.renditions': 'file sizes and keys',
	'MediaAsset.uploadedBy': 'an operator',
	'MediaRole.aspect': 'a ratio',
	'MediaAsset.versions': 'profile keys, fills and dates',
	'MediaAsset.replacing': 'a storage key, sizes, a phase and counts',
	'MediaAsset.keptFiles': 'storage keys, byte counts and dates',
	'MediaAsset.focal': 'two fractions',
	'MediaProfile.shape': 'a ratio',
	'MediaProfile.minSize': 'a size in pixels',
	'MediaProfile.widths': 'sizes in pixels',
	'ProductBundle.groups': 'product ids and quantities',
	'Promotion.conditions': 'amounts and flags',
	'Product.media': 'photo ids; per-photo alt overrides are erased by the coverage repository',
	'Product.variations': 'combinations and prices',
	'Product.ratingsSummary': 'counts',
	'Product.lifecycle': 'dates',
	'Product.videos': 'video ids',
	'Product.replacementTarget': 'a product id',
	'Product.shippingDefaults': 'weights and sizes',
	'ProductVariant.shippingProfile': 'weights and sizes',
	'ProductVariant.taxProfile': 'tax codes',
	'ProductVariant.media': 'photo ids',
	'AnalyticsDailyAggregate.metrics': 'counts',
	'ShopEvent.launch': 'product and category ids',
	'ShopEvent.sale': 'discounts and ids',
	'ShopEvent.launchReport': 'history',
	'ShopEvent.saleRecord': 'history',
	'StoreLocation.geo': 'a map position',
	'AddonTemplate.sizeGuide': 'measurements per size',
};

const registered = (model: WalkableModel): string[] =>
	LOCALIZED_TEXT_REGISTRY.filter((entry) => entry.model.modelName === model.modelName).flatMap((entry) => [
		...entry.fields.map((field) => field.path.split('.')[0] as string),
		...(entry.keyedByLanguage ?? []),
	]);

const freeFormPaths = (schema: Schema): string[] => {
	const found: string[] = [];
	schema.eachPath((path, type) => {
		const element = type as unknown as {
			caster?: { instance?: string };
			embeddedSchemaType?: { instance?: string };
		};
		const instance =
			type.instance === 'Array'
				? (element.caster?.instance ?? element.embeddedSchemaType?.instance)
				: type.instance;
		if (instance === 'Mixed') found.push(path);
	});
	return found;
};

describe('localized text registry', () => {
	it('lists or names every free-form field of every model', () => {
		const undecided: string[] = [];
		for (const model of exportedModels) {
			const listed = registered(model);
			for (const path of freeFormPaths(model.schema)) {
				const key = `${model.modelName}.${path}`;
				if (!listed.includes(path) && !(key in NOT_TEXT)) undecided.push(key);
			}
		}
		expect(undecided).toEqual([]);
	});

	it('names only free-form fields that exist and are not listed', () => {
		const names = new Set(exportedModels.map((model) => model.modelName));
		const freeForm = new Set(
			exportedModels.flatMap((model) => freeFormPaths(model.schema).map((path) => `${model.modelName}.${path}`)),
		);
		expect(freeForm.size).toBeGreaterThan(60);
		for (const key of Object.keys(NOT_TEXT)) {
			expect(freeForm.has(key), key).toBe(true);
			const [model, path] = key.split('.') as [string, string];
			expect(registered(exportedModels.find((row) => row.modelName === model)!), key).not.toContain(path);
		}
		for (const entry of LOCALIZED_TEXT_REGISTRY) {
			expect(names.has(entry.model.modelName)).toBe(true);
			expect(entry.fields.length).toBeGreaterThan(0);
		}
	});

	it('counts every area the to-do list shows that is written in the admin', () => {
		const areas = new Set(LOCALIZED_TEXT_REGISTRY.map((entry) => entry.area));
		for (const area of [
			'products',
			'options',
			'categories',
			'photos',
			'banners',
			'blog_posts',
			'blog_categories',
			'blog_tags',
			'events',
			'stores',
			'faqs',
			'search_words',
			'addon_templates',
		]) {
			expect(areas.has(area as never)).toBe(true);
		}
	});

	it('builds the filters a form’s rules describe', () => {
		const product = LOCALIZED_TEXT_REGISTRY.find((entry) => entry.owner === 'products');
		const missing = JSON.stringify(missingTextFilter(product!, 'hi'));
		expect(missing).toContain('"status":"live"');
		expect(missing).toContain('"optionGroups":{"$elemMatch":{"terms":{"$elemMatch":{"label.hi"');
		expect(missing).toContain('"estimatedDeliveryText.en"');
		expect(JSON.stringify(heldTextFilter(product!, 'hi'))).not.toContain('status');
		expect(eraseUpdate(product!, 'hi')).toMatchObject({
			'title.hi': '',
			'optionGroups.$[].terms.$[].label.hi': '',
		});
	});
});
