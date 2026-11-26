import { signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthStore } from '@core/state/auth.store';
import {
	conditionWords,
	formulaWords,
	groupWords,
	newZoneCondition,
	newZoneFormula,
	newZoneGroup,
	newZoneRule,
	ruleWords,
} from '@core/zones/zone-blocks';
import { ZonesGateway } from '@core/zones/zones.gateway';
import { NotificationService } from '@data-access/services/notification.service';
import { ProductService } from '@data-access/services/product.service';

import { ZoneConditions, startValue } from './zone-conditions';
import { ZoneEditor, isoToLocalInput, localInputToIso, zoneProblemsOf } from './zone-editor';
import { ZoneFormula } from './zone-formula';
import { ZoneList, zonePill } from './zone-list';

import type { PriceZone, ZoneCondition, ZoneConditionGroup, ZonePriceFormula, ZoneRule } from '@saha-textile/contracts';

const h = vi.hoisted(() => ({
	categories: undefined as unknown,
	zones: undefined as unknown,
	confirm: true,
}));
vi.mock('@data-access/queries/category.queries', async () => {
	const { signal: make } = await import('@angular/core');
	const data = make<unknown>(undefined);
	return {
		injectCategoriesQuery: (params: () => unknown) => {
			params();
			data.set(h.categories);
			return { data };
		},
	};
});
vi.mock('@core/zones/zones.gateway', async (original) => ({
	...(await original<typeof import('@core/zones/zones.gateway')>()),
	injectZonesQuery: () => ({ data: () => h.zones }),
}));
vi.mock('@features/purchasing/shared/popups', () => ({ askConfirm: async () => h.confirm }));

const t = (key: string, params?: Record<string, unknown>) =>
	key === 'zone_trace_unknown' ? key : params ? `${key}(${Object.values(params).join('|')})` : key;

const bare = <T>(type: Type<T>, providers: unknown[] = []) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: providers as never[] });
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	return TestBed.createComponent(type);
};

const refused = { error: { issues: [{ code: 'x', message: 'Refused here' }] } };

function zone(change: Partial<PriceZone> = {}): PriceZone {
	return {
		id: 'zone_1',
		code: 'WHOLESALE',
		name: 'Wholesale',
		description: '',
		status: 'draft',
		system: false,
		revision: 3,
		rules: [],
		...change,
	} as unknown as PriceZone;
}

function editor(options: { id?: string | null; permissions?: string[]; zone?: PriceZone } = {}) {
	const gateway = {
		get: vi.fn(() => of(options.zone ?? zone())),
		save: vi.fn((id: string | null) => of(zone({ id: id ?? 'zone_new' }))),
		setStatus: vi.fn(() => of(zone({ status: 'live' }))),
		tryRules: vi.fn(() => of({ lines: [] })),
	};
	const products = {
		getCatalogProducts: vi.fn(() =>
			of({
				items: [
					{ id: 'p1', title: 'Silk', sku: 'S-1' },
					{ id: 'p2', title: 'Cotton', sku: 'C-1' },
				],
			}),
		),
	};
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const router = { navigate: vi.fn(async () => true) };
	const queryClient = { invalidateQueries: vi.fn(async () => undefined) };
	const permissions = signal(options.permissions ?? ['price_zone.edit', 'price_zone.create', 'stock.cost']);
	const fixture = bare(ZoneEditor, [
		{
			provide: ActivatedRoute,
			useValue: { snapshot: { paramMap: { get: () => (options.id === undefined ? 'zone_1' : options.id) } } },
		},
		{ provide: Router, useValue: router },
		{ provide: ZonesGateway, useValue: gateway },
		{ provide: ProductService, useValue: products },
		{ provide: NotificationService, useValue: notifier },
		{ provide: TranslocoService, useValue: { translate: t } },
		{ provide: QueryClient, useValue: queryClient },
		{ provide: AuthStore, useValue: { permissions } },
	]);
	return { c: fixture.componentInstance, gateway, products, notifier, router, queryClient, permissions };
}

const settle = async () => {
	for (let i = 0; i < 6; i++) await Promise.resolve();
};

function productRule(ids: string[], change: Partial<ZoneRule> = {}): ZoneRule {
	return { ...newZoneRule('product'), scope: { tier: 'product', productIds: ids as [string] }, ...change };
}

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
	h.categories = undefined;
	h.zones = undefined;
	h.confirm = true;
});

describe('the zone editor (DEC-B2B-ZONES)', () => {
	it('loads the zone, lists categories with their sub-categories, and searches products', async () => {
		h.categories = {
			data: [
				{ id: 1, name: 'Sarees', subcategories: [{ id: 2, name: 'Silk' }] },
				{ id: 3, name: 'Fabric' },
			],
		};
		const { c, gateway, products } = editor();
		await settle();
		expect(gateway.get).toHaveBeenCalledWith('zone_1');
		expect(c.name()).toBe('Wholesale');
		expect(c.categories()).toEqual([
			{ id: '1', label: 'Sarees' },
			{ id: '2', label: '— Silk' },
			{ id: '3', label: 'Fabric' },
		]);
		expect(c.categoryOptions()).toHaveLength(3);
		await vi.advanceTimersByTimeAsync(300);
		expect(products.getCatalogProducts).toHaveBeenCalledWith({ search: '', pageSize: 15 });
		expect(c.productNames().get('p1')).toBe('Silk · S-1');
		c.searchProducts({ search: 'cot' } as never);
		await vi.advanceTimersByTimeAsync(300);
		expect(products.getCatalogProducts).toHaveBeenLastCalledWith({ search: 'cot', pageSize: 15 });
	});

	it('keeps chosen products in the list, named when known', async () => {
		const { c } = editor({ zone: zone({ rules: [productRule(['p1', 'p9']), newZoneRule('allProducts')] }) });
		await settle();
		expect(c.productOptions()).toEqual([
			{ value: 'p1', label: 'p1' },
			{ value: 'p9', label: 'p9' },
		]);
		await vi.advanceTimersByTimeAsync(300);
		const options = c.productOptions() as Array<{ value: string; label: string }>;
		expect(options[0]).toEqual({ value: 'p9', label: 'p9' });
		expect(options.filter((row) => row.value === 'p1')).toEqual([{ value: 'p1', label: 'Silk · S-1' }]);
		expect(c.words()[0]?.text).toContain('zone_words_scope_products(2)');
	});

	it('starts empty for a new zone', async () => {
		const created = editor({ id: null });
		await settle();
		expect(created.gateway.get).not.toHaveBeenCalled();
		expect(created.c.readOnly()).toBe(false);
	});

	it('reports a zone it cannot load', async () => {
		TestBed.resetTestingModule();
		const gateway = { get: vi.fn(() => throwError(() => refused)) };
		TestBed.configureTestingModule({
			providers: [
				{ provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'zone_1' } } } },
				{ provide: Router, useValue: {} },
				{ provide: ZonesGateway, useValue: gateway },
				{ provide: ProductService, useValue: { getCatalogProducts: () => of({ items: [] }) } },
				{ provide: NotificationService, useValue: {} },
				{ provide: TranslocoService, useValue: { translate: t } },
				{ provide: QueryClient, useValue: {} },
				{ provide: AuthStore, useValue: { permissions: signal([]) } },
			],
		});
		TestBed.overrideComponent(ZoneEditor, { set: { imports: [], template: '' } });
		const c = TestBed.createComponent(ZoneEditor).componentInstance;
		await settle();
		expect(c.error()).toBe('Refused here');
		expect(c.readOnly()).toBe(true);
		expect(c.mayReadCost()).toBe(false);
	});

	it('is read-only for a system zone or without the permission', async () => {
		const { c } = editor();
		await settle();
		expect(c.readOnly()).toBe(false);
		expect(c.mayReadCost()).toBe(true);
		c.zone.set(zone({ system: true }));
		expect(c.readOnly()).toBe(true);
		const plain = editor({ permissions: ['price_zone.create'] });
		expect(plain.c.readOnly()).toBe(true);
	});

	it('adds, changes, copies, drops and removes rules within their tiers', async () => {
		const { c } = editor();
		await settle();
		c.rules.set([]);
		c.addRule('allProducts');
		c.addRule('category');
		c.addRule('product');
		const [all, category, product] = c.rules() as [ZoneRule, ZoneRule, ZoneRule];
		c.update(all, { name: 'All' });
		expect(c.rules()[0]?.name).toBe('All');
		c.duplicate(c.rules()[0] as ZoneRule);
		expect(c.rules()[1]?.name).toBe('All (2)');
		c.duplicate(category);
		expect(
			c
				.rules()
				.filter((rule) => rule.scope.tier === 'category')
				.map((rule) => rule.name),
		).toEqual(['', '']);
		c.remove(c.rules()[1] as ZoneRule);
		const allTier = () => c.byTier().allProducts.map((rule) => rule.id);
		c.addRule('allProducts');
		const before = allTier();
		c.drop('allProducts', { previousIndex: 0, currentIndex: 1 } as never);
		expect(allTier()).toEqual([before[1], before[0]]);
		c.addConditions(product);
		expect(c.rules().find((rule) => rule.id === product.id)?.when?.kind).toBe('group');
		c.setProducts(product, { value: ['p1', 2] } as never);
		expect(c.productIdsOf(c.rules().find((rule) => rule.id === product.id) as ZoneRule)).toEqual(['p1', '2']);
		c.setProducts(product, { value: 'p1' } as never);
		expect(c.productIdsOf(c.rules().find((rule) => rule.id === product.id) as ZoneRule)).toEqual([]);
		expect(c.productIdsOf(all)).toEqual([]);
		c.setCategories(category, { value: ['1'] } as never);
		const savedCategory = () => c.rules().find((rule) => rule.id === category.id) as ZoneRule;
		expect(c.categoryIdsOf(savedCategory())).toEqual(['1']);
		expect(c.categoryIdsOf(all)).toEqual([]);
		c.setSubcategories(savedCategory(), false);
		expect((savedCategory().scope as { includeSubcategories: boolean }).includeSubcategories).toBe(false);
		c.setCategories(savedCategory(), { value: null } as never);
		expect((savedCategory().scope as { includeSubcategories: boolean }).includeSubcategories).toBe(false);
		// A rule that was not a category rule gets sub-categories on.
		c.setCategories(all, { value: ['3'] } as never);
		expect(c.rules().find((rule) => rule.id === all.id)?.scope).toEqual({
			tier: 'category',
			categoryIds: ['3'],
			includeSubcategories: true,
		});
		const before2 = c.rules();
		c.setSubcategories(product, true);
		expect(c.rules()).toEqual(before2);
	});

	it('reads amounts, the server’s problems per rule, and the rules in words', async () => {
		h.categories = { data: [{ id: 'cat_1', name: 'Silk' }] };
		const { c } = editor();
		await vi.advanceTimersByTimeAsync(300);
		expect(c.amount('₹1,500')).toBe(1500);
		expect(c.amount('  ')).toBeNull();
		expect(c.amount('-5')).toBeNull();
		expect(c.amount('abc')).toBeNull();
		const rule = productRule(['p1']);
		expect(c.problemsOf(rule)).toEqual([]);
		c.problems.set(new Map([[rule.id, ['value_missing']]]));
		expect(c.problemsOf(rule)).toEqual(['value_missing']);
		c.rules.set([
			rule,
			productRule(['p_unknown']),
			{
				...newZoneRule('category'),
				scope: { tier: 'category', categoryIds: ['cat_1'] as [string], includeSubcategories: false },
			},
			{
				...newZoneRule('allProducts'),
				when: {
					...newZoneGroup(),
					items: [
						{
							...newZoneCondition(),
							field: 'line.categoryIds',
							op: 'isOneOf',
							value: ['cat_1', 'p1', 'zz'],
						},
					],
				},
			},
		]);
		const words = c.words().map((row) => row.text);
		expect(words).toHaveLength(4);
		expect(words[3]).toContain('Silk, Silk · S-1, zz');
		expect(words[2]).toContain('zone_words_scope_categories(Silk)');
		expect(c.toLocal(null)).toBe('');
		expect(c.fromLocal('')).toBeNull();
		expect(c.canPriceAddOns(rule)).toBe(true);
		expect(c.addOnWords({ kind: 'noPrice', reason: 'noRule' } as never)).toBe('zone_try_addons_listed');
	});

	it('tries the rules on chosen products, up to twenty, and shows a failure', async () => {
		const { c, gateway, notifier } = editor();
		await vi.advanceTimersByTimeAsync(300);
		await c.tryIt();
		expect(gateway.tryRules).not.toHaveBeenCalled();
		c.addTryItem({ value: null } as never);
		c.addTryItem({ value: undefined } as never);
		expect(c.tryItems()).toEqual([]);
		c.addTryItem({ value: 'p1' } as never);
		c.addTryItem({ value: 'p1' } as never);
		c.addTryItem({ value: 'p_new' } as never);
		expect(c.tryItems().map((row) => row.label)).toEqual(['Silk · S-1', 'p_new']);
		c.setTryQuantity('p1', 0);
		c.setTryQuantity('p_new', 4);
		expect(c.tryItems().map((row) => row.quantity)).toEqual([1, 4]);
		c.removeTryItem('p_new');
		await c.tryIt();
		expect(gateway.tryRules).toHaveBeenCalledWith({
			rules: c.rules(),
			items: [{ productId: 'p1', variantId: null, quantity: 1 }],
		});
		expect(c.tryResult()).toEqual({ lines: [] });
		expect(c.trying()).toBe(false);
		gateway.tryRules.mockReturnValueOnce(throwError(() => new Error('down')));
		await c.tryIt();
		expect(notifier.showError).toHaveBeenCalledWith('ord_action_failed');
		for (let at = 0; at < 25; at++) c.addTryItem({ value: `x${at}` } as never);
		expect(c.tryItems()).toHaveLength(20);
	});

	it('words each trace step, and falls back to the code itself', async () => {
		const { c } = editor();
		await settle();
		c.rules.set([
			{ ...newZoneRule('allProducts'), id: 'r_named', name: 'Silk −15%' },
			{ ...newZoneRule('allProducts'), id: 'r_plain' },
		]);
		expect(c.traceWords('addOns:percentOff:10')).toBe('zone_trace_addOns_percent(10)');
		expect(c.traceWords('tier:product')).toBe('zone_trace_tier(zone_tier_product)');
		expect(c.traceWords('rule:r_named')).toBe('zone_trace_rule(Silk −15%)');
		expect(c.traceWords('rule:r_plain')).toBe('zone_trace_rule(zone_unnamed_rule)');
		expect(c.traceWords('rule:r_gone')).toBe('zone_trace_rule(zone_unnamed_rule)');
		expect(c.traceWords('formula:flatPrice')).toBe('zone_trace_formula(zone_kind_flatPrice)');
		expect(c.traceWords('rounding:endingInNine')).toBe('zone_trace_rounding(zone_rounding_endingInNine)');
		expect(c.traceWords('retail:sale')).toBe('zone_trace_retail(zone_retail_sale)');
		expect(c.traceWords('floor:500')).toBe('zone_trace_floor(500)');
		expect(c.traceWords('unknown:x')).toBe('unknown:x');
		expect(c.traceWords('')).toBe('zone_trace_()');
	});

	it('saves only a named zone with a proper code, and moves a new one to its own address', async () => {
		const created = editor({ id: null });
		await settle();
		expect(await created.c.save()).toBeNull();
		created.c.name.set('  Wholesale  ');
		created.c.code.set('wholesale');
		expect(created.c.canSave()).toBe(false);
		created.c.code.set('WHOLESALE');
		expect(created.c.canSave()).toBe(true);
		created.c.saving.set(true);
		expect(created.c.canSave()).toBe(false);
		created.c.saving.set(false);
		const saved = await created.c.save();
		expect(saved?.id).toBe('zone_new');
		expect(created.gateway.save).toHaveBeenCalledWith(null, {
			code: 'WHOLESALE',
			name: 'Wholesale',
			description: '',
			rules: [],
		});
		expect(created.c.id()).toBe('zone_new');
		expect(created.router.navigate).toHaveBeenCalledWith(['/zones', 'zone_new'], { replaceUrl: true });
		expect(created.notifier.showSuccess).toHaveBeenCalledWith('zone_saved');
		// Saved again, it sends the revision and stays where it is.
		created.router.navigate.mockClear();
		await created.c.save();
		expect(created.gateway.save).toHaveBeenLastCalledWith('zone_new', expect.objectContaining({ revision: 3 }));
		expect(created.router.navigate).not.toHaveBeenCalled();
		const none = editor({ id: null, permissions: [] });
		none.c.name.set('X');
		none.c.code.set('XX');
		expect(none.c.canSave()).toBe(false);
	});

	it('marks the rules the server flagged when a save is refused', async () => {
		const { c, gateway } = editor();
		await settle();
		gateway.save.mockReturnValueOnce(
			throwError(() => ({
				error: {
					issues: [
						{
							code: 'zone_rule_problems',
							message: 'Fix the rules',
							params: { problems: [{ ruleId: 'r1', problem: 'value_missing' }] },
						},
					],
				},
			})),
		);
		expect(await c.save()).toBeNull();
		expect(c.problems().get('r1')).toEqual(['value_missing']);
		expect(c.error()).toBe('Fix the rules');
		expect(c.saving()).toBe(false);
	});

	it('saves before changing the status, and changes a read-only zone’s status as it is', async () => {
		const { c, gateway, notifier } = editor();
		await settle();
		await c.setStatus('live');
		expect(gateway.save).toHaveBeenCalled();
		expect(gateway.setStatus).toHaveBeenCalledWith('zone_1', { status: 'live', revision: 3 });
		expect(notifier.showSuccess).toHaveBeenCalledWith('zone_status_saved_live');
		expect(c.zone()?.status).toBe('live');
		// A save that fails stops it.
		gateway.setStatus.mockClear();
		gateway.save.mockReturnValueOnce(throwError(() => refused));
		await c.setStatus('archived');
		expect(gateway.setStatus).not.toHaveBeenCalled();
		// Read-only: no save, the loaded zone is used.
		const locked = editor({ permissions: [] });
		await settle();
		await locked.c.setStatus('archived');
		expect(locked.gateway.save).not.toHaveBeenCalled();
		expect(locked.gateway.setStatus).toHaveBeenCalledWith('zone_1', { status: 'archived', revision: 3 });
		locked.gateway.setStatus.mockReturnValueOnce(throwError(() => refused));
		await locked.c.setStatus('live');
		expect(locked.c.error()).toBe('Refused here');
		expect(locked.c.saving()).toBe(false);
		// Read-only with nothing loaded: nothing to change.
		const empty = editor({ id: null, permissions: [] });
		await empty.c.setStatus('live');
		expect(empty.gateway.setStatus).not.toHaveBeenCalled();
	});
});

describe('zone helpers', () => {
	it('finds flagged rules only where the body has them', () => {
		expect(zoneProblemsOf(null).size).toBe(0);
		expect(zoneProblemsOf({ error: 'text' }).size).toBe(0);
		expect(zoneProblemsOf({ error: { issues: 'none' } }).size).toBe(0);
		const map = zoneProblemsOf({
			error: {
				issues: [
					{
						params: {
							problems: [
								{ ruleId: 'r1', problem: 'a' },
								{ ruleId: 'r1', problem: 'b' },
							],
						},
					},
					{
						params: {
							problems: [
								{ ruleId: 2, problem: 'c' },
								{ ruleId: 'r2', problem: null },
							],
						},
					},
					{ params: { problems: 'none' } },
					{},
					null,
				],
			},
		});
		expect([...map]).toEqual([['r1', ['a', 'b']]]);
		expect(localInputToIso('not-a-date')).toBeNull();
		expect(isoToLocalInput(null)).toBe('');
	});

	it('words every formula, condition and rule', () => {
		const words = (formula: ZonePriceFormula) => formulaWords(formula, t);
		expect(words(newZoneFormula('amountOffBase'))).toBe('zone_words_amount_off(₹100|zone_base_regularSelling)');
		expect(words(newZoneFormula('flatPrice'))).toBe('zone_words_flat(₹0)');
		expect(words({ kind: 'flatPrice', amountINR: 900, skuPrices: { 'S-1': 800 } })).toBe(
			'zone_words_flat_with_skus(₹900|1)',
		);
		expect(words(newZoneFormula('percentAboveCost'))).toBe('zone_words_above_cost(30)');
		expect(words(newZoneFormula('pricePerMetre'))).toBe('zone_words_per_metre(₹100)');
		expect(words(newZoneFormula('orderValueBreaks'))).toContain('zone_words_from_order(₹50,000|');
		expect(words(newZoneFormula('higherOf'))).toContain('zone_words_higherOf(');
		expect(words(newZoneFormula('noPrice'))).toBe('zone_words_no_price');
		const condition = (change: Partial<ZoneCondition>) =>
			conditionWords({ ...newZoneCondition(), ...change } as ZoneCondition, t);
		expect(condition({ value: false })).toBe('zone_field_line_isOnSale zone_op_is zone_no');
		expect(condition({ field: 'line.quantity', op: 'between', value: [2, 5] })).toBe(
			'zone_field_line_quantity zone_op_between 2–5',
		);
		expect(condition({ field: 'line.currentSaleINR', op: 'between', value: [100, 200] })).toBe(
			'zone_field_line_currentSaleINR zone_op_between ₹100–₹200',
		);
		expect(condition({ field: 'line.categoryIds', op: 'isOneOf', value: ['a', 'b'] })).toBe(
			'zone_field_line_categoryIds zone_op_isOneOf a, b',
		);
		expect(condition({ field: 'line.categoryIds', op: 'isOneOf', value: ['a'] })).toBe(
			'zone_field_line_categoryIds zone_op_isOneOf a',
		);
		expect(condition({ field: 'line.quantity', op: 'atLeast', value: 10 } as never)).toBe(
			'zone_field_line_quantity zone_op_atLeast 10',
		);
		expect(condition({ field: 'line.currentSaleINR', op: 'atLeast', value: 1000 } as never)).toBe(
			'zone_field_line_currentSaleINR zone_op_atLeast ₹1,000',
		);
		expect(condition({ field: 'line.currentSaleINR', op: 'isEmpty', value: null })).toBe(
			'zone_field_line_currentSaleINR zone_op_isEmpty',
		);
		const group: ZoneConditionGroup = {
			...newZoneGroup(),
			join: 'any',
			items: [newZoneCondition(), { ...newZoneGroup(), items: [newZoneCondition()] }],
		};
		expect(groupWords(group, t)).toContain('zone_words_or');
		const rule = (change: Partial<ZoneRule>) => ruleWords({ ...newZoneRule('allProducts'), ...change }, t);
		expect(ruleWords({ ...newZoneRule('product'), scope: { tier: 'product', productIds: ['p1'] } }, t)).toContain(
			'zone_words_scope_products(1)',
		);
		expect(
			ruleWords(
				{
					...newZoneRule('category'),
					scope: { tier: 'category', categoryIds: ['cat_1'], includeSubcategories: false },
				},
				t,
			),
		).toContain('zone_words_scope_categories(cat_1)');
		expect(rule({ minQuantityPerLine: 5, ceilingINR: 900 })).toContain('zone_words_min_qty(5); ');
		expect(rule({ ceilingINR: 900 })).toContain('zone_words_ceiling(₹900)');
		expect(rule({ when: { ...newZoneGroup(), items: [] } })).not.toContain('zone_words_when');
	});
});

describe('zone conditions', () => {
	function conditions(group: ZoneConditionGroup) {
		const fixture = bare(ZoneConditions);
		fixture.componentRef.setInput('group', group);
		const c = fixture.componentInstance;
		const changes: ZoneConditionGroup[] = [];
		let removed = 0;
		c.groupChange.subscribe((next) => changes.push(next));
		c.removed.subscribe(() => (removed += 1));
		return { c, changes, removed: () => removed };
	}

	it('starts values of each kind and picks the value box', () => {
		expect(startValue('line.quantity', 'isNotEmpty')).toBeNull();
		expect(startValue('line.productId', 'isOneOf')).toEqual([]);
		expect(startValue('line.quantity', 'atLeast' as never)).toBe(0);
		const { c } = conditions(newZoneGroup());
		const box = (change: Partial<ZoneCondition>) => c.box({ ...newZoneCondition(), ...change } as ZoneCondition);
		expect(box({ op: 'isEmpty' })).toBe('none');
		expect(box({})).toBe('yesNo');
		expect(box({ field: 'line.categoryIds', op: 'isOneOf' })).toBe('categories');
		expect(box({ field: 'line.productId', op: 'isOneOf' })).toBe('products');
		expect(box({ field: 'line.quantity', op: 'between' })).toBe('range');
		expect(box({ field: 'line.quantity', op: 'atLeast' } as never)).toBe('single');
		expect(c.fields).not.toContain('line.productId');
		expect(c.count()).toBe(1);
		expect(c.num('₹1,200')).toBe(1200);
		expect(c.num('x')).toBe(0);
		expect(c.splitIds(' p1, p2  p3,,')).toEqual(['p1', 'p2', 'p3']);
		const select = document.createElement('select');
		select.multiple = true;
		for (const value of ['a', 'b']) {
			const option = document.createElement('option');
			option.value = value;
			option.selected = value === 'b';
			select.append(option);
		}
		expect(c.selected(select)).toEqual(['b']);
	});

	it('changes fields, operators, values and the join, and adds and removes rows', () => {
		const group: ZoneConditionGroup = { ...newZoneGroup(), items: [newZoneCondition(), newZoneGroup()] };
		const { c, changes, removed } = conditions(group);
		c.setField(0, 'line.quantity');
		expect(changes.at(-1)?.items[0]).toMatchObject({ field: 'line.quantity', value: expect.anything() });
		c.setOp(0, 'isEmpty');
		expect(changes.at(-1)?.items[0]).toMatchObject({ op: 'isEmpty', value: null });
		const count = changes.length;
		c.setOp(1, 'isEmpty');
		c.setOp(5, 'isEmpty');
		expect(changes).toHaveLength(count);
		c.setValue(0, false);
		expect((changes.at(-1)?.items[0] as ZoneCondition).value).toBe(false);
		c.setJoin('any');
		expect(changes.at(-1)?.join).toBe('any');
		c.add(false);
		c.add(true);
		expect(changes.at(-1)?.items.at(-1)?.kind).toBe('group');
		c.replace(1, newZoneCondition());
		expect(changes.at(-1)?.items[1]?.kind).toBe('condition');
		c.replace(0, null);
		expect(changes.at(-1)?.items).toHaveLength(1);
		const single = conditions({ ...newZoneGroup(), items: [newZoneCondition()] });
		single.c.replace(0, null);
		expect(single.removed()).toBe(1);
		expect(removed()).toBe(0);
	});
});

describe('zone formula', () => {
	function formula(start: ZonePriceFormula) {
		const fixture = bare(ZoneFormula);
		fixture.componentRef.setInput('formula', start);
		const c = fixture.componentInstance;
		const out: ZonePriceFormula[] = [];
		c.formulaChange.subscribe((next) => out.push(next));
		return { c, out };
	}

	it('changes the kind only when it differs, and patches values', () => {
		const { c, out } = formula(newZoneFormula('percentOffBase'));
		expect(c.nested('quantityBreaks')).toBe(true);
		expect(c.nested('higherOf')).toBe(true);
		expect(c.nested('flatPrice')).toBe(false);
		c.setKind('percentOffBase');
		expect(out).toEqual([]);
		c.setKind('flatPrice');
		expect(out.at(-1)?.kind).toBe('flatPrice');
		c.patch({ percent: 25 });
		expect(out.at(-1)).toMatchObject({ kind: 'percentOffBase', percent: 25 });
		expect(c.num('₹2,000')).toBe(2000);
		expect(c.num('nope')).toBe(0);
	});

	it('adds, changes and removes quantity and order-value breaks', () => {
		const quantity = formula(newZoneFormula('quantityBreaks'));
		quantity.c.addBreak();
		expect((quantity.out.at(-1) as { breaks: Array<{ minQuantity: number }> }).breaks[1]?.minQuantity).toBe(20);
		quantity.c.setBreak(0, { minQuantity: 5 });
		expect((quantity.out.at(-1) as { breaks: Array<{ minQuantity: number }> }).breaks[0]?.minQuantity).toBe(5);
		quantity.c.removeBreak(0);
		expect((quantity.out.at(-1) as { breaks: unknown[] }).breaks).toEqual([]);
		const order = formula(newZoneFormula('orderValueBreaks'));
		order.c.addBreak();
		expect((order.out.at(-1) as { breaks: Array<{ minGoodsINR: number }> }).breaks[1]?.minGoodsINR).toBe(100_000);
		const emptyQuantity = formula({ kind: 'quantityBreaks', breaks: [] } as never);
		emptyQuantity.c.addBreak();
		expect((emptyQuantity.out.at(-1) as { breaks: Array<{ minQuantity: number }> }).breaks[0]?.minQuantity).toBe(
			10,
		);
		const emptyOrder = formula({ kind: 'orderValueBreaks', breaks: [] } as never);
		emptyOrder.c.addBreak();
		expect((emptyOrder.out.at(-1) as { breaks: Array<{ minGoodsINR: number }> }).breaks[0]?.minGoodsINR).toBe(
			50_000,
		);
	});

	it('adds, sets and removes the parts of a lower-of', () => {
		const { c, out } = formula(newZoneFormula('lowerOf'));
		c.addPart();
		expect((out.at(-1) as { formulas: ZonePriceFormula[] }).formulas.at(-1)?.kind).toBe('flatPrice');
		c.setPart(0, newZoneFormula('pricePerMetre'));
		expect((out.at(-1) as { formulas: ZonePriceFormula[] }).formulas.map((row) => row.kind)).toEqual([
			'pricePerMetre',
			'amountOffBase',
		]);
		c.removePart(1);
		expect((out.at(-1) as { formulas: ZonePriceFormula[] }).formulas).toHaveLength(1);
	});
});

describe('the zone list', () => {
	function list() {
		const gateway = { remove: vi.fn(() => of({})) };
		const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
		const queryClient = { invalidateQueries: vi.fn(async () => undefined) };
		const fixture = bare(ZoneList, [
			{ provide: ZonesGateway, useValue: gateway },
			{ provide: NgbModal, useValue: {} },
			{ provide: NotificationService, useValue: notifier },
			{ provide: TranslocoService, useValue: { translate: t } },
			{ provide: QueryClient, useValue: queryClient },
		]);
		return { c: fixture.componentInstance, gateway, notifier, queryClient };
	}

	it('puts RETAIL first, then the zones by name, and reads the status pill', () => {
		const { c } = list();
		expect(c.rows()).toEqual([]);
		h.zones = [
			{ id: 'b', name: 'Bulk', system: false },
			{ id: 'r', name: 'Retail', system: true },
			{ id: 'a', name: 'Agents', system: false },
		];
		expect(c.rows().map((row) => row.id)).toEqual(['r', 'a', 'b']);
		h.zones = [
			{ id: 'r', name: 'Retail', system: true },
			{ id: 'a', name: 'Agents', system: false },
		];
		expect(c.rows().map((row) => row.id)).toEqual(['r', 'a']);
		expect(zonePill('archived')).toBe('cancelled');
		expect(zonePill('draft')).toBe('pending');
		expect(c.day(null)).toBeTypeOf('string');
	});

	it('deletes a zone once confirmed, and shows a refusal', async () => {
		const { c, gateway, notifier, queryClient } = list();
		const row = { id: 'z1', name: 'Agents' } as never;
		h.confirm = false;
		await c.remove(row);
		expect(gateway.remove).not.toHaveBeenCalled();
		h.confirm = true;
		await c.remove(row);
		expect(gateway.remove).toHaveBeenCalledWith('z1');
		expect(queryClient.invalidateQueries).toHaveBeenCalled();
		expect(notifier.showSuccess).toHaveBeenCalledWith('zone_deleted');
		gateway.remove.mockReturnValueOnce(throwError(() => refused));
		await c.remove(row);
		expect(notifier.showError).toHaveBeenCalledWith('Refused here');
	});
});
