import { Injectable, inject } from '@angular/core';

import { Action, Selector, State, StateContext } from '@ngxs/store';
import { tap } from 'rxjs';

import { GetCouponsAction } from '@data-access/actions/coupon.action';
import { ICoupon } from '@data-access/interfaces/coupon.interface';
import { CouponService } from '../services/coupon.service';

export class CouponStateModel {
  coupon = {
    data: [] as ICoupon[],
    total: 0,
  };
}

@State<CouponStateModel>({
  name: 'coupon',
  defaults: {
    coupon: {
      data: [],
      total: 0,
    },
  },
})
@Injectable()
export class CouponState {
  private couponService = inject(CouponService);

  @Selector()
  static coupon(state: CouponStateModel) {
    return state.coupon;
  }

  @Action(GetCouponsAction)
  getCoupons(ctx: StateContext<CouponStateModel>, action: GetCouponsAction) {
    this.couponService.skeletonLoader = true;
    return this.couponService.getCoupons(action.payload).pipe(
      tap({
        next: result => {
          ctx.patchState({
            coupon: {
              data: result.data,
              total: result?.total ? result?.total : result.data ? result.data.length : 0,
            },
          });
        },
        complete: () => {
          this.couponService.skeletonLoader = false;
        },
        error: err => {
          throw new Error(err?.error?.message);
        },
      }),
    );
  }
}
