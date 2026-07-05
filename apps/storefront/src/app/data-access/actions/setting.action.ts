import { ICurrency } from '@data-access/interfaces/currency.interface';

export class GetSettingOptionAction {
  static readonly type = '[Setting] Get';
}

export class SelectedCurrencyAction {
  static readonly type = '[Setting] SetCurrency';
  constructor(public payload: ICurrency) {}
}
