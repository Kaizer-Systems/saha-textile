import { describe, expect, it } from 'vitest';

import { hsnValid } from './hsn-popup';
import {
	categoryRefill,
	metreProblem,
	metresToTenths,
	stockFigures,
	stockStatusKey,
	tenthsToMetres,
	type CategoryDefaults,
} from './inventory-fields';

const categories = new Map<string, CategoryDefaults>([
	['banarasi', { id: 'banarasi', name: 'Banarasi', hsnCode: '5007', returnable: true }],
	['tant', { id: 'tant', name: 'Tant', hsnCode: '5208', returnable: true }],
	['fabric', { id: 'fabric', name: 'Fabric', hsnCode: '5208', returnable: false }],
	['gifts', { id: 'gifts', name: 'Gifts', hsnCode: null, returnable: true }],
]);

describe('metre lengths (P11, A01)', () => {
	it('takes 0.1 m steps only, and shows tenths as metres', () => {
		expect(metresToTenths('2.5')).toBe(25);
		expect(metresToTenths('1')).toBe(10);
		expect(metresToTenths('2,5')).toBe(25);
		expect(metresToTenths('2.55')).toBeNull();
		expect(metresToTenths('0')).toBeNull();
		expect(metresToTenths('')).toBeNull();
		expect(metresToTenths('abc')).toBeNull();
		expect(tenthsToMetres(425)).toBe('42.5');
		expect(tenthsToMetres(null)).toBe('');
	});

	it('needs a shortest cut and a weight, and quick lengths at or above the cut with an English label', () => {
		const base = { shortestCut: '1.0', weightPerMetre: '85', width: '44', quickLengths: [] };
		expect(metreProblem(base)).toBeNull();
		expect(metreProblem({ ...base, shortestCut: '' })).toBe('metre_cut_invalid');
		expect(metreProblem({ ...base, weightPerMetre: '8.5' })).toBe('metre_weight_invalid');
		expect(metreProblem({ ...base, width: '-2' })).toBe('metre_width_invalid');
		expect(metreProblem({ ...base, width: '' })).toBeNull();
		expect(metreProblem({ ...base, quickLengths: [{ length: '0.5', label: { en: 'trim' } }] })).toBe(
			'metre_quick_below_cut',
		);
		expect(metreProblem({ ...base, quickLengths: [{ length: '2.55', label: { en: 'suit' } }] })).toBe(
			'metre_quick_invalid',
		);
		expect(metreProblem({ ...base, quickLengths: [{ length: '2.5', label: { bn: 'সুট' } }] })).toBe(
			'metre_quick_label_missing',
		);
		const five = Array.from({ length: 5 }, () => ({ length: '2.5', label: { en: 'suit' } }));
		expect(metreProblem({ ...base, quickLengths: five })).toBe('metre_quick_too_many');
	});
});

describe('stock figures and status (F01)', () => {
	it('adds the variants up and works out the status from free to sell', () => {
		const totals = stockFigures([
			{ quantity: 7, held: 1, inOrders: 0, freeToSell: 6 },
			{ quantity: 2, held: 0, inOrders: 0, freeToSell: 2 },
		]);
		expect(totals).toEqual({ onHand: 9, held: 1, inOrders: 0, free: 8 });
		expect(stockStatusKey(8, 2, false)).toBe('stock_status_in');
		expect(stockStatusKey(2, null, false)).toBe('stock_status_low');
		expect(stockStatusKey(0, 2, false)).toBe('stock_status_out');
		expect(stockStatusKey(0, 2, true)).toBe('stock_status_made_to_order');
	});
});

describe('main category change (F02, P13)', () => {
	it('fills the HSN silently on the first category and asks when it replaces another code', () => {
		expect(categoryRefill({ previousMain: null, nextMain: 'tant', currentHsn: null, categories })).toEqual({
			hsn: '5208',
			popup: null,
			followCategory: false,
		});
		expect(categoryRefill({ previousMain: 'banarasi', nextMain: 'tant', currentHsn: '5007', categories })).toEqual({
			hsn: '5208',
			popup: { category: 'Tant', oldCategory: 'Banarasi', oldHsn: '5007', newHsn: '5208' },
			followCategory: true,
		});
	});

	it('keeps the code when nothing changes, or the new category has none', () => {
		expect(
			categoryRefill({ previousMain: 'tant', nextMain: 'tant', currentHsn: '5407', categories }).popup,
		).toBeNull();
		expect(categoryRefill({ previousMain: 'tant', nextMain: 'fabric', currentHsn: '5208', categories })).toEqual({
			hsn: '5208',
			popup: null,
			followCategory: true,
		});
		expect(categoryRefill({ previousMain: 'tant', nextMain: 'gifts', currentHsn: '5208', categories })).toEqual({
			hsn: '5208',
			popup: null,
			followCategory: true,
		});
		expect(categoryRefill({ previousMain: 'tant', nextMain: null, currentHsn: '5208', categories }).hsn).toBe(
			'5208',
		);
	});

	it('accepts 4, 6 or 8 digit HSN codes only (F02C)', () => {
		expect(hsnValid('5208')).toBe(true);
		expect(hsnValid('520811')).toBe(true);
		expect(hsnValid('52081190')).toBe(true);
		expect(hsnValid('54')).toBe(false);
		expect(hsnValid('52081')).toBe(false);
		expect(hsnValid('52O8')).toBe(false);
	});
});
