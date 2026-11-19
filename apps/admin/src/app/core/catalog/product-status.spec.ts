import { describe, expect, it } from 'vitest';

import { productStatusView } from './product-status';

describe('productStatusView', () => {
	it('names each status in the admin’s words (Q4 = A)', () => {
		expect(productStatusView('live', true)).toEqual({ label: 'product_state_live', pill: 'status-success' });
		expect(productStatusView('discontinued', true).label).toBe('product_state_discontinued');
		expect(productStatusView('disabled', true).label).toBe('product_state_off_shop');
		expect(productStatusView('disabled', false).label).toBe('product_state_not_live_yet');
		expect(productStatusView('draft', false).label).toBe('product_state_not_live_yet');
	});
});
