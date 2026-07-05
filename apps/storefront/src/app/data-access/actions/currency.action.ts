import { Params } from '@data-access/interfaces/core.interface';

export class GetCurrenciesAction {
  static readonly type = '[Currency] Get';
  constructor(public payload?: Params) {}
}
