import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, Observable } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';
import { queryParams } from '@core/purchasing/purchasing.gateway';
import { PAGE_EXPLAINS_ERRORS } from '@core/shipping/shipping.gateway';

import type {
	AdminOrderCreate,
	Coupon,
	CouponBulkAction,
	CouponBulkResult,
	CouponListQuery,
	CouponListResponse,
	CouponOption,
	CouponTryRequest,
	CouponTryResult,
	CouponWrite,
} from '@saha-textile/contracts';

/** Every coupon screen reads under this key, so a change refreshes them all. */
export const COUPONS_KEY = ['admin-coupons'] as const;

/** Products › Coupons (orders and checkout brief cp01–cp07; OD4): the builder, the list and the checkout popup. */
@Injectable({ providedIn: 'root' })
export class CouponsGateway {
	private readonly http = inject(HttpClient);
	private readonly api = (path = '') => `${runtimeConfig.apiUrl}/admin/coupons${path}`;
	private readonly id = (value: string) => encodeURIComponent(value);

	list(query: Partial<CouponListQuery>): Observable<CouponListResponse> {
		return this.http.get<CouponListResponse>(this.api(), { params: queryParams(query) });
	}

	get(id: string): Observable<Coupon> {
		return this.http.get<Coupon>(this.api(`/${this.id(id)}`));
	}

	save(id: string | null, body: CouponWrite): Observable<Coupon> {
		return id
			? this.http.put<Coupon>(this.api(`/${this.id(id)}`), body, PAGE_EXPLAINS_ERRORS)
			: this.http.post<Coupon>(this.api(), body, PAGE_EXPLAINS_ERRORS);
	}

	switch(id: string, enabled: boolean): Observable<Coupon> {
		return this.http.post<Coupon>(this.api(`/${this.id(id)}/switch`), { enabled }, PAGE_EXPLAINS_ERRORS);
	}

	bulkSwitch(body: CouponBulkAction): Observable<CouponBulkResult> {
		return this.http.post<CouponBulkResult>(this.api('/bulk-switch'), body, PAGE_EXPLAINS_ERRORS);
	}

	bulkDelete(body: CouponBulkAction): Observable<CouponBulkResult> {
		return this.http.post<CouponBulkResult>(this.api('/bulk-delete'), body, PAGE_EXPLAINS_ERRORS);
	}

	tryIt(body: CouponTryRequest): Observable<CouponTryResult> {
		return this.http.post<CouponTryResult>(this.api('/try'), body, PAGE_EXPLAINS_ERRORS);
	}

	/** The admin checkout's coupon popup (cp06): what each usable coupon would take off this order. */
	checkoutOptions(body: AdminOrderCreate): Observable<CouponOption[]> {
		return this.http.post<CouponOption[]>(
			`${runtimeConfig.apiUrl}/admin/orders/checkout/coupons`,
			body,
			PAGE_EXPLAINS_ERRORS,
		);
	}
}

export function injectCouponListQuery(query: () => Partial<CouponListQuery>) {
	const gateway = inject(CouponsGateway);
	return injectQuery(() => ({
		queryKey: [...COUPONS_KEY, 'list', query()],
		queryFn: () => firstValueFrom(gateway.list(query())),
		placeholderData: (previous: CouponListResponse | undefined) => previous,
	}));
}
