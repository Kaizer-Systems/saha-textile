import { Component, inject, input, viewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { TranslocoModule } from '@jsverse/transloco';
import { Observable } from 'rxjs';

import { AuthStore } from '@core/state/auth.store';
import { SiteConfigStore } from '@core/state/site-config.store';
import { IProduct } from '@data-access/interfaces/product.interface';
import { ISiteConfig } from '@data-access/interfaces/site-config.interface';
import { DeliveryReturnModal } from '@shared/ui/modal/delivery-return-modal/delivery-return-modal';
import { QuestionModal } from '@shared/ui/modal/question-modal/question-modal';
import { SizeChartModal } from '@shared/ui/modal/size-chart-modal/size-chart-modal';

@Component({
	selector: 'app-product-action',
	templateUrl: './product-action.html',
	styleUrls: ['./product-action.scss'],
	imports: [SizeChartModal, DeliveryReturnModal, QuestionModal, TranslocoModule],
})
export class ProductAction {
	private authStore = inject(AuthStore);

	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly product = input<IProduct>();

	readonly SizeChartModal = viewChild<SizeChartModal>('sizeChartModal');
	readonly DeliveryReturnModal = viewChild<DeliveryReturnModal>('deliveryReturnModal');
	readonly QuestionModal = viewChild<QuestionModal>('questionModal');

	siteConfig$: Observable<ISiteConfig> = toObservable(inject(SiteConfigStore).siteConfig) as Observable<ISiteConfig>;

	public policy: string;
	public isLogin: boolean;

	constructor() {
		this.siteConfig$.subscribe((option) => {
			this.policy = option?.product?.shipping_and_return;
		});
		// Presentation only — the API authorizes wishlist/notify actions independently.
		this.isLogin = this.authStore.isAuthenticated();
	}
}
