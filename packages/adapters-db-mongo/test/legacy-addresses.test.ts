import { describe, expect, it } from 'vitest';

import { approvedLegacyRows, legacyTargetIsLive, normaliseLegacyPath } from '../src/seed/legacy-addresses';

describe('legacy address file', () => {
	it('refuses an unapproved row by name and does not turn it into a 410', () => {
		expect(() =>
			approvedLegacyRows([{ sourcePath: '/old', statusCode: 301, targetPath: '/en/x', approved: false }]),
		).toThrow('/old');
	});

	it('normalises case, a trailing slash, and a filter query', () => {
		expect(normaliseLegacyPath('/Product-Tag/Silk-Sarees/?orderby=price')).toBe('/product-tag/silk-sarees');
	});

	it('keeps a query that is part of the address, and reads the home page', () => {
		expect(normaliseLegacyPath('/old/?p=12&orderby=price')).toBe('/old?p=12');
		expect(normaliseLegacyPath('/')).toBe('/');
	});

	it('accepts a live product and the home page only when it is live', () => {
		const live = new Set(['/product/red-saree']);
		expect(legacyTargetIsLive('/en/product/red-saree', live)).toBe(true);
		expect(legacyTargetIsLive('/fr/product/gone', live)).toBe(false);
		expect(legacyTargetIsLive('/en', live)).toBe(false);
		expect(legacyTargetIsLive('/en/about-us', live)).toBe(false);
	});

	it('accepts the pure silk collection and the contact page, and rejects a missing target', () => {
		const live = new Set(['sarees/pure-silk']);
		expect(legacyTargetIsLive('/en/collections/sarees/pure-silk', live)).toBe(true);
		expect(legacyTargetIsLive('/en/contact-us', live)).toBe(true);
		expect(legacyTargetIsLive('/en/collections/missing', live)).toBe(false);
	});
});
