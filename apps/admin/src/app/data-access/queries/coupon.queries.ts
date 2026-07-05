import { inject } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { CouponService } from '@data-access/services/coupon.service';

export function injectCouponsQuery(params: () => Params) {
	const couponService = inject(CouponService);
	return injectQuery(() => ({
		queryKey: ['coupons', params()],
		queryFn: () => firstValueFrom(couponService.getCoupons(params())),
	}));
}

export function injectCouponQuery(id: () => number | undefined) {
	const couponService = inject(CouponService);
	return injectQuery(() => ({
		queryKey: ['coupon', id()],
		enabled: id() != null,
		queryFn: async () => {
			const res = await firstValueFrom(couponService.getCoupons());
			return res.data.find((coupon) => coupon.id == id()) ?? null;
		},
	}));
}
