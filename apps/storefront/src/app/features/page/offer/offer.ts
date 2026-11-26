import { AsyncPipe } from '@angular/common';
import { Component, computed } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { TranslocoModule } from '@jsverse/transloco';
import { Observable } from 'rxjs';

import { ICouponModel } from '@data-access/interfaces/coupon.interface';
import { injectCouponsQuery } from '@data-access/queries/coupon.queries';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { NoData } from '@shared/ui/no-data/no-data';
import { translatedBreadcrumb } from '@shared/util/breadcrumb-i18n';

@Component({
	selector: 'app-offer',
	templateUrl: './offer.html',
	styleUrls: ['./offer.scss'],
	imports: [Breadcrumb, NoData, AsyncPipe, TranslocoModule],
})
export class Offer {
	public skeletonItems = Array.from({ length: 8 }, (_, index) => index);
	public breadcrumb = translatedBreadcrumb('offer', {
		description: 'offer_meta_description',
		// The coupons shown are the theme's demo list; kept out of search until real offers exist.
		robots: 'noindex,follow',
	});

	private readonly couponsQuery = injectCouponsQuery(() => ({ status: 1 }));
	coupon$: Observable<ICouponModel> = toObservable(
		computed(() => this.couponsQuery.data() ?? { data: [], total: 0 }),
	);

	/**
	 * The skeleton follows the query's own signal. A plain field set from an effect did not
	 * redraw the page when the answer came, so the skeleton stayed up for good.
	 */
	readonly loading = computed(() => this.couponsQuery.isPending());

	copyFunction(txt: string) {
		void navigator.clipboard.writeText(txt);
	}
}
