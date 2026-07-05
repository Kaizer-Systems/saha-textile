import { Params } from '@data-access/interfaces/core.interface';

export class GetCouponsAction {
  static readonly type = '[Coupon] Get';
  constructor(public payload?: Params) {}
}
