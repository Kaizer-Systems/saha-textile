import { AsyncPipe } from '@angular/common';
import { Component, computed, effect, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { TranslateModule } from '@ngx-translate/core';
import { Observable } from 'rxjs';

import { injectCouponsQuery } from '@data-access/queries/coupon.queries';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { NoData } from '@shared/ui/no-data/no-data';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { ICouponModel } from '@data-access/interfaces/coupon.interface';
import { CouponService } from '@data-access/services/coupon.service';

@Component({
  selector: 'app-offer',
  templateUrl: './offer.html',
  styleUrls: ['./offer.scss'],
  imports: [Breadcrumb, NoData, AsyncPipe, TranslateModule],
})
export class Offer {
  couponService = inject(CouponService);

  public skeletonItems = Array.from({ length: 8 }, (_, index) => index);
  public breadcrumb: IBreadcrumb = {
    title: 'Offer',
    items: [{ label: 'Offer', active: true }],
  };

  private readonly couponsQuery = injectCouponsQuery(() => ({ status: 1 }));
  coupon$: Observable<ICouponModel> = toObservable(
    computed(() => this.couponsQuery.data() ?? { data: [], total: 0 }),
  );

  constructor() {
    // Drive the template skeleton off the query (was CouponService.skeletonLoader).
    effect(() => {
      this.couponService.skeletonLoader = this.couponsQuery.isPending();
    });
  }

  copyFunction(txt: string) {
    void navigator.clipboard.writeText(txt);
  }
}
