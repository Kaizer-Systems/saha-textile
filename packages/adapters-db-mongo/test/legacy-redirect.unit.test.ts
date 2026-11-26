import { describe, expect, it } from 'vitest';

import { legacyRedirectDoc } from '../src/seed/seed-demo-catalogue';

describe('legacy address redirects (no database)', () => {
	it('sends a moved page to its new address, and a page gone for good nowhere', () => {
		expect(
			legacyRedirectDoc({
				sourcePath: '/shop/red-saree',
				statusCode: 301,
				targetPath: '/en/p/red',
				approved: true,
			}),
		).toEqual({
			_id: 'redir__shop_red_saree',
			sourcePath: '/shop/red-saree',
			statusCode: 301,
			targetPath: '/en/p/red',
			reason: 'legacy_woo',
		});
		expect(legacyRedirectDoc({ sourcePath: '/old-sale', statusCode: 410, approved: true })).toEqual({
			_id: 'redir__old_sale',
			sourcePath: '/old-sale',
			statusCode: 410,
			reason: 'legacy_woo',
		});
	});
});
