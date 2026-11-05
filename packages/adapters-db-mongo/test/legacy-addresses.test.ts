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

	it('accepts the pure silk collection and the contact page, and rejects a missing target', () => {
		const live = new Set(['sarees/pure-silk']);
		expect(legacyTargetIsLive('/en/collections/sarees/pure-silk', live)).toBe(true);
		expect(legacyTargetIsLive('/en/contact-us', live)).toBe(true);
		expect(legacyTargetIsLive('/en/collections/missing', live)).toBe(false);
	});
});
