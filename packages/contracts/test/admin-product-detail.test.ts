import { describe, expect, it } from 'vitest';

import { AdminProductDetail } from '../src/index';

describe('AdminProductDetail', () => {
	it('carries every product type the form can open, bundles included', () => {
		const type = AdminProductDetail.shape.type;
		for (const value of ['simple', 'variable', 'bundle']) expect(type.safeParse(value).success).toBe(true);
		expect(type.safeParse('grouped').success).toBe(false);
	});
});
