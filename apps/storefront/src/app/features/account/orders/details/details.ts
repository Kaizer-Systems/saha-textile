import { AsyncPipe, DatePipe, TitleCasePipe, UpperCasePipe } from '@angular/common';
import { Component, inject, viewChild } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable, Subject, of } from 'rxjs';
import { mergeMap, switchMap, takeUntil } from 'rxjs/operators';

import { GetOrderStatusAction } from '@data-access/actions/order-status.action';
import { ViewOrderAction } from '@data-access/actions/order.action';
import { PayModal } from '@shared/ui/modal/pay-modal/pay-modal';
import { RefundModal } from '@shared/ui/modal/refund-modal/refund-modal';
import { IOrderStatusModel } from '@data-access/interfaces/order-status.interface';
import { IOrder } from '@data-access/interfaces/order.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { OrderStatusState } from '@data-access/states/order-status.state';
import { OrderState } from '@data-access/states/order.state';

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
    TranslateModule
],
})
export class OrderDetails {
  private store = inject(Store);
  private route = inject(ActivatedRoute);

  orderStatus$: Observable<IOrderStatusModel> = inject(Store).select(OrderStatusState.orderStatus);

  readonly RefundModal = viewChild<RefundModal>('refundModal');
  readonly PayModal = viewChild<PayModal>('payModal');

  private destroy$ = new Subject<void>();

  public order: IOrder;

  constructor() {
    this.store.dispatch(new GetOrderStatusAction());
  }

  ngOnInit() {
    this.route.params
      .pipe(
        switchMap(params => {
          if (!params['id']) return of();
          return this.store
            .dispatch(new ViewOrderAction(params['id']))
            .pipe(mergeMap(() => this.store.select(OrderState.selectedOrder)));
        }),
        takeUntil(this.destroy$),
      )
      .subscribe(order => {
        this.order = order!;
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
