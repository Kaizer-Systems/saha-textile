import { AsyncPipe, isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject, input } from '@angular/core';

import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { SelectedCurrencyAction } from '@data-access/actions/setting.action';
import { ICurrency, ICurrencyModel } from '@data-access/interfaces/currency.interface';
import { IValues } from '@data-access/interfaces/setting.interface';
import { CurrencyState } from '@data-access/states/currency.state';
import { SettingState } from '@data-access/states/setting.state';
import { ClickOutsideDirective } from '@shared/directives/out-side-directive';
import { Button } from '@shared/ui/button/button';

@Component({
  selector: 'app-currency',
  templateUrl: './currency.html',
  styleUrls: ['./currency.scss'],
  imports: [ClickOutsideDirective, Button, AsyncPipe],
})
export class Currency {
  private store = inject(Store);
  private platformId = inject<Object>(PLATFORM_ID);

  setting$: Observable<IValues> = inject(Store).select(SettingState.setting) as Observable<IValues>;
  selectedCurrency$: Observable<ICurrency> = inject(Store).select(
    SettingState.selectedCurrency,
  ) as Observable<ICurrency>;

  public open: boolean = false;
  public selectedCurrency: ICurrency;
  public setting: IValues;

  readonly style = input<string>('basic');

  currency$: Observable<ICurrencyModel> = inject(Store).select(
    CurrencyState.currency,
  ) as Observable<ICurrencyModel>;

  constructor() {
    this.selectedCurrency$.subscribe(setting => (this.selectedCurrency = setting));
  }

  openDropDown() {
    this.open = !this.open;
  }

  selectCurrency(currency: ICurrency) {
    this.selectedCurrency = currency;
    this.open = false;
    this.store.dispatch(new SelectedCurrencyAction(currency)).subscribe({
      complete: () => {
        if (isPlatformBrowser(this.platformId)) {
          window.location.reload();
        }
      },
    });
  }

  hideDropdown() {
    this.open = false;
  }
}
