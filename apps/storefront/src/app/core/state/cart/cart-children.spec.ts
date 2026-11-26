import { describe, expect, it } from 'vitest';

import { cartChildCounts, cartChildRows, cartSetSaving } from './cart-children';
import { ApiCartLine, cartItem, lineChoice } from './cart-view';

type Child = NonNullable<ApiCartLine['children']>[number];

const child = (over: Partial<Child>): Child => ({
	role: 'piece',
	key: 'k',
	parentKey: null,
	level: null,
	productId: 'p',
	title: 'Piece',
	sku: 'SKU',
	image: null,
	variantLabel: null,
	quantity: 1,
	priceINR: 0,
	mrpINR: null,
	...over,
});

const line = (over: Partial<ApiCartLine> = {}): ApiCartLine => ({
	id: 'line_1',
	productId: 'set1',
	slug: 'wedding-set',
	title: 'Wedding saree set',
	image: null,
	sku: 'BND-0001',
	variationId: null,
	variantLabel: null,
	quantity: 1,
	available: 4,
	basePriceINR: 16675,
	unitPriceINR: 16675,
	mrpINR: 18500,
	lineTotalINR: 16675,
	options: [],
	measurements: [],
	problem: null,
	...over,
});

const setLine = () =>
	line({
		setHeading: 'choose',
		bundle: { picks: { l1: ['a'] }, variants: {}, extras: ['box'], free: {} },
		children: [
			child({ key: 'a', title: 'Bottle Green saree', priceINR: 12000 }),
			child({ role: 'free', key: 'a>petti', parentKey: 'a', title: 'Petticoat', mrpINR: 799 }),
			child({ key: 'b', title: 'Blouse piece', priceINR: 4425 }),
			child({ role: 'extra', key: 'box', title: 'Gift box', priceINR: 250 }),
		],
	});

describe('a set in the cart (bundle builder brief E02–E04)', () => {
	it('orders pieces with their free items beneath, then extras, all folding on phones', () => {
		const rows = cartChildRows(cartItem(setLine()));
		expect(rows.map((row) => [row.child.title, row.depth, row.number, row.folds])).toEqual([
			['Bottle Green saree', 1, 1, true],
			['Petticoat', 2, null, true],
			['Blouse piece', 1, 2, true],
			['Gift box', 1, null, true],
		]);
		expect(cartChildCounts(cartItem(setLine()))).toEqual({ pieces: 2, extras: 1, free: 1, folded: 4 });
	});

	it('shows the saving against the pieces bought separately', () => {
		expect(cartSetSaving(cartItem(setLine()))).toBe(1825);
		expect(cartSetSaving(cartItem(line({ mrpINR: null })))).toBe(0);
	});

	it('keeps the set choice for Edit, and sends it back', () => {
		const item = cartItem(setLine());
		expect(item.set_heading).toBe('choose');
		expect(item.line_config?.raw?.set_choice?.extras).toEqual(['box']);
		const choice = lineChoice({
			id: item.id,
			product: item.product,
			product_id: item.product_id,
			variation: null,
			variation_id: null,
			quantity: 1,
			line_config: item.line_config,
		});
		expect(choice.bundle?.picks).toEqual({ l1: ['a'] });
	});

	it("never folds a product's own free items", () => {
		const item = cartItem(
			line({
				setHeading: null,
				free: [{ productId: 'petti', variantId: null }],
				children: [child({ role: 'free', key: 'product>petti', title: 'Petticoat', mrpINR: 799 })],
			}),
		);
		expect(cartChildRows(item)).toMatchObject([{ depth: 1, folds: false }]);
		expect(item.line_config?.raw?.free_items).toEqual([{ productId: 'petti', variantId: null }]);
	});
});
