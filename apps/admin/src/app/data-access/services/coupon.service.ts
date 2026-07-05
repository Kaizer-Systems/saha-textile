import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { environment } from '../../../../public/environments/environment';
import { Params } from '@data-access/interfaces/core.interface';
import { ICouponModel } from '@data-access/interfaces/coupon.interface';

@Injectable({
	providedIn: 'root',
})
export class CouponService {
	private http = inject(HttpClient);

	getCoupons(payload?: Params): Observable<ICouponModel> {
		return this.http.get<ICouponModel>(`${environment.URL}/coupon.json`, { params: payload });
	}
}
