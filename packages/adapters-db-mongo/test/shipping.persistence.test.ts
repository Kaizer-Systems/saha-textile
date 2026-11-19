import type { ShippingRuleSet, ShippingRuleSetBody } from '@saha-textile/contracts';
import { PREMADE_RULE_SETS, premadeRuleSetId } from '@saha-textile/core-domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { seedPremadeShippingRuleSets } from '../src/migrations/shipping-premade';
import {
	ProductModel,
	ShippingExceptionModel,
	ShippingProviderConfigModel,
	ShippingRuleSetModel,
	ShippingRuleSetVersionModel,
} from '../src/models/index';
import { MongoShippingRuleRepository } from '../src/repositories/shipping.repository';
import { hasMongoEnv, insertRaw, runPrefix } from './mongo-test-env';

/**
 * Shipping rule sets against the replica set: revisions refuse a stale save, activation writes the
 * version and the rule set together, pre-made rule sets are written once, settings and exceptions.
 *
 *   MONGODB_PORT=27018 MONGODB_DB_NAME=saha_textile_test RUN_DB_IT=1 pnpm --filter @saha-textile/adapters-db-mongo test
 */
describe.runIf(hasMongoEnv())('shipping rule persistence (rs0)', () => {
	const repository = new MongoShippingRuleRepository();
	const prefix = runPrefix('shipping');
	const at = '2026-11-19T10:00:00.000Z';

	const body: ShippingRuleSetBody = {
		steps: [
			{
				id: 'step-1',
				scope: 'eachLine',
				combine: 'sum',
				node: { kind: 'result', id: 'r-1', result: { kind: 'productCharge', charge: 'domestic', per: 'unit' } },
			},
		],
		adjust: [],
	};
	const ruleSet = (id: string, over: Partial<ShippingRuleSet> = {}): ShippingRuleSet => ({
		id: `${prefix}${id}`,
		name: `Rule set ${id}`,
		description: '',
		use: 'domestic',
		kind: 'own',
		premadeKey: null,
		copiedFromId: null,
		activeVersion: null,
		draft: body,
		hasDraftChanges: true,
		testCarts: [],
		revision: 0,
		createdAt: at,
		updatedAt: at,
		updatedBy: 'admin-1',
		...over,
	});

	beforeAll(async () => {
		await connectMongo();
		await Promise.all([
			ShippingRuleSetModel.syncIndexes(),
			ShippingRuleSetVersionModel.syncIndexes(),
			ShippingExceptionModel.syncIndexes(),
			ShippingProviderConfigModel.syncIndexes(),
		]);
	});

	afterAll(async () => {
		await ShippingRuleSetModel.deleteMany({ _id: { $regex: `^${prefix}` } }).exec();
		await ShippingRuleSetVersionModel.deleteMany({ ruleSetId: { $regex: `^${prefix}` } }).exec();
		await ShippingExceptionModel.deleteMany({ _id: { $regex: `^${prefix}` } }).exec();
		await disconnectMongo();
	});

	it('creates once, and refuses a save made against an older revision', async () => {
		expect(await repository.createRuleSet(ruleSet('a'))).toBe(true);
		expect(await repository.createRuleSet(ruleSet('a', { name: 'Other' }))).toBe(false);
		expect(await repository.saveRuleSet(ruleSet('a', { name: 'Renamed', revision: 1 }), 0)).toBe(true);
		expect(await repository.saveRuleSet(ruleSet('a', { name: 'Stale', revision: 1 }), 0)).toBe(false);
		expect(await repository.findRuleSet(`${prefix}a`)).toMatchObject({ name: 'Renamed', revision: 1, draft: body });
		expect(await repository.deleteRuleSet(`${prefix}a`, 0)).toBe(false);
		expect(await repository.deleteRuleSet(`${prefix}a`, 1)).toBe(true);
		expect(await repository.findRuleSet(`${prefix}a`)).toBeNull();
	});

	it('activates: the version and the rule set are written together, and only on the right revision', async () => {
		await repository.createRuleSet(ruleSet('b'));
		const version = {
			ruleSetId: `${prefix}b`,
			version: 1,
			body,
			activatedAt: at,
			activatedBy: 'admin-1',
			acceptedChanges: [],
		};
		expect(
			await repository.activate(
				ruleSet('b', { activeVersion: 1, hasDraftChanges: false, revision: 1 }),
				version,
				7,
			),
		).toBe(false);
		expect(await repository.findVersion(`${prefix}b`, 1)).toBeNull();
		expect(
			await repository.activate(
				ruleSet('b', { activeVersion: 1, hasDraftChanges: false, revision: 1 }),
				version,
				0,
			),
		).toBe(true);
		expect(await repository.findVersion(`${prefix}b`, 1)).toMatchObject({ body, activatedBy: 'admin-1' });
		const second = { ...version, version: 2, acceptedChanges: [{ testCartId: 'c1', fromINR: 200, toINR: 0 }] };
		expect(
			await repository.activate(
				ruleSet('b', { activeVersion: 2, hasDraftChanges: false, revision: 2 }),
				second,
				1,
			),
		).toBe(true);
		expect((await repository.listVersions(`${prefix}b`)).map((v) => v.version)).toEqual([2, 1]);
		expect((await repository.activeVersions([`${prefix}b`, `${prefix}missing`])).map((v) => v.version)).toEqual([
			2,
		]);
	});

	it('refuses to read a stored body that no longer fits the contract', async () => {
		await insertRaw(ShippingRuleSetModel, {
			_id: `${prefix}bad`,
			name: 'Bad',
			use: 'domestic',
			kind: 'own',
			draft: { steps: [{ id: 'step-1', scope: 'everywhere', node: null }] },
			revision: 0,
			createdAt: new Date(at),
			updatedAt: new Date(at),
		});
		await expect(repository.findRuleSet(`${prefix}bad`)).rejects.toThrow();
	});

	it('writes the pre-made rule sets once, each with an active version 1', async () => {
		await seedPremadeShippingRuleSets(new Date(at));
		const again = await seedPremadeShippingRuleSets(new Date(at));
		expect(again).toBe('wrote 0 pre-made shipping rule sets');
		for (const premade of PREMADE_RULE_SETS) {
			const stored = await repository.findRuleSet(premadeRuleSetId(premade.key));
			expect(stored).toMatchObject({
				kind: 'premade',
				premadeKey: premade.key,
				activeVersion: 1,
				hasDraftChanges: false,
			});
			expect((await repository.findVersion(premadeRuleSetId(premade.key), 1))?.body).toEqual(premade.body);
		}
	});

	it('saves settings by revision and keeps exceptions', async () => {
		const existing = await repository.getSettings();
		const revision = existing?.revision ?? 0;
		const settings = {
			homeCountry: 'IN',
			domestic: { kind: 'ruleSet' as const, ruleSetId: `${prefix}b` },
			international: { kind: 'ruleSet' as const, ruleSetId: null },
			mixedRuleSets: 'sum' as const,
			defaultCharges: { domestic: 100, internationalFirst: 2000, internationalFurther: 900 },
			abroadPolicy: 'exportOffIndianInvoice' as const,
			abroadOptions: { askForHomeAddress: true, holdPackingUntilComplete: false },
			revision: revision + 1,
			updatedAt: at,
			updatedBy: 'admin-1',
		};
		expect(await repository.saveSettings(settings, revision)).toBe(true);
		expect(await repository.saveSettings({ ...settings, revision: revision + 2 }, revision)).toBe(false);
		expect(await repository.getSettings()).toMatchObject({
			domestic: { ruleSetId: `${prefix}b` },
			abroadOptions: { askForHomeAddress: true, holdPackingUntilComplete: false },
			revision: revision + 1,
		});
		if (existing) await repository.saveSettings({ ...existing, revision: revision + 2 }, revision + 1);

		await repository.saveException({
			id: `${prefix}e1`,
			target: { kind: 'category', categoryId: 'bridal', includeSubcategories: true },
			domestic: { kind: 'siteWide' },
			international: { kind: 'cantShip' },
			note: 'Too heavy to send abroad',
			updatedAt: at,
			updatedBy: 'admin-1',
		});
		const mine = (await repository.listExceptions()).filter((e) => e.id.startsWith(prefix));
		expect(mine).toEqual([expect.objectContaining({ id: `${prefix}e1`, international: { kind: 'cantShip' } })]);
		expect(await repository.deleteException(`${prefix}e1`)).toBe(true);
		expect(await repository.deleteException(`${prefix}e1`)).toBe(false);
	});

	it('counts live products with no weight or box, and the products that read a category’s charges', async () => {
		const cat = (name: string) => `${prefix}cat-${name}`;
		const product = (id: string, over: Record<string, unknown>) => ({
			_id: `${prefix}${id}`,
			slug: `${prefix}${id}`,
			sku: `${prefix}${id}`,
			status: 'live',
			categoryIds: [cat('sarees')],
			shippingDefaults: null,
			shippingCharges: null,
			...over,
		});
		const docs = [
			product('bare', {}),
			product('weighed', { shippingDefaults: { weightGrams: 600, lengthCm: null, widthCm: null, heightCm: null } }),
			product('boxed', { shippingDefaults: { weightGrams: null, lengthCm: 35, widthCm: 25, heightCm: 5 } }),
			product('half-box', { shippingDefaults: { weightGrams: null, lengthCm: 35, widthCm: null, heightCm: 5 } }),
			product('from-category', { categoryIds: [cat('boxed')] }),
			product('draft', { status: 'draft' }),
			product('own-charge', {
				status: 'draft',
				shippingCharges: { domesticINR: 150, internationalFirstINR: null, internationalFurtherINR: null },
			}),
			product('retired', { status: 'discontinued' }),
		];
		for (const doc of docs) await insertRaw(ProductModel, doc);
		try {
			// Only this run's products: everything else in the test database has another main category.
			const counted = await repository.countProductsWithoutBox([cat('boxed')]);
			const others = await repository.countProductsWithoutBox([cat('boxed'), cat('sarees')]);
			expect(counted - others).toBe(2);
			expect(await repository.chargeUsage([cat('sarees')])).toEqual({ products: 6, ownCharges: 1 });
		} finally {
			await ProductModel.deleteMany({ _id: { $regex: `^${prefix}` } }).exec();
		}
	});
});
