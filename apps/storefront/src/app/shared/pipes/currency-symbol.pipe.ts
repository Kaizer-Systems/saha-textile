import { CurrencyPipe } from '@angular/common';
import { inject, Pipe, PipeTransform } from '@angular/core';

import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { ICurrency } from '@data-access/interfaces/currency.interface';
import { IValues } from '@data-access/interfaces/setting.interface';
import { SettingState } from '@data-access/states/setting.state';

@Pipe({
  name: 'currencySymbol',
  standalone: true,
})
export class CurrencySymbolPipe implements PipeTransform {
  private currencyPipe = inject(CurrencyPipe);

  selectedCurrency$: Observable<ICurrency> = inject(Store).select(
    SettingState.selectedCurrency,
  ) as Observable<ICurrency>;

  public symbol: string = '$';
  public setting: IValues;
  public selectedCurrency: ICurrency;

  constructor() {
    this.selectedCurrency$.subscribe(currency => (this.selectedCurrency = currency));
  }

  transform(
    value: number | undefined,
    position: 'before_price' | 'after_price' | string = 'before_price',
  ): string | number {
    if (!value) {
      value = 0;
    }
    value = Number(value);
    value = value * this.selectedCurrency?.exchange_rate;

    this.symbol = this.selectedCurrency?.symbol || '$';
    position = this.selectedCurrency?.symbol_position;

    let formattedValue = this.currencyPipe.transform(value, this.symbol);
    formattedValue = formattedValue?.replace(this.symbol, '')!;

    if (position === 'before_price') {
      return `${this.symbol} ${formattedValue}`;
    } else {
      return `${formattedValue} ${this.symbol}`;
    }
  }
}
