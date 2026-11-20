import { Routes } from '@angular/router';

import { CouponBuilder } from './coupon-builder';
import { CouponList } from './coupon-list';

/**
 * Products › Coupons (orders and checkout brief cp01–cp05): the list and the builder on the real
 * coupon API. The theme's demo list and form (`coupon.ts`, `create-coupon`, `edit-coupon`,
 * `form-coupon`) are no longer routed and wait on the end-of-project cleanup list (OC8).
 */
export default [
	{ path: '', component: CouponList },
	{ path: 'create', component: CouponBuilder },
	{ path: 'edit/:id', component: CouponBuilder },
] as Routes;
