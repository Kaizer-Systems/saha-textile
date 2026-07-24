import { Injectable, inject } from '@angular/core';

import { Action, Selector, State, StateContext } from '@ngxs/store';
import { tap } from 'rxjs';

import { GetCurrenciesAction } from '@data-access/actions/currency.action';
import { ICurrency } from '@data-access/interfaces/currency.interface';
import { CurrencyService } from '../services/currency.service';

export class CurrencyStateModel {
  currency = {
    data: [] as ICurrency[],
    total: 0,
  };
}

@State<CurrencyStateModel>({
  name: 'currency',
  defaults: {
    currency: {
      data: [],
      total: 0,
    },
  },
})
@Injectable()
export class CurrencyState {
  private currencyService = inject(CurrencyService);

  @Selector()
  static currency(state: CurrencyStateModel) {
    return state.currency;
  }

  @Action(GetCurrenciesAction)
  getCurrencies(ctx: StateContext<CurrencyStateModel>, action: GetCurrenciesAction) {
    return this.currencyService.getCurrencies(action.payload).pipe(
      tap({
        next: result => {
          ctx.patchState({
            currency: {
              data: result.data,
              total: result?.total ? result?.total : result.data ? result.data.length : 0,
            },
          });
        },
        error: err => {
          throw new Error(err?.error?.message);
        },
      }),
    );
  }
}
