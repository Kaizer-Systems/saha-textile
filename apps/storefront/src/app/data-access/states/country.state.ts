import { Injectable, inject } from '@angular/core';

import { Action, Selector, State, StateContext } from '@ngxs/store';
import { tap } from 'rxjs';

import { GetCountriesAction } from '@data-access/actions/country.action';
import { ICountry } from '@data-access/interfaces/country.interface';
import { CountryService } from '../services/country.service';

export class CountryStateModel {
  country = {
    data: [] as ICountry[],
  };
}

@State<CountryStateModel>({
  name: 'country',
  defaults: {
    country: {
      data: [],
    },
  },
})
@Injectable()
export class CountryState {
  private countryService = inject(CountryService);

  @Selector()
  static country(state: CountryStateModel) {
    return state.country;
  }

  @Selector()
  static countries(state: CountryStateModel) {
    return state?.country?.data?.map(cn => {
      return { label: cn?.name, value: cn?.id };
    });
  }

  @Action(GetCountriesAction)
  getCountries(ctx: StateContext<CountryStateModel>, _action: GetCountriesAction) {
    const state = ctx.getState();
    if (state?.country?.data?.length) {
      // If the country has been already loaded
      // we just break the execution
      return true;
    }
    return this.countryService.getCountries().pipe(
      tap({
        next: result => {
          ctx.patchState({
            country: {
              data: result,
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
