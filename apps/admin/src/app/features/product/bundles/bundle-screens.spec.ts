import { PLATFORM_ID, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BundleService } from '@data-access/services/bundle.service';
import { NotificationService } from '@data-access/services/notification.service';

import { BundleList } from './bundle-list';
import { BundleRuleRows } from './bundle-rule-rows';
import { PriceMethodBuilder } from './price-method-builder';
import { PriceMethodList } from './price-method-list';

import type { BundlePriceRule } from '@saha-textile/contracts';

const h = vi.hoisted(() => ({ list: undefined as unknown, queryFn: null as null | (() => unknown) }));
vi.mock('@tanstack/angular-query-experimental', async (original) => {
	const actual = await original<typeof import('@tanstack/angular-query-experimental')>();
	return {
		...actual,
		injectQuery: (options: () => { queryFn: () => unknown }) => {
			h.queryFn = () => options().queryFn();
			return { data: () => h.list };
		},
	};
});

const t = (key: string, params?: Record<string, unknown>) =>
	params && Object.keys(params).length ? `${key}(${Object.values(params).join('|')})` : key;

const bundles = {
	list: vi.fn((_request: unknown) => of({ items: [], total: 0 })),
	method: vi.fn(() =>
		of({
			id: 'bpm_1',
			seeded: false,
			version: 2,
			usedBy: 3,
			createdAt: 'x',
			updatedAt: 'y',
			name: { en: 'Set price' },
			help: { en: '' },
			base: { kind: 'pieces' },
			inputs: [{ code: 'percent', label: { en: '%' }, kind: 'percent', min: 0, max: 50, default: 10 }],
			rules: [],
			combine: 'all',
		}),
	),
	createMethod: vi.fn((_body: unknown) => of({})),
	updateMethod: vi.fn((_id: string, _body: unknown) => of({})),
	methods: vi.fn(() => of([{ id: 'bpm_1' }])),
	deleteMethod: vi.fn(() => of({})),
};
const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
const router = { navigate: vi.fn() };

function make<T>(type: Type<T>, options: { platform?: string; id?: string } = {}) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: PLATFORM_ID, useValue: options.platform ?? 'browser' },
			{ provide: BundleService, useValue: bundles },
			{ provide: NotificationService, useValue: notifier },
			{ provide: Router, useValue: router },
			{
				provide: TranslocoService,
				useValue: { translate: t, getActiveLang: () => '', langChanges$: of('en') },
			},
			{
				provide: ActivatedRoute,
				useValue: { snapshot: { paramMap: convertToParamMap(options.id ? { id: options.id } : {}) } },
			},
		],
	});
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(type);
	fixture.detectChanges();
	return { c: fixture.componentInstance, fixture };
}

afterEach(() => {
	vi.clearAllMocks();
	h.list = undefined;
});

describe('the sets list (B3)', () => {
	const row = (over: Record<string, unknown> = {}) => ({
		id: 'b1',
		title: 'Wedding set',
		sku: 'ST-SET-1',
		status: 'live',
		wasLive: true,
		showOnShop: true,
		thumbnailUrl: 'https://cdn.test/1.webp',
		bundle: {
			levels: 2,
			choices: true,
			setPriceINR: 25000,
			fromPrice: true,
			stock: {
				state: 'in_stock',
				setsPossible: 4,
				soldOutChoices: [],
				totalChoices: 6,
				soldOutPieces: [],
				totalPieces: 3,
			},
		},
		...over,
	});

	it('draws each set’s levels, price and the stock it works out', async () => {
		h.list = {
			items: [
				row(),
				row({
					id: 'b2',
					thumbnailUrl: null,
					showOnShop: false,
					bundle: {
						levels: 1,
						choices: false,
						setPriceINR: 9000,
						fromPrice: false,
						stock: {
							state: 'low_stock',
							setsPossible: 1,
							soldOutChoices: ['x'],
							totalChoices: 2,
							soldOutPieces: [],
							totalPieces: 2,
						},
					},
				}),
				row({
					id: 'b3',
					bundle: {
						levels: 1,
						choices: false,
						setPriceINR: null,
						stock: {
							state: 'out_of_stock',
							soldOutPieces: ['p'],
							totalPieces: 2,
							soldOutChoices: [],
							totalChoices: 0,
							setsPossible: 0,
						},
					},
				}),
				row({
					id: 'b4',
					bundle: {
						levels: 1,
						choices: false,
						stock: {
							state: 'out_of_stock',
							soldOutPieces: [],
							totalPieces: 2,
							soldOutChoices: [],
							totalChoices: 0,
							setsPossible: 0,
						},
					},
				}),
				row({ id: 'b5', bundle: null, status: 'draft', wasLive: false }),
			],
			total: 5,
		};
		const { c } = make(BundleList);
		const rows = c.tableConfig().data;
		expect(c.tableConfig().total).toBe(5);
		expect(rows[0]).toMatchObject({
			levels: '2 · choose_your_set',
			price: 'from_price(₹25,000)',
			thumb: { original_url: 'https://cdn.test/1.webp' },
		});
		expect(rows[0]?.stock).toContain('bundle_sets_possible(4)');
		expect(rows[1]).toMatchObject({ levels: '1', price: '₹9,000', thumb: null });
		expect(rows[1]?.stock).toContain('bundle_choices_sold_out(1|2)');
		expect(rows[1]?.shop).toContain('hidden_from_shop');
		expect(rows[2]?.price).toBe('—');
		expect(rows[2]?.stock).toContain('bundle_pieces_sold_out(1|2)');
		expect(rows[3]?.stock).toContain('bundle_no_combination');
		expect(rows[4]).toMatchObject({ levels: '0', price: '—' });
		expect(rows[4]?.stock).toContain('bundle_no_levels_yet');
	});

	it('pages, searches and opens a set', async () => {
		const { c } = make(BundleList);
		expect(c.tableConfig().total).toBe(0);
		expect(c.listRequest()).toMatchObject({ page: 1, pageSize: 30 });
		c.onTableChange({ page: 3, paginate: 15, search: 'silk' });
		expect(c.listRequest()).toMatchObject({ page: 3, pageSize: 15 });
		c.onTableChange();
		await h.queryFn?.();
		expect(bundles.list).toHaveBeenCalled();
		c.onActionClicked({ actionToPerform: 'edit', data: { id: 'b1' } } as never);
		c.onActionClicked({ actionToPerform: 'other' } as never);
		expect(router.navigate).toHaveBeenCalledWith(['/product/bundle', 'b1']);
		expect(make(BundleList, { platform: 'server' }).c.tableConfig().data).toEqual([]);
	});
});

describe('a set’s price rules, row by row (C04–C06)', () => {
	function rows(rules: BundlePriceRule[], numbers: unknown[] = []) {
		TestBed.resetTestingModule();
		TestBed.overrideComponent(BundleRuleRows, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(BundleRuleRows);
		fixture.componentRef.setInput('rules', rules);
		fixture.componentRef.setInput('numbers', numbers);
		const c = fixture.componentInstance;
		const out: BundlePriceRule[][] = [];
		c.rulesChange.subscribe((next) => out.push(next));
		return { c, out, last: () => out.at(-1) as BundlePriceRule[] };
	}
	const rule = (over: Partial<BundlePriceRule> = {}): BundlePriceRule =>
		({
			id: 'r1',
			name: null,
			enabled: true,
			when: { match: 'all', conditions: [] },
			then: [],
			otherwise: [],
			...over,
		}) as BundlePriceRule;

	it('adds, changes and removes rules, conditions and actions', () => {
		const { c, out, last } = rows([rule()], [{ code: 'percent' }]);
		expect(c.operatorsFor(null)).toEqual([]);
		expect(c.operatorsFor('pieces.count').length).toBeGreaterThan(0);
		c.addRule();
		expect(last()).toHaveLength(2);
		c.setRule(0, { name: 'Two or more' });
		expect(last()[0]?.name).toBe('Two or more');
		c.removeRule(0);
		expect(last()).toHaveLength(0);
		c.addCondition(0);
		expect(last()[0]?.when.conditions).toHaveLength(1);
		c.addCondition(5);
		c.setCondition(5, 0, {});
		c.removeCondition(5, 0);
		c.addAction(5);
		c.setAction(5, 0, {});
		c.removeAction(5, 0);
		const count = out.length;
		expect(count).toBe(4);
	});

	it('edits a rule’s conditions and actions in place', () => {
		const start = rule({
			when: { match: 'all', conditions: [{ fact: 'pieces.count', level: null, op: 'atLeast', value: 2 }] },
			then: [{ kind: 'percentOff', amount: 10, level: null, items: [] }],
		} as never);
		const { c, last } = rows([start], [{ code: 'percent' }]);
		c.setCondition(0, 0, { value: 3 });
		expect(last()[0]?.when.conditions[0]?.value).toBe(3);
		c.removeCondition(0, 0);
		expect(last()[0]?.when.conditions).toEqual([]);
		c.addAction(0);
		expect(last()[0]?.then).toHaveLength(2);
		c.setAction(0, 0, { kind: 'amountOff' } as never);
		expect(last()[0]?.then[0]?.kind).toBe('amountOff');
		c.setAmount(0, 0, 'percent');
		expect(last()[0]?.then[0]?.amount).toEqual({ input: 'percent' });
		c.setAmount(0, 0, '');
		expect(last()[0]?.then[0]?.amount).toBeNull();
		c.setAmount(0, 0, '15');
		expect(last()[0]?.then[0]?.amount).toBe(15);
		c.removeAction(0, 0);
		expect(last()[0]?.then).toEqual([]);
	});

	it('reads amounts and condition values, and parses each kind of value', () => {
		const { c } = rows([rule()]);
		expect(c.amountText({ amount: null } as never)).toBe('');
		expect(c.amountText({ amount: 5 } as never)).toBe('5');
		expect(c.amountText({ amount: { input: 'percent' } } as never)).toBe('percent');
		expect(c.conditionValue({ value: ['a', 'b'] } as never)).toBe('a, b');
		expect(c.conditionValue({ value: null } as never)).toBe('');
		expect(c.conditionValue({ value: 3 } as never)).toBe('3');
		expect(c.parseValue(' a, ,b ', 'level.pick')).toEqual(['a', 'b']);
		expect(c.parseValue('true', 'pieces.onSale')).toBe(true);
		expect(c.parseValue('false', 'pieces.onSale')).toBe(false);
		expect(c.parseValue(' 2026-12-01 ', 'date')).toBe('2026-12-01');
		expect(c.parseValue('2026-12-01, 2026-12-31', 'date')).toEqual(['2026-12-01', '2026-12-31']);
		expect(c.parseValue('2, 5', null)).toEqual([2, 5]);
		expect(c.parseValue('7', 'pieces.subtotal')).toBe(7);
	});
});

describe('price methods (C01–C03)', () => {
	it('loads a method to edit, tries it on three pieces, and saves it', async () => {
		const { c } = make(PriceMethodBuilder, { id: 'bpm_1' });
		for (let i = 0; i < 6; i++) await Promise.resolve();
		expect(c.method().inputs).toHaveLength(1);
		expect(c.method()).not.toHaveProperty('usedBy');
		expect(c.tried()).toBeTruthy();
		c.setTryParam('percent', '20');
		c.setTryParam('percent', 'x');
		expect(c.tryParams()).toEqual({ percent: 0 });
		c.setSample(1, '5000');
		c.setSample(2, 'x');
		expect(c.sample()).toEqual([16400, 5000, 0]);
		c.lang.set('bn');
		c.setText('name', 'সেটের দাম');
		expect(c.method().name).toEqual({ en: 'Set price', bn: 'সেটের দাম' });
		c.addInput();
		expect(c.method().inputs[1]?.code).toBe('n2');
		c.setInputLabel(1, 'শতাংশ');
		c.setInputLabel(9, 'x');
		expect(c.method().inputs[1]?.label).toEqual({ en: '', bn: 'শতাংশ' });
		c.setInput(1, { default: 5 });
		c.removeInput(1);
		c.setBase('fixed');
		expect(c.method().base).toEqual({ kind: 'fixed', input: 'percent' });
		c.removeInput(0);
		c.setBase('fixed');
		expect(c.method().base).toEqual({ kind: 'fixed', input: 'setPrice' });
		c.setBase('pieces');
		await c.save();
		expect(bundles.updateMethod).toHaveBeenCalledWith('bpm_1', expect.anything());
		expect(router.navigate).toHaveBeenCalledWith(['/product/bundle-price-methods']);
		bundles.updateMethod.mockReturnValueOnce(throwError(() => new Error('down')));
		await c.save();
		expect(notifier.showError).toHaveBeenCalledWith('bundle_method_not_saved');
	});

	it('starts a new method blank and creates it; the server only reads', async () => {
		const { c } = make(PriceMethodBuilder);
		expect(c.id).toBe('new');
		expect(bundles.method).not.toHaveBeenCalled();
		await c.save();
		expect(bundles.createMethod).toHaveBeenCalled();
		make(PriceMethodBuilder, { platform: 'server', id: 'bpm_1' });
		expect(bundles.method).not.toHaveBeenCalled();
	});

	it('lists the methods and removes one, or says it is in use', async () => {
		const { c } = make(PriceMethodList);
		for (let i = 0; i < 6; i++) await Promise.resolve();
		expect(c.lang).toBe('en');
		expect(c.rows()).toEqual([{ id: 'bpm_1' }]);
		await c.remove({ id: 'bpm_1' } as never);
		expect(notifier.showSuccess).toHaveBeenCalledWith('bundle_method_removed');
		bundles.deleteMethod.mockReturnValueOnce(throwError(() => new Error('in use')));
		await c.remove({ id: 'bpm_1' } as never);
		expect(notifier.showError).toHaveBeenCalledWith('bundle_method_in_use');
		make(PriceMethodList, { platform: 'server' });
		expect(bundles.methods).toHaveBeenCalledTimes(2);
	});
});
