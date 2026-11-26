import { describe, expect, it } from 'vitest';

import {
	chosenPieces,
	includedPicks,
	isChoiceGroup,
	isOptionalPiece,
	pieceChangeINR,
	picksFor,
	piecePriceINR,
	setPriceINR,
	type SetPriceGroup,
	type SetPricePiece,
	type SetPricing,
	type SetPricePolicy,
} from '../src/catalog/set-price';

/** The example's two groups, typed as present. */
const groupsOf = (pricing: SetPricing) => pricing.groups as [SetPriceGroup, SetPriceGroup];

// The brief's example: pick 1 of 3 sarees, a second saree, an optional petticoat.
const set = (policy: SetPricePolicy, fixedPriceINR: number | null = null): SetPricing => ({
	policy,
	fixedPriceINR,
	groups: [
		{
			code: 'saree',
			maxSelections: 1,
			pieces: [
				{ id: 'peacock', priceINR: 35800, quantity: 1, required: true, adjustmentINR: 800 },
				{ id: 'maroon', priceINR: 36600, quantity: 1, required: true, adjustmentINR: 600 },
				{ id: 'gold', priceINR: 30000, quantity: 1, required: true },
			],
		},
		{
			code: 'second',
			maxSelections: 2,
			pieces: [
				{ id: 'arni', priceINR: 12600, quantity: 1, required: true },
				{ id: 'petticoat', priceINR: 500, quantity: 2, required: false },
			],
		},
	],
});

describe('set price: groups and pieces', () => {
	it('tells a choice group from a list of pieces, and finds the optional ones', () => {
		const [saree, second] = groupsOf(set('sum_components'));
		expect([isChoiceGroup(saree), isChoiceGroup(second)]).toEqual([true, false]);
		const [arni, petticoat] = second.pieces as [SetPricePiece, SetPricePiece];
		const [peacock] = saree.pieces as [SetPricePiece];
		expect(isOptionalPiece(second, petticoat)).toBe(true);
		expect(isOptionalPiece(second, arni)).toBe(false);
		expect(isOptionalPiece(saree, peacock)).toBe(false);
		expect([includedPicks(saree), includedPicks(second)]).toEqual([['peacock'], []]);
	});

	it("keeps only a group's own picks, up to its limit, else its included ones", () => {
		const [saree, second] = groupsOf(set('sum_components'));
		expect(picksFor(saree, ['maroon', 'gold'])).toEqual(['maroon']);
		expect(picksFor(saree, ['nope'])).toEqual(['peacock']);
		expect(picksFor(saree, undefined)).toEqual(['peacock']);
		expect(picksFor(second, ['arni'])).toEqual([]);
	});

	it('lists the pieces the set holds', () => {
		const pricing = set('sum_components');
		expect(chosenPieces(pricing)).toEqual(['peacock', 'arni']);
		expect(chosenPieces(pricing, { picks: { saree: ['gold'] }, extras: ['petticoat'] })).toEqual([
			'gold',
			'arni',
			'petticoat',
		]);
	});

	it('prices a piece by quantity, less its adjustment only when discounted', () => {
		const piece = { id: 'x', priceINR: 1000, quantity: 2, required: true, adjustmentINR: 300 };
		expect(piecePriceINR('sum_components', piece)).toBe(2000);
		expect(piecePriceINR('discounted_components', piece)).toBe(1400);
		expect(piecePriceINR('discounted_components', { ...piece, adjustmentINR: 5000 })).toBe(0);
	});
});

describe('set price: each price setting (owner, 21 Nov 2026)', () => {
	it('fixed price: a dearer pick adds the difference, a cheaper one changes nothing, an extra adds its price', () => {
		const pricing = set('fixed_bundle_price', 7300);
		expect(setPriceINR(pricing)).toBe(7300);
		expect(setPriceINR(pricing, { picks: { saree: ['maroon'] } })).toBe(8100);
		expect(setPriceINR(pricing, { picks: { saree: ['gold'] } })).toBe(7300);
		expect(setPriceINR(pricing, { picks: { saree: ['maroon'] }, extras: ['petticoat'] })).toBe(9100);
		expect(pieceChangeINR(pricing, 'saree', 'maroon')).toBe(800);
		expect(pieceChangeINR(pricing, 'saree', 'gold')).toBe(0);
		expect(pieceChangeINR(pricing, 'second', 'petticoat')).toBe(1000);
	});

	it('fixed price without its amount costs what the pieces cost', () => {
		expect(setPriceINR(set('fixed_bundle_price', null))).toBe(35800 + 12600);
	});

	it('sum of pieces: the set costs what the chosen pieces cost, up or down', () => {
		const pricing = set('sum_components');
		expect(setPriceINR(pricing)).toBe(48400);
		expect(setPriceINR(pricing, { picks: { saree: ['gold'] }, extras: ['petticoat'] })).toBe(30000 + 12600 + 1000);
		expect(pieceChangeINR(pricing, 'saree', 'maroon')).toBe(800);
		expect(pieceChangeINR(pricing, 'saree', 'gold')).toBe(-5800);
		expect(pieceChangeINR(pricing, 'saree', 'peacock')).toBe(0);
	});

	it('discounted pieces: the chosen pieces less their own adjustments', () => {
		const pricing = set('discounted_components');
		expect(setPriceINR(pricing)).toBe(35000 + 12600);
		expect(pieceChangeINR(pricing, 'saree', 'maroon')).toBe(36000 - 35000);
	});

	it('changes nothing for a required piece, an unknown group or an unknown piece', () => {
		const pricing = set('sum_components');
		expect(pieceChangeINR(pricing, 'second', 'arni')).toBe(0);
		expect(pieceChangeINR(pricing, 'nope', 'arni')).toBe(0);
		expect(pieceChangeINR(pricing, 'saree', 'nope')).toBe(0);
	});

	it('swaps the last included piece when a group takes more than one', () => {
		const pricing: SetPricing = {
			policy: 'sum_components',
			fixedPriceINR: null,
			groups: [
				{
					code: 'pair',
					maxSelections: 2,
					pieces: [
						{ id: 'a', priceINR: 100, quantity: 1, required: true },
						{ id: 'b', priceINR: 200, quantity: 1, required: true },
						{ id: 'c', priceINR: 500, quantity: 1, required: true },
					],
				},
			],
		};
		expect(setPriceINR(pricing)).toBe(300);
		expect(pieceChangeINR(pricing, 'pair', 'c')).toBe(300);
		expect(setPriceINR(pricing, { picks: { pair: ['a', 'c'] } })).toBe(600);
	});
});
