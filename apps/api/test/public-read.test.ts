import { describe, expect, it } from 'vitest';

import { isPublicRead } from '../src/common/public-read';

describe('which requests skip the shared rate limit', () => {
	it.each([
		['GET', '/catalog/home'],
		['GET', '/catalog/placements?path=sarees'],
		['HEAD', '/catalog/products/x/view'],
		['GET', '/storefront/banners'],
		['GET', '/storefront/youtube?limit=2'],
	])('%s %s is a public read', (method, url) => {
		expect(isPublicRead(method, url)).toBe(true);
	});

	it.each([
		['GET', '/catalog/search?q=silk'],
		['POST', '/catalog/questions'],
		['POST', '/catalog/products/x/stock-alerts'],
		['GET', '/auth/storefront/me'],
		['GET', '/cart/abc'],
		['GET', '/catalogue'],
	])('%s %s stays limited', (method, url) => {
		expect(isPublicRead(method, url)).toBe(false);
	});
});
