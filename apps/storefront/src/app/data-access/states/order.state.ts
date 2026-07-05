import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';

import { Action, Selector, State, StateContext, Store } from '@ngxs/store';
import { tap } from 'rxjs';

import {
  CheckoutAction,
  ClearAction,
  GetOrdersAction,
  PlaceOrderAction,
  RePaymentAction,
  VerifyPaymentAction,
  ViewOrderAction,
} from '@data-access/actions/order.action';
import { IOrder, IOrderCheckout } from '@data-access/interfaces/order.interface';
import { OrderService } from '../services/order.service';

export class OrderStateModel {
  order = {
    data: [] as IOrder[],
    total: 0,
  };
  selectedOrder: IOrder | null;
  checkout: IOrderCheckout | null;
}

@State<OrderStateModel>({
  name: 'order',
  defaults: {
    order: {
      data: [],
      total: 0,
    },
    selectedOrder: null,
    checkout: null,
  },
})
@Injectable()
export class OrderState {
  private store = inject(Store);
  private router = inject(Router);
  private orderService = inject(OrderService);

  @Selector()
  static order(state: OrderStateModel) {
    return state.order;
  }

  @Selector()
  static selectedOrder(state: OrderStateModel) {
    return state.selectedOrder;
  }

  @Selector()
  static checkout(state: OrderStateModel) {
    return state.checkout;
  }

  @Action(GetOrdersAction)
  getOrders(ctx: StateContext<OrderStateModel>, action: GetOrdersAction) {
    return this.orderService.getOrders(action?.payload).pipe(
      tap({
        next: result => {
          ctx.patchState({
            order: {
              data: result.data,
              total: result?.total ? result?.total : result.data ? result.data.length : 0,
            },
          });
        },
        error: err => {
          throw new Error(err?.error?.message);
        },
      }),
    );
  }

  @Action(ViewOrderAction)
  viewOrder(ctx: StateContext<OrderStateModel>, { id }: ViewOrderAction) {
    this.orderService.skeletonLoader = true;
    return this.orderService.getOrders().pipe(
      tap({
        next: result => {
          const state = ctx.getState();
          const order = result.data.find(order => order.order_number == id);

          ctx.patchState({
            ...state,
            selectedOrder: order,
          });
        },
        error: err => {
          throw new Error(err?.error?.message);
        },
        complete: () => {
          this.orderService.skeletonLoader = false;
        },
      }),
    );
  }

  @Action(CheckoutAction)
  checkout(ctx: StateContext<OrderStateModel>, _action: CheckoutAction) {
    const state = ctx.getState();

    // It Just Static Values as per cart default value (When you are using api then you need calculate as per your requirement)
    const order = {
      total: {
        convert_point_amount: -10,
        convert_wallet_balance: -84.4,
        coupon_total_discount: 10,
        points: 300,
        points_amount: 10,
        shipping_total: 0,
        sub_total: 35.19,
        tax_total: 2.54,
        total: 37.73,
        wallet_balance: 84.4,
      },
    };

    ctx.patchState({
      ...state,
      checkout: order,
    });
  }

  @Action(PlaceOrderAction)
  placeOrder(_ctx: StateContext<OrderStateModel>, _action: PlaceOrderAction) {
    void this.router.navigateByUrl(`/account/order/details/1000`);
  }

  @Action(RePaymentAction)
  verifyPayment(_ctx: StateContext<OrderStateModel>, _action: RePaymentAction) {
    // Verify Payment Logic Here
  }

  @Action(VerifyPaymentAction)
  rePayment(_ctx: StateContext<OrderStateModel>, _action: VerifyPaymentAction) {
    // Re Payment Logic Here
  }

  @Action(ClearAction)
  clear(ctx: StateContext<OrderStateModel>) {
    const state = ctx.getState();
    ctx.patchState({
      ...state,
      checkout: null,
    });
  }
}
