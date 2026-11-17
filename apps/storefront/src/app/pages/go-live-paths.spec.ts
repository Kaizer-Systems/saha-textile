import { readdirSync } from 'node:fs';
import { relative } from 'node:path';

import { SHOP_FIXED_PATHS } from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';

/**
 * The Page Builder's link check (SG-13) treats `SHOP_FIXED_PATHS` as pages that are always there. Each one must be
 * a page file here, so a page that is moved or removed can never keep passing the check.
 */
describe('the fixed shop addresses the Page Builder trusts', () => {
	const files = (readdirSync(__dirname, { recursive: true }) as string[])
		.filter((file) => file.endsWith('.page.ts'))
		.map((file) => relative('.', file).replace(/\.page\.ts$/, ''))
		.map((file) => (file === 'index' ? '' : file));

	it('are page files of the shop', () => {
		expect(files).toContain('product/[slug]');
		for (const path of SHOP_FIXED_PATHS) expect(files, path).toContain(path);
	});
});
