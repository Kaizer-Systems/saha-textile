import type {
	IBundle,
	ISetItem,
	ISetLevel,
} from '../../../storefront/src/app/data-access/interfaces/product-detail.interface';

/** One piece of a set, as the shop's API sends it. */
const piece = (key: string, name: string, price: number, over: Partial<ISetItem> = {}): ISetItem => ({
	key,
	product_id: key,
	slug: key,
	name,
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

const level = (code: string, label: string, take: number, items: ISetItem[]): ISetLevel => ({
	code,
	label,
	take,
	choice: items.length > take,
	price_mode: 'difference',
	items,
});

/** A wedding set at one fixed price: a saree to choose, a blouse piece, and a free petticoat to tick. */
export const weddingSet: IBundle = {
	sku: 'SET-WEDDING',
	heading: 'choose',
	bundle_price: 18_900,
	separately: 0,
	save: 0,
	from_price: true,
	low: 0,
	high: 0,
	levels: [
		level('saree', 'Saree', 1, [
			piece('peacock-banarasi', 'Peacock Banarasi Silk Saree', 16_800),
			piece('ivory-tant', 'Ivory Tant Saree', 6_300),
		]),
		level('blouse', 'Blouse piece', 1, [piece('gold-brocade', 'Gold Brocade Blouse Piece', 2_400)]),
	],
	extras: [piece('cream-petticoat', 'Cream Petticoat', 0, { today: 450 })],
	pricing: {
		base: { kind: 'fixed', input: 'setPrice' },
		inputs: [],
		methodRules: [],
		methodCombine: 'all',
		params: { setPrice: 18_900 },
		rules: [],
		combine: 'all',
		capAtSeparately: false,
		roundTo: 'one',
		eventSale: [],
	},
	stock: { sets_possible: 3, state: 'in_stock', sold_out_pieces: [], sold_out_choices: [] },
	buyable: true,
	option_groups: [],
};
