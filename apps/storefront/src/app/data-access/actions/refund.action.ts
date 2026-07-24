import { Params } from '@data-access/interfaces/core.interface';

export class GetRefundAction {
  static readonly type = '[Refund] Get';
  constructor(public payload?: Params) {}
}

export class SendRefundRequestAction {
  static readonly type = '[Refund] Post';
  constructor(public payload?: Params) {}
}
