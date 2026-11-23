import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';

import { patchState, signalStore, withHooks, withMethods, withState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap } from 'rxjs';

import { ConsentStore } from '@core/consent/consent.store';
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
interface SettingStateModel {
	setting: IValues | null;
	selectedCurrency: ICurrency | null;
}

const CURRENCY_KEY = 'selectedCurrency';

export const SettingStore = signalStore(
	{ providedIn: 'root' },
	withState<SettingStateModel>({ setting: null, selectedCurrency: null }),
	withMethods(
		(
			store,
			settingService = inject(SettingService),
			platformId = inject(PLATFORM_ID),
			consent = inject(ConsentStore),
		) => {
			const setCurrency = (currency: ICurrency): void => {
				patchState(store, { selectedCurrency: currency });
				if (isPlatformBrowser(platformId) && consent.allows('functional')) {
					localStorage.setItem(CURRENCY_KEY, JSON.stringify(currency));
				}
			};
			return {
				loadSettings: rxMethod<void>(
					pipe(
						switchMap(() =>
							settingService.getSettingOption().pipe(
								tap((result) => {
									patchState(store, (state) => ({
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
				setCurrency,
				/**
				 * The shop's currencies have arrived (`GET /currency`): a saved choice takes today's rate and
				 * symbol, and one the shop no longer sells falls back to rupees. A choice saved before the
				 * list came from the API carried the theme's demo rate, so this also replaces it.
				 */
				useCurrencies(list: readonly ICurrency[]): void {
					const current = store.selectedCurrency();
					if (!current || !list.length) return;
					const same = list.find((row) => row.code === current.code);
					// The list is not empty here, so there is always a row to take.
					const next = same ?? list.find((row) => row.code === 'INR') ?? list[0];
					if (
						next.code !== current.code ||
						Number(next.exchange_rate) !== Number(current.exchange_rate) ||
						next.symbol !== current.symbol
					)
						setCurrency(next);
				},
			};
		},
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
