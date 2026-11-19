import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type {
	ShippingCartSnapshot,
	ShippingException,
	ShippingRuleSet,
	ShippingRuleSetBody,
	ShippingRuleSetVersion,
	ShippingSettings,
	ShippingSnapshotLine,
	ShippingTryLine,
} from '@saha-textile/contracts';
import { PREMADE_RULE_SETS, premadeRuleSetId, type ShippingRuleRepository } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

/** The shop's own cart pricing is tested elsewhere; here each product's priced row is set by the test. */
const priced = new Map<
	string,
	{ basePriceINR: number; unitPriceINR: number; mrpINR: number | null; soldBy: 'piece' | 'metre' }
>();
vi.mock('@saha-textile/core-domain', async (original) => ({
	...(await original<typeof import('@saha-textile/core-domain')>()),
	priceCartLine: (page: { slug?: string }, _choice: unknown) => {
		void _choice;
		const row = priced.get((page as { id?: string }).id ?? '') ?? null;
		return row
			? {
					ok: true,
					line: {
						sku: 'SKU',
						variationId: null,
						variantLabel: null,
						galleryIndex: null,
						available: null,
						buyable: true,
						shortestCutTenths: null,
						options: [],
						measurements: [],
						...row,
					},
				}
			: { ok: false, reason: 'unknown_variant' };
	},
}));

import { LanguageStore } from '../src/languages/language-store';
import {
	DEFAULT_SHIPPING_SETTINGS,
	ShippingAdminService,
	overviewChecks,
} from '../src/shipping/shipping-admin.service';
import { ShippingSnapshotService } from '../src/shipping/shipping-snapshot.service';

const DOMESTIC: ShippingRuleSetBody = {
	steps: [
		{
			id: 'step-1',
			scope: 'eachLine',
			combine: 'sum',
			node: {
				kind: 'if',
				id: 'if-1',
				when: {
					kind: 'group',
					id: 'g-1',
					join: 'all',
					items: [{ kind: 'condition', id: 'c-1', field: 'line.discounted', op: 'is', value: true }],
				},
				then: { kind: 'result', id: 'r-1', result: { kind: 'productCharge', charge: 'domestic', per: 'unit' } },
				otherwise: { kind: 'result', id: 'r-2', result: { kind: 'free' } },
			},
		},
	],
	adjust: [],
};

/** In-memory twin of the Mongo repository, with the same revision rules. */
function memoryRepository(
	premadeKeys: readonly string[] = ['highest-only'],
): ShippingRuleRepository & { versions: Map<string, ShippingRuleSetVersion> } {
	const sets = new Map<string, ShippingRuleSet>();
	const versions = new Map<string, ShippingRuleSetVersion>();
	const exceptions = new Map<string, ShippingException>();
	let settings: ShippingSettings | null = null;
	for (const premade of PREMADE_RULE_SETS.filter((p) => premadeKeys.includes(p.key))) {
		const id = premadeRuleSetId(premade.key);
		sets.set(id, {
			id,
			name: premade.name,
			description: premade.description,
			use: premade.use,
			kind: 'premade',
			premadeKey: premade.key,
			copiedFromId: null,
			activeVersion: 1,
			draft: premade.body,
			hasDraftChanges: false,
			testCarts: [],
			revision: 1,
			updatedBy: null,
		});
		versions.set(`${id}:1`, {
			ruleSetId: id,
			version: 1,
			body: premade.body,
			activatedAt: '2026-11-19T00:00:00.000Z',
			activatedBy: null,
			acceptedChanges: [],
		});
	}
	return {
		versions,
		listRuleSets: async () => [...sets.values()],
		findRuleSet: async (id) => sets.get(id) ?? null,
		createRuleSet: async (r) => (sets.has(r.id) ? false : (sets.set(r.id, r), true)),
		saveRuleSet: async (r, expected) => (sets.get(r.id)?.revision === expected ? (sets.set(r.id, r), true) : false),
		deleteRuleSet: async (id, expected) => (sets.get(id)?.revision === expected ? sets.delete(id) : false),
		activate: async (r, v, expected) => {
			if (sets.get(r.id)?.revision !== expected) return false;
			sets.set(r.id, r);
			versions.set(`${v.ruleSetId}:${v.version}`, v);
			return true;
		},
		findVersion: async (id, version) => versions.get(`${id}:${version}`) ?? null,
		listVersions: async (id) =>
			[...versions.values()].filter((v) => v.ruleSetId === id).sort((a, b) => b.version - a.version),
		activeVersions: async (ids) =>
			[...versions.values()].filter(
				(v) => ids.includes(v.ruleSetId) && sets.get(v.ruleSetId)?.activeVersion === v.version,
			),
		createPremadeIfMissing: async () => false,
		getSettings: async () => settings,
		saveSettings: async (s, expected) => ((settings?.revision ?? 0) === expected ? ((settings = s), true) : false),
		listExceptions: async () => [...exceptions.values()],
		saveException: async (e) => void exceptions.set(e.id, e),
		deleteException: async (id) => exceptions.delete(id),
		countProductsWithoutBox: vi.fn(async (_withBox: readonly string[]) => 14),
		chargeUsage: vi.fn(async (_ids: readonly string[]) => ({ products: 214, ownCharges: 5 })),
	};
}

const line = (id: string, over: Partial<ShippingSnapshotLine> = {}): ShippingSnapshotLine => ({
	lineId: id,
	productId: `p-${id}`,
	categoryIds: ['sarees'],
	mainCategoryId: 'sarees',
	mainCategoryAncestorIds: [],
	freeShipping: false,
	units: 1,
	sellingPriceINR: 2450,
	mrpINR: 2450,
	onSaleEvent: false,
	soldBy: 'piece',
	madeToOrder: false,
	chargeableWeightGrams: 600,
	charges: { domestic: 100, internationalFirst: 2000, internationalFurther: 900 },
	...over,
});

/** Products by id: `disc-*` are sold below MRP, anything else at MRP. */
const snapshots = {
	build: vi.fn(
		async (
			lines: readonly ShippingTryLine[],
			delivery: ShippingCartSnapshot['delivery'],
			shopper: ShippingCartSnapshot['shopper'],
		) => {
			const built = lines.map((l, i) =>
				line(`line-${i + 1}`, {
					productId: l.productId,
					units: l.quantity,
					...(l.productId.startsWith('disc') ? { sellingPriceINR: 900, mrpINR: 1000 } : {}),
				}),
			);
			return {
				snapshot: { lines: built, delivery, shopper },
				views: built.map((b) => ({
					lineId: b.lineId,
					productId: b.productId,
					title: b.productId,
					units: b.units,
					sellingPriceINR: b.sellingPriceINR,
					mrpINR: b.mrpINR,
					discounted: b.sellingPriceINR < (b.mrpINR ?? 0),
					charges: b.charges,
					chargeableWeightGrams: b.chargeableWeightGrams,
				})),
			};
		},
	),
};

const harness = (premadeKeys?: readonly string[]) => {
	const repo = memoryRepository(premadeKeys);
	const audit = { append: vi.fn(async (_entry: { action: string }) => undefined) };
	const categories = {
		findById: async (id: string) => (id === 'bridal' ? { id } : null),
		tree: async () => [
			{
				id: 'sarees',
				ancestors: [],
				shipping: { weightGrams: 650, lengthCm: null, widthCm: null, heightCm: null },
			},
			{ id: 'silk', ancestors: ['sarees'], shipping: null },
			{ id: 'bridal', ancestors: [], shipping: null },
		],
	};
	const products = { findById: async (id: string) => (id.startsWith('p-') ? { id } : null) };
	const service = new ShippingAdminService(
		repo,
		categories as never,
		products as never,
		snapshots as never,
		LanguageStore.fixed(['en', 'bn']),
		audit as never,
		{ findById: async (id: string) => (id === 'admin-1' ? { displayName: 'Moulik Patra' } : null) } as never,
	);
	return { service, repo, audit };
};

const IN = { country: 'IN', state: 'West Bengal', pincode: '700045' };
const settingsWrite = (over: Partial<ShippingSettings> = {}) => ({
	...DEFAULT_SHIPPING_SETTINGS,
	revision: 0,
	...over,
});

describe('rule sets', () => {
	it('creates blank, saves the working copy by revision, and refuses a stale save with who changed it', async () => {
		const { service, audit } = harness();
		const created = await service.create(
			{ name: 'Saha Textile — Domestic', description: '', use: 'domestic', copyFromId: null },
			'admin-1',
		);
		const id = created.ruleSet.id;
		expect(created.ruleSet).toMatchObject({ kind: 'own', activeVersion: null, revision: 0, draft: { steps: [] } });
		expect(created.canActivate).toBe(false);
		const saved = await service.save(
			id,
			{
				name: 'Saha Textile — Domestic',
				description: '',
				use: 'domestic',
				draft: DOMESTIC,
				testCarts: [],
				revision: 0,
			},
			'admin-1',
		);
		expect(saved.ruleSet).toMatchObject({ revision: 1, hasDraftChanges: true });
		expect(saved.canActivate).toBe(true);
		const stale = service.save(
			id,
			{ name: 'Other', description: '', use: 'domestic', draft: DOMESTIC, testCarts: [], revision: 0 },
			'admin-2',
		);
		await expect(stale).rejects.toBeInstanceOf(ConflictException);
		await stale.catch((error: ConflictException) =>
			expect(error.getResponse()).toMatchObject({ issues: [{ path: 'revision', code: 'stale_revision' }] }),
		);
		expect(audit.append).toHaveBeenCalledWith(
			expect.objectContaining({ action: 'shipping_rule_set.save', entityType: 'shipping' }),
		);
	});

	it('keeps pre-made rule sets locked, and copies them into an own rule set', async () => {
		const { service } = harness();
		const premadeId = premadeRuleSetId('highest-only');
		await expect(
			service.save(
				premadeId,
				{ name: 'x', description: '', use: 'both', draft: DOMESTIC, testCarts: [], revision: 1 },
				null,
			),
		).rejects.toBeInstanceOf(ForbiddenException);
		await expect(service.activate(premadeId, { revision: 1, acceptChanges: [] }, null)).rejects.toBeInstanceOf(
			ForbiddenException,
		);
		await expect(service.remove(premadeId, 1, null)).rejects.toBeInstanceOf(ForbiddenException);
		const copy = await service.create(
			{ name: 'Highest charge only (copy)', description: '', use: 'both', copyFromId: premadeId },
			'admin-1',
		);
		expect(copy.ruleSet).toMatchObject({ kind: 'own', copiedFromId: premadeId, activeVersion: null });
		expect(copy.ruleSet.draft).toEqual(PREMADE_RULE_SETS[1]?.body);
	});

	it('activates only a valid rule set, after its test carts are accepted by name', async () => {
		const { service, repo } = harness();
		const { ruleSet } = await service.create(
			{ name: 'Domestic', description: '', use: 'domestic', copyFromId: null },
			null,
		);
		expect(await service.activate(ruleSet.id, { revision: 0, acceptChanges: [] }, null)).toMatchObject({
			outcome: 'invalid',
		});

		const testCarts = [
			{
				id: 'cart-1',
				name: 'Two discounted, one full price',
				lines: [
					{ productId: 'disc-1', variationId: null, quantity: 2 },
					{ productId: 'p-2', variationId: null, quantity: 1 },
				],
				delivery: IN,
				shopper: { signedIn: true, groups: [], firstOrder: false },
				expectedINR: null,
			},
		];
		await service.save(
			ruleSet.id,
			{ name: 'Domestic', description: '', use: 'domestic', draft: DOMESTIC, testCarts, revision: 0 },
			null,
		);
		const first = await service.activate(ruleSet.id, { revision: 1, acceptChanges: [] }, null);
		expect(first).toEqual({
			outcome: 'testCartsChanged',
			changes: [
				{
					testCartId: 'cart-1',
					name: 'Two discounted, one full price',
					fromINR: null,
					toINR: 200,
					status: 'priced',
				},
			],
		});
		const wrongAmount = await service.activate(
			ruleSet.id,
			{ revision: 1, acceptChanges: [{ testCartId: 'cart-1', toINR: 150 }] },
			null,
		);
		expect(wrongAmount.outcome).toBe('testCartsChanged');

		const done = await service.activate(
			ruleSet.id,
			{ revision: 1, acceptChanges: [{ testCartId: 'cart-1', toINR: 200 }] },
			'admin-1',
		);
		expect(done).toMatchObject({ outcome: 'activated', version: 1 });
		if (done.outcome !== 'activated') return;
		expect(done.detail.ruleSet).toMatchObject({
			activeVersion: 1,
			hasDraftChanges: false,
			revision: 2,
			testCarts: [{ expectedINR: 200 }],
		});
		expect(repo.versions.get(`${ruleSet.id}:1`)).toMatchObject({
			activatedBy: 'admin-1',
			acceptedChanges: [{ testCartId: 'cart-1', fromINR: null, toINR: 200 }],
		});

		// Saving the same blocks again is not a change; different blocks are.
		const again = await service.save(
			ruleSet.id,
			{
				name: 'Domestic',
				description: '',
				use: 'domestic',
				draft: DOMESTIC,
				testCarts: done.detail.ruleSet.testCarts,
				revision: 2,
			},
			null,
		);
		expect(again.ruleSet.hasDraftChanges).toBe(false);
		const changed = await service.save(
			ruleSet.id,
			{
				name: 'Domestic',
				description: '',
				use: 'domestic',
				draft: { ...DOMESTIC, adjust: [{ kind: 'minimum', id: 'min', amount: 50 }] },
				testCarts: again.ruleSet.testCarts,
				revision: 3,
			},
			null,
		);
		expect(changed.ruleSet.hasDraftChanges).toBe(true);
	});

	it('refuses to delete a rule set while a zone uses it', async () => {
		const { service } = harness();
		const { ruleSet } = await service.create(
			{ name: 'Domestic', description: '', use: 'domestic', copyFromId: null },
			null,
		);
		await service.save(
			ruleSet.id,
			{ name: 'Domestic', description: '', use: 'domestic', draft: DOMESTIC, testCarts: [], revision: 0 },
			null,
		);
		await service.activate(ruleSet.id, { revision: 1, acceptChanges: [] }, null);
		await service.saveSettings(settingsWrite({ domestic: { kind: 'ruleSet', ruleSetId: ruleSet.id } }), null);
		await expect(service.remove(ruleSet.id, 2, null)).rejects.toBeInstanceOf(ConflictException);
		expect((await service.list()).find((row) => row.ruleSet.id === ruleSet.id)?.usage).toEqual({
			zones: [{ zone: 'domestic', as: 'siteWide' }],
			exceptionIds: [],
		});
	});

	it('Try it prices blocks on the products given, without saving, and lists 20 lines of a bigger cart', async () => {
		const { service } = harness();
		const result = await service.tryRuleSet({
			body: DOMESTIC,
			lines: [
				{ productId: 'disc-1', variationId: null, quantity: 2 },
				{ productId: 'p-2', variationId: null, quantity: 1 },
			],
			delivery: IN,
			shopper: { signedIn: true, groups: [], firstOrder: false },
		});
		expect(result).toMatchObject({ status: 'priced', zone: 'domestic', amountINR: 200, moreLines: 0 });
		const big = await service.tryRuleSet({
			body: DOMESTIC,
			lines: Array.from({ length: 25 }, (_, i) => ({ productId: `p-${i}`, variationId: null, quantity: 1 })),
			delivery: { country: 'GB', state: null, pincode: null },
			shopper: { signedIn: false, groups: [], firstOrder: true },
		});
		expect(big).toMatchObject({ zone: 'international', moreLines: 5 });
		expect(big.lines).toHaveLength(20);
	});
});

describe('zone settings', () => {
	it('names the revision, refuses a courier, an unbuilt path, an inactive or wrong-zone rule set', async () => {
		const { service } = harness();
		const premadeId = premadeRuleSetId('highest-only');
		await expect(service.saveSettings(settingsWrite({ revision: 4 }), null)).rejects.toBeInstanceOf(
			ConflictException,
		);
		await expect(
			service.saveSettings(settingsWrite({ abroadPolicy: 'standardExport' }), null),
		).rejects.toBeInstanceOf(BadRequestException);
		await expect(
			service.saveSettings(
				settingsWrite({
					international: {
						kind: 'courier',
						courierId: 'shiprocket',
						fallbackRuleSetId: premadeId,
						extra: { amountINR: 0, percent: 0 },
					},
				}),
				null,
			),
		).rejects.toBeInstanceOf(BadRequestException);
		const { ruleSet } = await service.create(
			{ name: 'Intl', description: '', use: 'international', copyFromId: null },
			null,
		);
		await expect(
			service.saveSettings(settingsWrite({ international: { kind: 'ruleSet', ruleSetId: ruleSet.id } }), null),
		).rejects.toBeInstanceOf(BadRequestException);

		const overview = await service.saveSettings(
			settingsWrite({
				domestic: { kind: 'ruleSet', ruleSetId: premadeId },
				abroadPolicy: 'exportOffIndianInvoice',
			}),
			'admin-1',
		);
		expect(overview.settings).toMatchObject({
			revision: 1,
			updatedBy: 'admin-1',
			abroadPolicy: 'exportOffIndianInvoice',
		});
		expect(overview.checks.map((c) => c.code)).toEqual(['zone_not_set', 'default_charges_zero']);
		expect(overview.abroadPolicies).toEqual(['exportOffIndianInvoice', 'indiaOnly']);
	});

	it('the overview does not ask for an international rule set when the shop only delivers in India', () => {
		const checks = overviewChecks(
			settingsWrite({
				abroadPolicy: 'indiaOnly',
				defaultCharges: { domestic: 100, internationalFirst: 0, internationalFurther: 0 },
			}),
			[],
			[],
		);
		expect(checks).toEqual([{ code: 'zone_not_set', severity: 'error', params: { zone: 'domestic' } }]);
	});
});

describe('exceptions', () => {
	it('checks the category or product and the rule set, then adds, changes and removes', async () => {
		const { service, audit } = harness();
		const write = {
			target: { kind: 'category' as const, categoryId: 'bridal', includeSubcategories: true },
			domestic: { kind: 'siteWide' as const },
			international: { kind: 'cantShip' as const },
			note: '',
		};
		await expect(
			service.saveException(
				null,
				{ ...write, target: { kind: 'category', categoryId: 'nope', includeSubcategories: true } },
				null,
			),
		).rejects.toBeInstanceOf(BadRequestException);
		const { ruleSet } = await service.create(
			{ name: 'Draft', description: '', use: 'both', copyFromId: null },
			null,
		);
		await expect(
			service.saveException(null, { ...write, domestic: { kind: 'ruleSet', ruleSetId: ruleSet.id } }, null),
		).rejects.toBeInstanceOf(BadRequestException);
		const saved = await service.saveException(null, write, 'admin-1');
		expect(saved).toMatchObject({ international: { kind: 'cantShip' }, updatedBy: 'admin-1' });
		await service.saveException(saved.id, { ...write, note: 'Too heavy abroad' }, 'admin-1');
		expect((await service.listExceptions())[0]?.note).toBe('Too heavy abroad');
		await service.removeException(saved.id, 'admin-1');
		expect(await service.listExceptions()).toEqual([]);
		expect(audit.append.mock.calls.map(([entry]) => entry.action)).toEqual(
			expect.arrayContaining([
				'shipping_exception.create',
				'shipping_exception.update',
				'shipping_exception.delete',
			]),
		);
	});
});

describe('the snapshot built from real products', () => {
	it('reads charges through the main category chain, compares the pre-add-on price with MRP, and counts a cut as one unit', async () => {
		const catalog = {
			cartRead: async (id: string) => ({
				slug: id,
				title: `Title ${id}`,
				page: {
					id,
					saleEndsAt: id === 'p-sale' ? '2026-11-30T00:00:00.000Z' : null,
					madeToOrder: id === 'p-own',
					variants: [],
					gallery: [],
				},
			}),
		};
		const products = {
			findById: async (id: string) => ({
				id,
				categoryIds: ['tant', 'gifts'],
				shippingDefaults: { weightGrams: 650, lengthCm: null, widthCm: null, heightCm: null },
				shippingCharges:
					id === 'p-own'
						? { domesticINR: 150, internationalFirstINR: null, internationalFurtherINR: null }
						: undefined,
				freeShipping: id === 'p-own',
				weightPerMetreGrams: id === 'p-metre' ? 200 : null,
			}),
		};
		const shipping = (over: Record<string, number | null>) => ({
			domesticINR: null,
			internationalFirstINR: null,
			internationalFurtherINR: null,
			weightGrams: null,
			lengthCm: null,
			widthCm: null,
			heightCm: null,
			...over,
		});
		const categories = {
			findById: async (id: string) =>
				({
					tant: {
						id: 'tant',
						name: { en: 'Tant' },
						ancestors: ['root', 'sarees'],
						shipping: shipping({ internationalFurtherINR: 800, lengthCm: 30, widthCm: 25, heightCm: 4 }),
					},
					sarees: {
						id: 'sarees',
						name: { en: 'Sarees' },
						ancestors: ['root'],
						shipping: shipping({
							domesticINR: 100,
							internationalFirstINR: 2000,
							internationalFurtherINR: 900,
						}),
					},
					root: { id: 'root', name: { en: 'Root' }, ancestors: [], shipping: null },
				})[id] ?? null,
		};
		priced.set('p-sale', { basePriceINR: 900, unitPriceINR: 1400, mrpINR: 1000, soldBy: 'piece' });
		priced.set('p-own', { basePriceINR: 2450, unitPriceINR: 2450, mrpINR: 2450, soldBy: 'piece' });
		priced.set('p-metre', { basePriceINR: 500, unitPriceINR: 500, mrpINR: 600, soldBy: 'metre' });
		const service = new ShippingSnapshotService(
			catalog as never,
			products as never,
			{ findById: async () => null } as never,
			categories as never,
		);
		const { snapshot, views } = await service.build(
			[
				{ productId: 'p-sale', variationId: null, quantity: 2 },
				{ productId: 'p-own', variationId: null, quantity: 1 },
				{ productId: 'p-metre', variationId: null, quantity: 25 },
			],
			{ country: 'IN', state: 'West Bengal', pincode: '700045' },
			{ signedIn: true, groups: [], firstOrder: false },
			{ domestic: 50, internationalFirst: 1500, internationalFurther: 700 },
		);
		const [sale, own, metre] = snapshot.lines;
		expect(sale).toMatchObject({
			mainCategoryId: 'tant',
			mainCategoryAncestorIds: ['sarees', 'root'],
			units: 2,
			sellingPriceINR: 1400,
			basePriceINR: 900,
			onSaleEvent: true,
			charges: { domestic: 100, internationalFirst: 2000, internationalFurther: 800 },
			// 650 g actual against 30 × 25 × 4 cm = 600 g volumetric.
			chargeableWeightGrams: 650,
		});
		expect(views[0]).toMatchObject({ title: 'Title p-sale', discounted: true });
		// Where each charge came from, for "charge ₹100 (Sarees)" in Try it.
		expect(views[0]?.chargeSources).toEqual({
			domestic: { from: 'category', name: 'Sarees' },
			internationalFirst: { from: 'category', name: 'Sarees' },
			internationalFurther: { from: 'category', name: 'Tant' },
		});
		expect(own).toMatchObject({ freeShipping: true, madeToOrder: true, charges: { domestic: 150 } });
		expect(views[1]?.discounted).toBe(false);
		expect(metre).toMatchObject({ units: 1, soldBy: 'metre', sellingPriceINR: 1250, chargeableWeightGrams: 500 });
	});
});

describe('overview counts, category usage and the cart tester (brief ov01, rl01, cat01)', () => {
	it('names who saved a rule set last', async () => {
		const { service } = harness();
		const { ruleSet } = await service.create(
			{ name: 'Domestic', description: '', use: 'domestic', copyFromId: null },
			'admin-1',
		);
		const row = (await service.list()).find((r) => r.ruleSet.id === ruleSet.id);
		expect(row?.updatedByName).toBe('Moulik Patra');
	});

	it('counts exceptions by kind, products without weight, and whether weight is in use', async () => {
		const { service, repo } = harness(['highest-only', 'weight-bands']);
		const premadeId = premadeRuleSetId('highest-only');
		const weightId = premadeRuleSetId('weight-bands');
		await service.saveSettings(settingsWrite({ domestic: { kind: 'ruleSet', ruleSetId: premadeId } }), null);
		await service.saveException(
			null,
			{
				target: { kind: 'category', categoryId: 'bridal', includeSubcategories: true },
				domestic: { kind: 'free' },
				international: { kind: 'siteWide' },
				note: '',
			},
			null,
		);
		let overview = await service.overview();
		expect(overview.exceptionTargets).toEqual({ categories: 1, products: 0 });
		expect(overview.productsWithoutBox).toBe(14);
		// Sarees gives a weight, and Silk inherits it; Bridal gives none.
		expect(repo.countProductsWithoutBox).toHaveBeenLastCalledWith(['sarees', 'silk']);
		expect(overview.weightInUse).toBe(false);

		await service.saveSettings(
			settingsWrite({ revision: 1, domestic: { kind: 'ruleSet', ruleSetId: weightId } }),
			null,
		);
		overview = await service.overview();
		expect(overview.weightInUse).toBe(true);
	});

	it('counts the products that read a category’s charges, the category and those beneath it', async () => {
		const { service, repo } = harness();
		expect(await service.categoryUsage('sarees')).toEqual({ products: 214, ownCharges: 5 });
		expect(repo.chargeUsage).toHaveBeenLastCalledWith(['sarees', 'silk']);
		await expect(service.categoryUsage('nope')).rejects.toBeInstanceOf(NotFoundException);
	});

	it('prices a cart with the live settings, and refuses delivery abroad on "India only"', async () => {
		const { service } = harness(['flat-per-order']);
		const premadeId = premadeRuleSetId('flat-per-order');
		await service.saveSettings(
			settingsWrite({
				domestic: { kind: 'ruleSet', ruleSetId: premadeId },
				defaultCharges: { domestic: 100, internationalFirst: 2000, internationalFurther: 900 },
			}),
			null,
		);
		const cart = { lines: [{ productId: 'p-1', variationId: null, quantity: 2 }], delivery: IN };
		const priced = await service.tryCart({ ...cart, shopper: { signedIn: true, groups: [], firstOrder: false } });
		expect(priced).toMatchObject({
			status: 'priced',
			zone: 'domestic',
			lines: [{ route: 'ruleSet', via: 'siteWide', ruleSetId: premadeId, ruleSetName: 'Flat per order' }],
			groups: [{ kind: 'ruleSet', ruleSetName: 'Flat per order' }],
		});
		expect(priced.amountINR).not.toBeNull();

		const abroad = await service.tryCart({
			...cart,
			delivery: { country: 'GB', state: null, pincode: null },
			shopper: { signedIn: true, groups: [], firstOrder: false },
		});
		// India only: the shop doesn't send abroad.
		expect(abroad).toMatchObject({ status: 'cantShip', zone: 'international', lines: [{ via: 'indiaOnly' }] });
	});
});
