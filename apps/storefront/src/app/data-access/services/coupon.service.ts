import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Params } from '@angular/router';

import { Observable } from 'rxjs';

import { ICouponModel } from '@data-access/interfaces/coupon.interface';

import { environment } from '../../../../public/environments/environment';

@Injectable({
	providedIn: 'root',
})
export class CouponService {
	private http = inject(HttpClient);

	public skeletonLoader: boolean = false;

	getCoupons(payload?: Params): Observable<ICouponModel> {
		return this.http.get<ICouponModel>(`${environment.URL}/coupon.json`, { params: payload });
	}
}
