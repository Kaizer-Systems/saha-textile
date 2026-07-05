import { computed, effect, inject } from '@angular/core';
import { Router } from '@angular/router';

import { getState, patchState, signalStore, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';

import { AccountStore } from '@core/state/account.store';

const STORAGE_KEY = 'auth_store';

// Demo/mock session token — a real login will replace this with the API-issued token.
const FAKE_TOKEN = '135|laravel_sanctum_BrxRCMTABu7vFDsa1CHnkKCkjKtYPcBHMguiUAha319c7ede';

interface AuthStateModel {
	email: string;
	token: string | number;
	access_token: string | null;
	permissions: [];
}

const initialState: AuthStateModel = {
	email: 'admin@example.com',
	token: '',
	access_token: FAKE_TOKEN,
	permissions: [],
};

export const AuthStore = signalStore(
	{ providedIn: 'root' },
	withState(initialState),
	withComputed((store) => ({
		isAuthenticated: computed(() => !!store.access_token()),
	})),
	withMethods((store, router = inject(Router), accountStore = inject(AccountStore)) => ({
		login(payload?: { email?: string }) {
			// Mock: a real API would return the token; here we (re)establish the demo session.
			patchState(store, { email: payload?.email ?? store.email(), access_token: FAKE_TOKEN });
		},
		logout() {
			patchState(store, { email: '', token: '', access_token: null, permissions: [] });
			accountStore.clear();
			void router.navigate(['/auth/login']);
		},
		clear() {
			patchState(store, { email: '', token: '', access_token: null, permissions: [] });
			accountStore.clear();
		},
		forgotPassword(_payload?: unknown) {
			// Forgot password has no backend yet.
		},
		verifyEmailOtp(_payload?: unknown) {
			// OTP verification has no backend yet.
		},
		updatePassword(_payload?: unknown) {
			// Update password has no backend yet.
		},
	})),
	withHooks({
		onInit(store) {
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
					const state = getState(store);
					localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
				});
			}
		},
	}),
);
