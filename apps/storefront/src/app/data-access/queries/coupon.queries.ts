import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { CouponService } from '@data-access/services/coupon.service';

/**
 * TanStack Query for coupons/offers (replaces NGXS CouponState + GetCouponsAction).
 * The query's isPending() drives the skeleton (was CouponService.skeletonLoader).
 */
export function injectCouponsQuery(params: () => Params) {
	const couponService = inject(CouponService);
	return injectQuery(() => ({
		queryKey: ['coupons', params()],
		queryFn: () => firstValueFrom(couponService.getCoupons(params())),
	}));
}
