import { Params } from '@data-access/interfaces/core.interface';

export class GetOrderStatusAction {
  static readonly type = '[Order Status] Get';
  constructor(public payload?: Params) {}
}
