import { Params } from '@data-access/interfaces/core.interface';
import { ICheckoutPayload, IRePaymentPayload } from '@data-access/interfaces/order.interface';

export class GetOrdersAction {
  static readonly type = '[Order] Get';
  constructor(public payload?: Params) {}
}

export class ViewOrderAction {
  static readonly type = '[Order] View';
  constructor(public id: number) {}
}

export class CheckoutAction {
  static readonly type = '[Order] Checkout';
  constructor(public payload: ICheckoutPayload) {}
}

export class PlaceOrderAction {
  static readonly type = '[Order] Place';
  constructor(public payload: ICheckoutPayload) {}
}

export class ClearAction {
  static readonly type = '[Order] Clear';
  constructor() {}
}

export class RePaymentAction {
  static readonly type = '[Order] Repayment';
  constructor(public payload: IRePaymentPayload) {}
}

export class VerifyPaymentAction {
  static readonly type = '[Order] Verify';
  constructor(public id: number) {}
}
