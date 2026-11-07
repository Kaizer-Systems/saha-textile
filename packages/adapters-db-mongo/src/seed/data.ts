import { Category, Currency, Promotion } from '@saha-textile/contracts';

export { seedCustomers } from './customer-seed-data';

/**
 * Seed data validated through the zod contracts (so defaults are applied and the
 * shapes are guaranteed correct). Reflects the real taxonomy. Products are not seeded here:
 * staff enter them in admin, and `seed:demo-catalogue` is the development catalogue.
 */

export const seedCategories: Category[] = [
	Category.parse({ id: 'cat_sarees', name: { en: 'Sarees' }, slug: 'sarees', path: ['cat_sarees'] }),
	Category.parse({
		id: 'cat_pure_silk',
		name: { en: 'Pure Silk Sarees' },
		slug: 'pure-silk-sarees',
		parentId: 'cat_sarees',
		ancestors: ['cat_sarees'],
		path: ['cat_sarees', 'cat_pure_silk'],
		depth: 1,
	}),
	Category.parse({
		id: 'cat_cotton_sarees',
		name: { en: 'Cotton Sarees' },
		slug: 'cotton-sarees',
		parentId: 'cat_sarees',
		ancestors: ['cat_sarees'],
		path: ['cat_sarees', 'cat_cotton_sarees'],
		depth: 1,
	}),
	Category.parse({
		id: 'cat_dress_materials',
		name: { en: 'Dress Materials' },
		slug: 'dress-materials',
		path: ['cat_dress_materials'],
	}),
	Category.parse({
		id: 'cat_salwar_suits',
		name: { en: 'Salwar Suits' },
		slug: 'salwar-suits',
		parentId: 'cat_dress_materials',
		ancestors: ['cat_dress_materials'],
		path: ['cat_dress_materials', 'cat_salwar_suits'],
		depth: 1,
	}),
	Category.parse({
		id: 'cat_unstitched',
		name: { en: 'Unstitched Dress Material' },
		slug: 'unstitched-dress-material',
		parentId: 'cat_dress_materials',
		ancestors: ['cat_dress_materials'],
		path: ['cat_dress_materials', 'cat_unstitched'],
		depth: 1,
	}),
];

export const seedCurrencies: Currency[] = [
	Currency.parse({ code: 'INR', symbol: '₹', enabled: true, rateFromINR: 1 }),
	Currency.parse({
		code: 'USD',
		symbol: '$',
		enabled: true,
		rateFromINR: 0.012,
		paypalActive: true,
		paypalPct: 0.044,
		paypalFixed: 0.3,
	}),
];

export const seedPromotions: Promotion[] = [
	Promotion.parse({
		id: 'promo_flash_red',
		name: 'Red Hot Flash Sale',
		type: 'percentage',
		value: 25,
		scope: 'color',
		targetIds: ['red'],
		kind: 'flash_sale',
	}),
];
