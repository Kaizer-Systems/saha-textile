import type { IBundle, IFreeWith, ISetItem, ISetLevel } from '@data-access/interfaces/product-detail.interface';

/**
 * Builders for set data in unit tests (bundle builder brief, approved 2026-11-22). Only specs import this file.
 */
export const setItem = (key: string, price: number, over: Partial<ISetItem> = {}): ISetItem => ({
	key,
	product_id: key,
	slug: key,
	name: key,
	sku: key.toUpperCase(),
	mrp: null,
	selling: price,
	sale: null,
	price_in_set: price,
	today: price,
	quantity: 1,
	sold_by: 'piece',
	in_stock: true,
	available: 5,
	variant_id: null,
	variant_label: null,
	variants: [],
	free_with: null,
	...over,
});

export const setLevel = (code: string, take: number, items: ISetItem[], over: Partial<ISetLevel> = {}): ISetLevel => ({
	code,
	label: code,
	take,
	choice: items.length > take,
	price_mode: 'difference',
	items,
	...over,
});

/** A set priced "One fixed price" when `setPrice` is given, else "Pieces added up". */
export const setBundle = (levels: ISetLevel[], over: Partial<IBundle> & { setPrice?: number } = {}): IBundle => {
	const { setPrice, ...rest } = over;
	return {
		sku: 'SET',
		heading: levels.some((level) => level.choice) ? 'choose' : 'components',
		bundle_price:
			setPrice ??
			levels.reduce(
				(sum, level) => sum + level.items.slice(0, level.take).reduce((s, i) => s + i.price_in_set, 0),
				0,
			),
		separately: 0,
		save: 0,
		from_price: levels.some((level) => level.choice),
		low: 0,
		high: 0,
		levels,
		extras: [],
		pricing: {
			base: setPrice !== undefined ? { kind: 'fixed', input: 'setPrice' } : { kind: 'pieces' },
			inputs: [],
			methodRules: [],
			methodCombine: 'all',
			params: setPrice !== undefined ? { setPrice } : {},
			rules: [],
			combine: 'all',
			capAtSeparately: false,
			roundTo: 'one',
		},
		stock: { sets_possible: 3, state: 'in_stock', sold_out_pieces: [], sold_out_choices: [] },
		buyable: true,
		option_groups: [],
		...rest,
	};
};

export const freeWith = (over: Partial<IFreeWith> = {}): IFreeWith => ({
	take: 'all',
	count: null,
	from: null,
	required: true,
	given: true,
	min: 1,
	max: 1,
	none_or_exactly: false,
	items: [
		{
			product_id: 'pc',
			name: 'Cream petticoat',
			mrp: 450,
			selling: 450,
			quantity: 1,
			in_stock: true,
			variant_id: null,
			variant_label: null,
			variants: [],
		},
	],
	...over,
});
