import type { BundlePriceMethodWrite } from '@saha-textile/contracts';

/**
 * The price methods seeded into the database on day one (owner, 22 Nov 2026: "create those exact same rules by
 * default as seed data into the db"). They are the five shown in brief revision 3 (C01, C08). After seeding they
 * are ordinary records: admin can edit, switch off or delete them in Products › Bundle price methods.
 */
export const SEEDED_PRICE_METHODS: readonly BundlePriceMethodWrite[] = [
	{
		code: 'fixed_price',
		name: { en: 'One fixed price', bn: 'একটি নির্দিষ্ট দাম' },
		help: {
			en: 'You type the set price. A pick dearer than the included piece adds the difference.',
			bn: 'সেটের দাম আপনি লিখবেন। অন্তর্ভুক্ত পিসের চেয়ে দামি পছন্দে শুধু পার্থক্যটুকু যোগ হয়।',
		},
		inputs: [
			{
				code: 'setPrice',
				label: { en: 'Set price', bn: 'সেটের দাম' },
				kind: 'money',
				min: 1,
				max: null,
				default: null,
			},
		],
		base: { kind: 'fixed', input: 'setPrice' },
		rules: [],
		combine: 'all',
		active: true,
		sortOrder: 10,
	},
	{
		code: 'pieces_added_up',
		name: { en: 'Pieces added up', bn: 'পিসগুলোর দামের যোগফল' },
		help: {
			en: 'The set costs what the chosen pieces cost, each at its Price in this set.',
			bn: 'বেছে নেওয়া পিসগুলোর "এই সেটে দাম" যোগ করে সেটের দাম হয়।',
		},
		inputs: [],
		base: { kind: 'pieces' },
		rules: [],
		combine: 'all',
		active: true,
		sortOrder: 20,
	},
	{
		code: 'pieces_percent_off',
		name: { en: 'Pieces, % off', bn: 'পিসগুলোর দাম, % ছাড়' },
		help: {
			en: 'The chosen pieces added up, less a % you choose.',
			bn: 'বেছে নেওয়া পিসগুলোর দামের যোগফল থেকে আপনার বেছে নেওয়া % ছাড়।',
		},
		inputs: [
			{ code: 'percent', label: { en: '% off', bn: '% ছাড়' }, kind: 'percent', min: 1, max: 90, default: 10 },
		],
		base: { kind: 'pieces' },
		rules: [
			{
				id: 'percent-off',
				name: null,
				enabled: true,
				when: { match: 'all', conditions: [] },
				then: [{ kind: 'percentOff', amount: { input: 'percent' }, level: null, items: [] }],
				otherwise: [],
			},
		],
		combine: 'all',
		active: true,
		sortOrder: 30,
	},
	{
		code: 'pieces_amount_off',
		name: { en: 'Pieces, ₹ off', bn: 'পিসগুলোর দাম, ₹ ছাড়' },
		help: {
			en: 'The chosen pieces added up, less an amount you choose.',
			bn: 'বেছে নেওয়া পিসগুলোর দামের যোগফল থেকে আপনার বেছে নেওয়া টাকা ছাড়।',
		},
		inputs: [
			{ code: 'amount', label: { en: '₹ off', bn: '₹ ছাড়' }, kind: 'money', min: 1, max: null, default: null },
		],
		base: { kind: 'pieces' },
		rules: [
			{
				id: 'amount-off',
				name: null,
				enabled: true,
				when: { match: 'all', conditions: [] },
				then: [{ kind: 'amountOff', amount: { input: 'amount' }, level: null, items: [] }],
				otherwise: [],
			},
		],
		combine: 'all',
		active: true,
		sortOrder: 40,
	},
	{
		code: 'buy_more_save_more',
		name: { en: 'Buy more, save more', bn: 'বেশি কিনলে বেশি ছাড়' },
		help: {
			en: 'The chosen pieces added up: 2 pieces get one % off, 3 or more a bigger % off.',
			bn: 'বেছে নেওয়া পিসগুলোর দামের যোগফল: ২টি পিসে এক % ছাড়, ৩টি বা বেশিতে আরও বেশি % ছাড়।',
		},
		inputs: [
			{
				code: 'twoPercent',
				label: { en: '% off for 2 pieces', bn: '২টি পিসে % ছাড়' },
				kind: 'percent',
				min: 1,
				max: 90,
				default: 5,
			},
			{
				code: 'threePercent',
				label: { en: '% off for 3 or more', bn: '৩টি বা বেশিতে % ছাড়' },
				kind: 'percent',
				min: 1,
				max: 90,
				default: 10,
			},
		],
		base: { kind: 'pieces' },
		rules: [
			{
				id: 'three-or-more',
				name: '3 or more pieces',
				enabled: true,
				when: { match: 'all', conditions: [{ fact: 'pieces.count', level: null, op: 'atLeast', value: 3 }] },
				then: [{ kind: 'percentOff', amount: { input: 'threePercent' }, level: null, items: [] }],
				otherwise: [],
			},
			{
				id: 'two',
				name: '2 pieces',
				enabled: true,
				when: { match: 'all', conditions: [{ fact: 'pieces.count', level: null, op: 'atLeast', value: 2 }] },
				then: [{ kind: 'percentOff', amount: { input: 'twoPercent' }, level: null, items: [] }],
				otherwise: [],
			},
		],
		combine: 'first',
		active: true,
		sortOrder: 50,
	},
];
