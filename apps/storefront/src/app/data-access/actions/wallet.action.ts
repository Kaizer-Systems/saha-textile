import { Params } from '@data-access/interfaces/core.interface';

export class GetUserTransactionAction {
  static readonly type = '[Wallet] Transaction Get';
  constructor(public payload?: Params) {}
}
