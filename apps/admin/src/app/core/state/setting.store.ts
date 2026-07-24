import { effect, inject } from '@angular/core';

import { getState, patchState, signalStore, withHooks, withMethods, withState } from '@ngrx/signals';
import { Observable, tap } from 'rxjs';

import { ISetting, IValues } from '@data-access/interfaces/setting.interface';
import { SettingService } from '@data-access/services/setting.service';

const STORAGE_KEY = 'setting_store';

interface SettingStateModel {
	setting: IValues | null;
}

const initialState: SettingStateModel = { setting: null };

export const SettingStore = signalStore(
	{ providedIn: 'root' },
	withState(initialState),
	withMethods((store, settingService = inject(SettingService)) => ({
		loadSetting(): Observable<ISetting> {
			return settingService
				.getSettingOption()
				.pipe(tap((result) => patchState(store, { setting: result.values })));
		},
		update(_payload?: unknown) {
			// Update setting has no backend yet.
		},
	})),
	withHooks({
		onInit(store) {
			// Persist the app-wide settings (logo/title/mode/direction) so they render instantly on reload
			// instead of flashing until the fetch completes — this is what the NGXS 'setting' storage key did.
			if (typeof localStorage !== 'undefined') {
				const raw = localStorage.getItem(STORAGE_KEY);
				if (raw) {
					try {
						patchState(store, JSON.parse(raw));
					} catch {
						// ignore malformed persisted state
					}
				}
				effect(() => {
					localStorage.setItem(STORAGE_KEY, JSON.stringify(getState(store)));
				});
			}
		},
	}),
);
