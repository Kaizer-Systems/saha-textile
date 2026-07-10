import { CurrencyPipe } from '@angular/common';
import { inject, Pipe, PipeTransform } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { Observable } from 'rxjs';

import { ICurrency } from '@data-access/interfaces/currency.interface';
import { IValues } from '@data-access/interfaces/setting.interface';
import { SettingStore } from '@core/state/setting.store';

@Pipe({
  name: 'currencySymbol',
  standalone: true,
})
export class CurrencySymbolPipe implements PipeTransform {
  private currencyPipe = inject(CurrencyPipe);
  private settingStore = inject(SettingStore);

  selectedCurrency$: Observable<ICurrency> = toObservable(
    this.settingStore.selectedCurrency,
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
