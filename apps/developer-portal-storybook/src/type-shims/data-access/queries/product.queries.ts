import { signal } from '@angular/core';

import type { ICatalogResponse } from '../../../../../storefront/src/app/data-access/interfaces/catalog.interface';
import type {
	IProduct,
	IProductModel,
} from '../../../../../storefront/src/app/data-access/interfaces/product.interface';

import { namedAddonProduct, simpleProduct, variationProduct } from '../../../fixtures/storefront-products';

const products: IProduct[] = [
	structuredClone(simpleProduct),
	structuredClone(variationProduct),
	structuredClone(namedAddonProduct),
];

const productPage: IProductModel = {
	data: products,
	total: products.length,
};

const catalogue: ICatalogResponse = {
	data: products,
	total: products.length,
	page: 1,
	limit: 12,
	last_page: 1,
	facets: {
		fabric: [
			{ value: 'Pure silk', count: 2 },
			{ value: 'Cotton', count: 1 },
		],
		occasion: [
			{ value: 'Festive', count: 2 },
			{ value: 'Everyday', count: 1 },
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

export function injectProductsQuery() {
	return {
		...idleQuery,
		data: signal<IProductModel | undefined>(productPage),
	};
}

export function injectDealProductsQuery() {
	return {
		...idleQuery,
		data: signal<IProduct[] | undefined>(products.slice(0, 2)),
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
