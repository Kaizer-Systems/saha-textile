import { AsyncPipe, isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, computed, inject, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { Observable } from 'rxjs';

import { injectCurrenciesQuery } from '@data-access/queries/currency.queries';
import { ICurrency, ICurrencyModel } from '@data-access/interfaces/currency.interface';
import { IValues } from '@data-access/interfaces/setting.interface';
import { SettingStore } from '@core/state/setting.store';
import { ClickOutsideDirective } from '@shared/directives/out-side-directive';
import { Button } from '@shared/ui/button/button';

@Component({
  selector: 'app-currency',
  templateUrl: './currency.html',
  styleUrls: ['./currency.scss'],
  imports: [ClickOutsideDirective, Button, AsyncPipe],
})
export class Currency {
  private platformId = inject<Object>(PLATFORM_ID);
  private settingStore = inject(SettingStore);

  setting$: Observable<IValues> = toObservable(this.settingStore.setting) as Observable<IValues>;
  selectedCurrency$: Observable<ICurrency> = toObservable(
    this.settingStore.selectedCurrency,
  ) as Observable<ICurrency>;

  public open: boolean = false;
  public selectedCurrency: ICurrency;
  public setting: IValues;

  readonly style = input<string>('basic');

  private readonly currenciesQuery = injectCurrenciesQuery(() => ({ status: 1 }));
  currency$: Observable<ICurrencyModel> = toObservable(
    computed(() => this.currenciesQuery.data() ?? { data: [], total: 0 }),
  );

  constructor() {
    this.selectedCurrency$.subscribe(setting => (this.selectedCurrency = setting));
  }

  openDropDown() {
    this.open = !this.open;
  }

  selectCurrency(currency: ICurrency) {
    this.selectedCurrency = currency;
    this.open = false;
    // Persisted to localStorage inside the store so it survives the reload.
    this.settingStore.setCurrency(currency);
    if (isPlatformBrowser(this.platformId)) {
      window.location.reload();
    }
  }

  hideDropdown() {
    this.open = false;
  }
}
