import productFixture from '../../../storefront/public/assets/data/product.json';
import siteConfigFixture from '../../../storefront/public/assets/data/site-config.json';

import type { IProduct } from '../../../storefront/src/app/data-access/interfaces/product.interface';
import type { ISiteConfig } from '../../../storefront/src/app/data-access/interfaces/site-config.interface';

const products = productFixture.data as unknown as IProduct[];

function requireProduct(id: number): IProduct {
	const product = products.find((candidate) => candidate.id === id);
	if (!product) {
		throw new Error(`Storybook product fixture ${id} is missing.`);
	}
	return structuredClone(product);
}

export const variationProduct = requireProduct(912);
export const namedAddonProduct = requireProduct(934);
export const simpleProduct = requireProduct(901);
export const siteConfig = structuredClone(siteConfigFixture.options) as unknown as ISiteConfig;

export const semanticAttributes = [
	{ code: 'weave', label: 'Weave', value: 'Handloom', icon: 'ri-hand-heart-line' },
	{ code: 'fabric', label: 'Fabric', value: 'Pure silk', icon: 'ri-scissors-line' },
	{ code: 'occasion', label: 'Occasion', value: 'Festive', icon: 'ri-sparkling-line' },
];

export const measurementFields = [
	{ code: 'shoulder', label: 'Shoulder', unit: 'in', min: 10, max: 24 },
	{ code: 'chest', label: 'Chest', unit: 'in', min: 24, max: 60 },
	{ code: 'waist', label: 'Waist', unit: 'in', min: 20, max: 56 },
	{ code: 'sleeve', label: 'Sleeve', unit: 'in', min: 0, max: 30 },
];

export const optionTerms = [
	{ code: 'classic', label: 'Classic', price_delta: 0 },
	{ code: 'heritage', label: 'Heritage', price_delta: 450 },
	{ code: 'couture', label: 'Couture', price_delta: 900 },
];
