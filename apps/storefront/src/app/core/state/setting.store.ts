import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';

import { patchState, signalStore, withHooks, withMethods, withState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap } from 'rxjs';

import { ICurrency } from '@data-access/interfaces/currency.interface';
import { IValues } from '@data-access/interfaces/setting.interface';
import { SettingService } from '@data-access/services/setting.service';

/**
 * App settings + selected currency (replaces NGXS SettingState + its
 * GetSettingOption/SelectedCurrency actions). Hybrid state moved to a SignalStore
 * in 5c-B:
 *  - `setting` is server data, (re)loaded via loadSettings() (rxMethod).
 *  - `selectedCurrency` is genuine local UI state; it defaults from the settings'
 *    default_currency and is persisted to localStorage so the currency survives
 *    the full-page reload the currency switcher triggers (NGXS persisted it via
 *    the storage plugin). SSR-guarded.
 */
type SettingStateModel = {
  setting: IValues | null;
  selectedCurrency: ICurrency | null;
};

const CURRENCY_KEY = 'selectedCurrency';

export const SettingStore = signalStore(
  { providedIn: 'root' },
  withState<SettingStateModel>({ setting: null, selectedCurrency: null }),
  withMethods(
    (store, settingService = inject(SettingService), platformId = inject(PLATFORM_ID)) => ({
      loadSettings: rxMethod<void>(
        pipe(
          switchMap(() =>
            settingService.getSettingOption().pipe(
              tap(result => {
                patchState(store, state => ({
                  setting: result.values,
                  selectedCurrency: state.selectedCurrency
                    ? state.selectedCurrency
                    : (result?.values?.general?.default_currency ?? null),
                }));
              }),
            ),
          ),
        ),
      ),
      setCurrency(currency: ICurrency): void {
        patchState(store, { selectedCurrency: currency });
        if (isPlatformBrowser(platformId)) {
          localStorage.setItem(CURRENCY_KEY, JSON.stringify(currency));
        }
      },
    }),
  ),
  withHooks({
    onInit(store) {
      // Restore the persisted currency before settings load, so it isn't
      // overwritten by the default_currency fallback.
      if (isPlatformBrowser(inject(PLATFORM_ID))) {
        const saved = localStorage.getItem(CURRENCY_KEY);
        if (saved) patchState(store, { selectedCurrency: JSON.parse(saved) });
      }
    },
  }),
);
