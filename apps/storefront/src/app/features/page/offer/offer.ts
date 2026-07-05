import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { GetCouponsAction } from '@data-access/actions/coupon.action';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { NoData } from '@shared/ui/no-data/no-data';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { ICouponModel } from '@data-access/interfaces/coupon.interface';
import { CouponState } from '@data-access/states/coupon.state';
import { CouponService } from '@data-access/services/coupon.service';

@Component({
  selector: 'app-offer',
  templateUrl: './offer.html',
  styleUrls: ['./offer.scss'],
  imports: [Breadcrumb, NoData, AsyncPipe, TranslateModule],
})
export class Offer {
  private store = inject(Store);
  couponService = inject(CouponService);

  public skeletonItems = Array.from({ length: 8 }, (_, index) => index);
  public breadcrumb: IBreadcrumb = {
    title: 'Offer',
    items: [{ label: 'Offer', active: true }],
  };

  coupon$: Observable<ICouponModel> = inject(Store).select(CouponState.coupon);

  constructor() {
    this.store.dispatch(new GetCouponsAction({ status: 1 }));
  }

  copyFunction(txt: string) {
    void navigator.clipboard.writeText(txt);
  }
}
