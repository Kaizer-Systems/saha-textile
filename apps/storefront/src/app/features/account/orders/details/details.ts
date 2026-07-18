import { AsyncPipe, DatePipe, TitleCasePipe, UpperCasePipe } from '@angular/common';
import { Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { Observable } from 'rxjs';

import { IOrderStatusModel } from '@data-access/interfaces/order-status.interface';
import { IOrder } from '@data-access/interfaces/order.interface';
import { injectOrderStatusQuery } from '@data-access/queries/order-status.queries';
import { injectOrderByNumberQuery } from '@data-access/queries/order.queries';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { PayModal } from '@shared/ui/modal/pay-modal/pay-modal';
import { RefundModal } from '@shared/ui/modal/refund-modal/refund-modal';

@Component({
	selector: 'app-order-details',
	templateUrl: './details.html',
	styleUrls: ['./details.scss'],
	providers: [CurrencySymbolPipe],
	imports: [
		RouterLink,
		RefundModal,
		PayModal,
		AsyncPipe,
		UpperCasePipe,
		TitleCasePipe,
		DatePipe,
		CurrencySymbolPipe,
		TranslocoModule,
	],
})
export class OrderDetails {
	private route = inject(ActivatedRoute);

	private readonly orderStatusQuery = injectOrderStatusQuery(() => ({}));
	orderStatus$: Observable<IOrderStatusModel | undefined> = toObservable(
		computed(() => this.orderStatusQuery.data()),
	);

	private readonly orderNumber = signal<string | undefined>(undefined);
	private readonly orderQuery = injectOrderByNumberQuery(() => this.orderNumber());

	readonly RefundModal = viewChild<RefundModal>('refundModal');
	readonly PayModal = viewChild<PayModal>('payModal');

	public order: IOrder;

	constructor() {
		// Order looked up by order_number via the query (was ViewOrderAction +
		// OrderState.selectedOrder).
		this.route.params.subscribe((params) => this.orderNumber.set(params['id']));
		effect(() => {
			const found = this.orderQuery.data();
			if (found) this.order = found;
		});
	}
}
