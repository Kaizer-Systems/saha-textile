import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
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

import { LanguageStore } from '../src/languages/language-store';
import {
	DEFAULT_SHIPPING_SETTINGS,
	ShippingAdminService,
	byListOrder,
	categoriesWithBox,
	overviewChecks,
	ruleSetIdsInUse,
	usageOf,
} from '../src/shipping/shipping-admin.service';

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
/** A step with nothing in it: every line falls through without a result. */
const NO_RESULT: ShippingRuleSetBody = {
	steps: [{ id: 'step-1', scope: 'eachLine', combine: 'sum', node: null }],
	adjust: [],
};
const CANT_SHIP: ShippingRuleSetBody = {
	steps: [
		{
			id: 'step-1',
			scope: 'eachLine',
			combine: 'sum',
			node: { kind: 'result', id: 'r-1', result: { kind: 'cantShip', message: { en: 'Not by post' } } },
		},
	],
	adjust: [],
};

const snapshotLine = (id: string, over: Partial<ShippingSnapshotLine> = {}): ShippingSnapshotLine => ({
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

/** Products by id: `disc-*` sell below MRP, `free-*` ship free, anything else at MRP. */
const snapshots = {
	build: async (
		lines: readonly ShippingTryLine[],
		delivery: ShippingCartSnapshot['delivery'],
		shopper: ShippingCartSnapshot['shopper'],
	) => {
		const built = lines.map((l, i) =>
			snapshotLine(`line-${i + 1}`, {
				productId: l.productId,
				units: l.quantity,
				freeShipping: l.productId.startsWith('free'),
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
};

const harness = (options: { audit?: boolean } = {}) => {
	const repo = memoryRepository();
	const audit = { append: vi.fn(async (_entry: { action: string }) => undefined) };
	const categories = {
		findById: async (id: string) => (id === 'bridal' ? { id } : null),
		tree: async () => [{ id: 'sarees', ancestors: [], shipping: null }],
	};
	const products = { findById: async (id: string) => (id.startsWith('p-') ? { id } : null) };
	const service = new ShippingAdminService(
		repo,
		categories as never,
		products as never,
		snapshots as never,
		LanguageStore.fixed(['en', 'bn']),
		(options.audit === false ? null : audit) as never,
		{ findById: async (id: string) => (id === 'admin-1' ? { displayName: 'Moulik Patra' } : null) } as never,
	);
	return { service, repo, audit };
};

const IN = { country: 'IN', state: 'West Bengal', pincode: '700045' };
const SHOPPER = { signedIn: true, groups: [], firstOrder: false };
const PREMADE_ID = premadeRuleSetId('highest-only');

const ruleSet = (over: Partial<ShippingRuleSet> = {}): ShippingRuleSet => ({
	id: 'rs_1',
	name: 'Domestic',
	description: '',
	use: 'both',
	kind: 'own',
	premadeKey: null,
	copiedFromId: null,
	activeVersion: 1,
	draft: { steps: [], adjust: [] },
	hasDraftChanges: false,
	testCarts: [],
	revision: 0,
	updatedBy: null,
	...over,
});
const exception = (id: string, domestic: unknown, international: unknown = { kind: 'siteWide' }) =>
	({
		id,
		target: { kind: 'category', categoryId: 'sarees', includeSubcategories: true },
		domestic,
		international,
	}) as ShippingException;
const courier = (fallbackRuleSetId: string | null) => ({
	kind: 'courier' as const,
	courierId: 'shiprocket',
	fallbackRuleSetId,
	extra: { amountINR: 0, percent: 0 },
});
const settings = (over: Partial<ShippingSettings> = {}): ShippingSettings => ({
	...DEFAULT_SHIPPING_SETTINGS,
	abroadPolicy: 'exportOffIndianInvoice',
	...over,
});
/** Puts an own rule set with an active version straight into the store. */
const activeRuleSet = async (
	repo: ReturnType<typeof memoryRepository>,
	id: string,
	body: ShippingRuleSetBody,
	over: Partial<ShippingRuleSet> = {},
) => {
	await repo.createRuleSet(ruleSet({ id, draft: body, ...over }));
	repo.versions.set(`${id}:1`, {
		ruleSetId: id,
		version: 1,
		body,
		activatedAt: '2026-11-19T00:00:00.000Z',
		activatedBy: null,
		acceptedChanges: [],
	} as ShippingRuleSetVersion);
};

describe('the list order, usage and checks', () => {
	it('puts the shop’s own rule sets first by name, then the pre-made ones as designed', () => {
		const own = ruleSet({ name: 'B' });
		const premade = (premadeKey: string | null) => ruleSet({ kind: 'premade', premadeKey });
		const [first, second] = PREMADE_RULE_SETS;
		expect(byListOrder(own, premade(null))).toBe(-1);
		expect(byListOrder(premade(null), own)).toBe(1);
		expect(byListOrder(premade(first?.key ?? ''), premade(second?.key ?? ''))).toBeLessThan(0);
		expect(byListOrder(premade(null), premade('not-designed'))).toBe(0);
		expect(byListOrder(own, ruleSet({ name: 'A' }))).toBeGreaterThan(0);
	});

	it('finds where a rule set is used: zones, a courier’s fallback and exceptions on either side', () => {
		const zones = settings({ domestic: courier('rs_x'), international: { kind: 'ruleSet', ruleSetId: 'rs_x' } });
		const exceptions = [
			exception('e1', { kind: 'ruleSet', ruleSetId: 'rs_x' }),
			exception('e2', { kind: 'free' }, { kind: 'ruleSet', ruleSetId: 'rs_x' }),
			exception('e3', { kind: 'ruleSet', ruleSetId: 'rs_other' }, { kind: 'cantShip' }),
		];
		expect(usageOf('rs_x', zones, exceptions)).toEqual({
			zones: [
				{ zone: 'domestic', as: 'fallback' },
				{ zone: 'international', as: 'siteWide' },
			],
			exceptionIds: ['e1', 'e2'],
		});
		expect(usageOf('rs_other', zones, [])).toEqual({ zones: [], exceptionIds: [] });
	});

	it('warns of a courier, a missing or inactive rule set, zero default charges and exceptions pointing nowhere', () => {
		const sets = [ruleSet({ id: 'rs_draft', name: 'Draft', activeVersion: null }), ruleSet({ id: 'rs_live' })];
		const exceptions = [
			exception('e_free', { kind: 'free' }),
			exception('e_missing', { kind: 'ruleSet', ruleSetId: 'rs_missing' }),
			exception('e_draft', { kind: 'ruleSet', ruleSetId: 'rs_draft' }),
			exception('e_live', { kind: 'ruleSet', ruleSetId: 'rs_live' }),
		];
		const first = overviewChecks(
			settings({ domestic: courier(null), international: { kind: 'ruleSet', ruleSetId: 'rs_missing' } }),
			sets,
			exceptions,
		);
		expect(first.map((check) => [check.code, check.params])).toEqual([
			['courier_not_connected', { zone: 'domestic' }],
			['rule_set_missing', { zone: 'international' }],
			['default_charges_zero', {}],
			['exception_rule_set_missing', { exceptionId: 'e_missing' }],
			['exception_rule_set_missing', { exceptionId: 'e_draft' }],
		]);
		const second = overviewChecks(
			settings({
				domestic: { kind: 'ruleSet', ruleSetId: null },
				international: courier('rs_draft'),
				defaultCharges: { domestic: 80, internationalFirst: 0, internationalFurther: 0 },
			}),
			sets,
			[],
		);
		expect(second.map((check) => [check.code, check.params])).toEqual([
			['zone_not_set', { zone: 'domestic' }],
			['courier_not_connected', { zone: 'international' }],
			['rule_set_not_active', { zone: 'international', name: 'Draft' }],
		]);
	});

	it('lists the rule sets in use: a courier’s fallback and exception choices, never an empty zone', () => {
		const zones = settings({ domestic: courier('rs_a'), international: { kind: 'ruleSet', ruleSetId: null } });
		const exceptions = [exception('e1', { kind: 'ruleSet', ruleSetId: 'rs_b' }, { kind: 'free' })];
		expect(ruleSetIdsInUse(zones, exceptions)).toEqual(['rs_a', 'rs_b']);
	});

	it('counts a category with a weight or a full box, or under one, and not a half-measured one', () => {
		const box = (over: Record<string, number | null>) => ({
			weightGrams: null,
			lengthCm: null,
			widthCm: null,
			heightCm: null,
			...over,
		});
		const categories = [
			{ id: 'full', ancestors: [], shipping: box({ lengthCm: 10, widthCm: 10, heightCm: 5 }) },
			{ id: 'flat', ancestors: [], shipping: box({ lengthCm: 10, widthCm: 10 }) },
			{ id: 'strip', ancestors: [], shipping: box({ lengthCm: 10 }) },
			{ id: 'child', ancestors: ['full'], shipping: null },
			{ id: 'lone', ancestors: ['ghost'], shipping: null },
		];
		expect(categoriesWithBox(categories as never)).toEqual(['full', 'child']);
	});
});

describe('rule sets: the remaining cases', () => {
	it('names nobody for a save by someone unknown, and refuses an unknown rule set', async () => {
		const { service, repo } = harness();
		await repo.createRuleSet(ruleSet({ id: 'rs_x', updatedBy: 'admin-gone' }));
		expect((await service.list()).find((row) => row.ruleSet.id === 'rs_x')?.updatedByName).toBeNull();
		await expect(service.detail('rs_none')).rejects.toBeInstanceOf(NotFoundException);
	});

	it('refuses a save that lost the race, and names who won when it can', async () => {
		const { service, repo } = harness();
		await repo.createRuleSet(ruleSet({ id: 'rs_x', updatedBy: 'admin-gone' }));
		repo.saveRuleSet = async () => false;
		const body = {
			name: 'Domestic',
			description: '',
			use: 'domestic' as const,
			draft: DOMESTIC,
			testCarts: [],
			revision: 0,
		};
		const lost = service.save('rs_x', body, 'admin-1');
		await expect(lost).rejects.toBeInstanceOf(ConflictException);
		await lost.catch((error: ConflictException) =>
			expect(error.getResponse()).toMatchObject({ issues: [expect.objectContaining({})] }),
		);
		await repo.createRuleSet(ruleSet({ id: 'rs_y' }));
		await expect(service.save('rs_y', body, null)).rejects.toBeInstanceOf(ConflictException);
	});

	it('activates straight away when every test cart still prices the same', async () => {
		const { service, repo } = harness();
		const testCarts = [
			{
				id: 'cart-1',
				name: 'Two discounted',
				lines: [{ productId: 'disc-1', variationId: null, quantity: 2 }],
				delivery: IN,
				shopper: SHOPPER,
				expectedINR: 200,
			},
		];
		await repo.createRuleSet(
			ruleSet({
				id: 'rs_x',
				use: 'domestic',
				activeVersion: null,
				draft: DOMESTIC,
				testCarts,
				revision: 1,
				updatedAt: '2026-11-19T00:00:00.000Z',
			}),
		);
		await expect(service.activate('rs_x', { revision: 0, acceptChanges: [] }, null)).rejects.toBeInstanceOf(
			ConflictException,
		);
		const done = await service.activate('rs_x', { revision: 1, acceptChanges: [] }, 'admin-1');
		expect(done).toMatchObject({ outcome: 'activated', version: 1 });
		expect(repo.versions.get('rs_x:1')).toMatchObject({ acceptedChanges: [] });
	});

	it('refuses an activation that lost the race', async () => {
		const { service, repo } = harness();
		await repo.createRuleSet(
			ruleSet({ id: 'rs_x', use: 'domestic', activeVersion: null, draft: DOMESTIC, revision: 1 }),
		);
		repo.activate = async () => false;
		await expect(service.activate('rs_x', { revision: 1, acceptChanges: [] }, null)).rejects.toBeInstanceOf(
			ConflictException,
		);
	});

	it('deletes an unused rule set by its revision, refusing one an exception uses or a stale delete', async () => {
		const { service, repo } = harness();
		await repo.createRuleSet(ruleSet({ id: 'rs_used' }));
		await repo.saveException(exception('e1', { kind: 'ruleSet', ruleSetId: 'rs_used' }));
		await expect(service.remove('rs_used', 0, null)).rejects.toBeInstanceOf(ConflictException);

		await repo.createRuleSet(ruleSet({ id: 'rs_free' }));
		await expect(service.remove('rs_free', 3, null)).rejects.toBeInstanceOf(ConflictException);
		const deleteRuleSet = repo.deleteRuleSet;
		repo.deleteRuleSet = async () => false;
		await expect(service.remove('rs_free', 0, null)).rejects.toBeInstanceOf(ConflictException);
		repo.deleteRuleSet = deleteRuleSet;
		await service.remove('rs_free', 0, 'admin-1');
		expect(await repo.findRuleSet('rs_free')).toBeNull();
	});

	it('Try it says when a body cannot ship a line, or gives no result for it', async () => {
		const { service } = harness();
		const ask = (body: ShippingRuleSetBody) =>
			service.tryRuleSet({
				body,
				lines: [{ productId: 'p-1', variationId: null, quantity: 1 }],
				delivery: IN,
				shopper: SHOPPER,
			});
		expect(await ask(CANT_SHIP)).toMatchObject({
			status: 'cantShip',
			amountINR: null,
			adjustments: [],
			noResult: [],
		});
		expect((await ask(CANT_SHIP)).cantShip).toHaveLength(1);
		const empty = await ask(NO_RESULT);
		expect(empty).toMatchObject({ status: 'noResult', amountINR: null, cantShip: [] });
		expect(empty.noResult).toHaveLength(1);
	});
});

describe('zone settings, overview and exceptions: the remaining cases', () => {
	it('reads the defaults in the overview before anything is saved', async () => {
		const { service } = harness();
		expect(await service.overview()).toMatchObject({ settings: null, defaults: DEFAULT_SHIPPING_SETTINGS });
	});

	it('refuses a stale zone save naming nobody when nothing is saved yet, or someone unknown', async () => {
		const { service, repo } = harness();
		const write = { ...DEFAULT_SHIPPING_SETTINGS, revision: 5 };
		await expect(service.saveSettings(write as never, null)).rejects.toBeInstanceOf(ConflictException);
		await repo.saveSettings(
			{ ...DEFAULT_SHIPPING_SETTINGS, revision: 1, updatedBy: 'admin-gone' } as ShippingSettings,
			0,
		);
		await expect(service.saveSettings(write as never, null)).rejects.toBeInstanceOf(ConflictException);
		repo.saveSettings = async () => false;
		await expect(
			service.saveSettings({ ...DEFAULT_SHIPPING_SETTINGS, revision: 1 } as never, null),
		).rejects.toBeInstanceOf(ConflictException);
	});

	it('refuses a zone rule set made for the other zone', async () => {
		const { service, repo } = harness();
		await activeRuleSet(repo, 'rs_abroad', DOMESTIC, { use: 'international' });
		const write = {
			...DEFAULT_SHIPPING_SETTINGS,
			revision: 0,
			domestic: { kind: 'ruleSet', ruleSetId: 'rs_abroad' },
		};
		await expect(service.saveSettings(write as never, null)).rejects.toMatchObject({
			response: { issues: [{ code: 'rule_set_wrong_zone' }] },
		});
	});

	it('checks an exception exists, its product, and keeps an active rule set it points to', async () => {
		const { service } = harness();
		const write = (over: Record<string, unknown> = {}) =>
			({
				target: { kind: 'product', productId: 'p-1' },
				domestic: { kind: 'siteWide' },
				international: { kind: 'ruleSet', ruleSetId: PREMADE_ID },
				...over,
			}) as never;
		await expect(service.saveException('se_none', write(), null)).rejects.toBeInstanceOf(NotFoundException);
		await expect(
			service.saveException(null, write({ target: { kind: 'product', productId: 'x-1' } }), null),
		).rejects.toBeInstanceOf(BadRequestException);
		const made = await service.saveException(null, write(), 'admin-1');
		expect(made).toMatchObject({ international: { kind: 'ruleSet', ruleSetId: PREMADE_ID }, updatedBy: 'admin-1' });
		expect((await service.saveException(made.id, write(), null)).id).toBe(made.id);
		await expect(service.removeException('se_none', null)).rejects.toBeInstanceOf(NotFoundException);
	});

	it('records nothing when there is no audit store', async () => {
		const { service, repo } = harness({ audit: false });
		await repo.saveException(exception('e1', { kind: 'free' }));
		await service.removeException('e1', null);
		expect(await repo.listExceptions()).toEqual([]);
	});
});

describe('the cart tester: the remaining cases', () => {
	const lines = (...ids: string[]) => ids.map((productId) => ({ productId, variationId: null, quantity: 1 }));
	const tryCart = (service: ShippingAdminService, ...ids: string[]) =>
		service.tryCart({ lines: lines(...ids), delivery: IN, shopper: SHOPPER });

	it('names lines with no method as a problem', async () => {
		const { service } = harness();
		const result = await tryCart(service, 'p-1');
		expect(result).toMatchObject({ status: 'unpriced', amountINR: null, groups: [], cantShip: [] });
		expect(result.problems).toEqual([{ kind: 'noMethod', ruleSetId: null, lineIds: ['line-1'] }]);
		expect(result.lines[0]).toMatchObject({
			route: 'noMethod',
			via: 'siteWide',
			ruleSetId: null,
			ruleSetName: null,
		});
	});

	it('names a rule set that is gone, and one that gives no result, with their lines', async () => {
		const gone = harness();
		await gone.repo.saveSettings(settings({ domestic: { kind: 'ruleSet', ruleSetId: 'rs_gone' }, revision: 1 }), 0);
		const missing = await tryCart(gone.service, 'p-1');
		expect(missing.problems).toEqual([{ kind: 'missingRuleSet', ruleSetId: 'rs_gone', lineIds: ['line-1'] }]);
		expect(missing.lines[0]).toMatchObject({ route: 'ruleSet', ruleSetId: 'rs_gone', ruleSetName: null });

		const empty = harness();
		await activeRuleSet(empty.repo, 'rs_empty', NO_RESULT);
		await empty.repo.saveSettings(
			settings({ domestic: { kind: 'ruleSet', ruleSetId: 'rs_empty' }, revision: 1 }),
			0,
		);
		const result = await tryCart(empty.service, 'p-1', 'p-2');
		expect(result.problems).toEqual([{ kind: 'noResult', ruleSetId: 'rs_empty', lineIds: ['line-1', 'line-2'] }]);
	});

	it('shows a courier line under its fallback rule set, and a free line in a group of no rule set', async () => {
		const viaCourier = harness();
		await viaCourier.repo.saveSettings(settings({ domestic: courier(PREMADE_ID), revision: 1 }), 0);
		const courierLine = await tryCart(viaCourier.service, 'p-1');
		expect(courierLine.lines[0]).toMatchObject({
			route: 'courier',
			ruleSetId: PREMADE_ID,
			ruleSetName: expect.any(String),
		});

		const free = harness();
		const result = await tryCart(free.service, 'free-1');
		expect(result).toMatchObject({ status: 'priced', amountINR: 0 });
		expect(result.groups).toEqual([
			expect.objectContaining({ kind: 'free', ruleSetId: null, ruleSetName: null, body: null }),
		]);
		expect(result.lines[0]).toMatchObject({ route: 'free', via: 'freeShippingSwitch', ruleSetId: null });
	});
});

/** The cannot-ship rule set with its message in both languages, as activation needs. */
const CANT_SHIP_BOTH: ShippingRuleSetBody = {
	steps: [
		{
			id: 'step-1',
			scope: 'eachLine',
			combine: 'sum',
			node: {
				kind: 'result',
				id: 'r-1',
				result: { kind: 'cantShip', message: { en: 'Not by post', bn: 'ডাকে পাঠানো যায় না' } },
			},
		},
	],
	adjust: [],
};

describe('the list order and activations: the last cases', () => {
	it('sorts a pre-made set with no key after a known one, whichever side it is on', () => {
		const premade = (premadeKey: string | null) => ruleSet({ kind: 'premade', premadeKey });
		const [first] = PREMADE_RULE_SETS;
		expect(byListOrder(premade('not-designed'), premade(null))).toBe(0);
		expect(byListOrder(premade(first?.key ?? ''), premade(null))).toBeLessThan(0);
	});

	it('numbers a second activation after the first, and reports a test cart the rules cannot price', async () => {
		const { service, repo } = harness();
		const testCarts = [
			{
				id: 'cart-1',
				name: 'Two discounted',
				lines: [{ productId: 'disc-1', variationId: null, quantity: 2 }],
				delivery: IN,
				shopper: SHOPPER,
				expectedINR: 200,
			},
		];
		await repo.createRuleSet(
			ruleSet({ id: 'rs_y', use: 'domestic', activeVersion: null, draft: DOMESTIC, testCarts, revision: 1 }),
		);
		await service.activate('rs_y', { revision: 1, acceptChanges: [] }, 'admin-1');
		const current = (await repo.findRuleSet('rs_y')) as { revision: number };
		const again = await service.activate('rs_y', { revision: current.revision, acceptChanges: [] }, 'admin-1');
		expect(again).toMatchObject({ outcome: 'activated', version: 2 });
		const abroad = {
			...(testCarts[0] as (typeof testCarts)[number]),
			id: 'cart-abroad',
			delivery: { country: 'GB', state: '', pincode: '' },
			expectedINR: 500,
		};
		await repo.createRuleSet(
			ruleSet({
				id: 'rs_z',
				use: 'domestic',
				activeVersion: null,
				draft: CANT_SHIP_BOTH,
				testCarts: [abroad],
				revision: 1,
			}),
		);
		const changed = await service.activate('rs_z', { revision: 1, acceptChanges: [] }, 'admin-1');
		expect(JSON.stringify(changed)).toContain('"toINR":null');
	});
});
