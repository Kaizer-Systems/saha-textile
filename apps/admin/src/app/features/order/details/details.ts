import { DatePipe, isPlatformBrowser, TitleCasePipe, UpperCasePipe, AsyncPipe } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterModule } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';
import { Select2Data, Select2Module, Select2UpdateEvent } from 'ng-select2-component';
import { Observable, of, Subject } from 'rxjs';
import { map, switchMap, takeUntil } from 'rxjs/operators';

import { injectOrderStatusQuery } from '@data-access/queries/order-status.queries';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { IOrderStatus, IOrderStatusModel } from '@data-access/interfaces/order-status.interface';
import { IOrder } from '@data-access/interfaces/order.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { OrderService } from '@data-access/services/order.service';

@Component({
	selector: 'app-details',
	templateUrl: './details.html',
	styleUrls: ['./details.scss'],
	imports: [
		PageWrapper,
		Select2Module,
		RouterModule,
		UpperCasePipe,
		TitleCasePipe,
		DatePipe,
		TranslateModule,
		CurrencySymbolPipe,
		AsyncPipe,
		DatePipe,
		TitleCasePipe,
		UpperCasePipe,
	],
})
export class Details {
	private route = inject(ActivatedRoute);
	private orderService = inject(OrderService);

	private readonly orderStatusQuery = injectOrderStatusQuery(() => ({}));
	orderStatus$: Observable<IOrderStatusModel | undefined> = toObservable(this.orderStatusQuery.data);
	orderStatuses$: Observable<Select2Data> = toObservable(
		computed(() => this.orderStatusQuery.data()?.data.map((status) => ({ label: status.name, value: status.id })) ?? []),
	);

	public order: IOrder;
	public statuses: IOrderStatus[] = [];
	public isBrowser: boolean;

	private destroy$ = new Subject<void>();

	constructor() {
		const platformId = inject(PLATFORM_ID);

		this.isBrowser = isPlatformBrowser(platformId);
	}

	ngOnInit() {
		this.route.params
			.pipe(
				switchMap((params) => {
					if (!params['id']) return of();
					return this.orderService
						.getOrders()
						.pipe(map((res) => res.data.find((order) => order.order_number == params['id']) ?? null));
				}),
				takeUntil(this.destroy$),
			)
			.subscribe((order) => {
				this.order = order!;
			});
	}

	updateOrderStatus(data: Select2UpdateEvent) {
		if (data && data?.value) {
			// Update order status has no backend yet.
		}
	}

	ngOnDestroy() {
		this.statuses = [];
		this.destroy$.next();
		this.destroy$.complete();
	}
}
