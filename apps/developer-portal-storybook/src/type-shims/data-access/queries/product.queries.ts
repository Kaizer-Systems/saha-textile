import { signal } from '@angular/core';

import type { ICatalogResponse } from '../../../../../storefront/src/app/data-access/interfaces/catalog.interface';
import type {
	IProduct,
	IRecentPurchase,
} from '../../../../../storefront/src/app/data-access/interfaces/product.interface';

import { namedAddonProduct, simpleProduct, variationProduct } from '../../../fixtures/storefront-products';

const products: IProduct[] = [
	structuredClone(simpleProduct),
	structuredClone(variationProduct),
	structuredClone(namedAddonProduct),
];

const catalogue: ICatalogResponse = {
	data: products,
	total: products.length,
	page: 1,
	limit: 12,
	last_page: 1,
	facets: {
		fabric: [
			{ value: 'Pure silk', label: 'Pure silk', count: 2 },
			{ value: 'Cotton', label: 'Cotton', count: 1 },
		],
		occasion: [
			{ value: 'Festive', label: 'Festive', count: 2 },
			{ value: 'Everyday', label: 'Everyday', count: 1 },
		],
	},
	price_range: { min: 1200, max: 9800 },
};

const idleQuery = {
	isFetching: signal(false),
	isPending: signal(false),
};

export function injectCatalogQuery() {
	return {
		...idleQuery,
		data: signal<ICatalogResponse | undefined>(catalogue),
	};
}

export function injectProductBySlugQuery() {
	return {
		...idleQuery,
		data: signal<IProduct | undefined>(products[0]),
	};
}

export function injectRelatedProductsQuery() {
	return {
		...idleQuery,
		data: signal<IProduct[] | undefined>(products.slice(1)),
	};
}

export function injectRelatedProductsData() {
	return {
		...idleQuery,
		data: signal<IProduct[] | undefined>(products.slice(1)),
	};
}

export const RELATED_PRODUCTS_KEY = ['products', 'related', 'current'];

export function injectRecentPurchasesQuery() {
	return {
		...idleQuery,
		data: signal<IRecentPurchase[] | undefined>([]),
	};
}
