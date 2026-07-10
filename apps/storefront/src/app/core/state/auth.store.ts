import { computed, inject } from '@angular/core';
import { Router } from '@angular/router';

import { patchState, signalStore, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';

import {
  IAuthUserForgotModel,
  IAuthUserStateModel,
  IRegisterModal,
  IUpdatePasswordModel,
  IVerifyEmailOtpModel,
} from '@data-access/interfaces/auth.interface';
import { AccountStore } from './account.store';

/**
 * Auth/session token (replaces NGXS AuthState + its actions). Most actions were
 * no-op stubs (no backend) and stay as hook points. The mock keeps a fake
 * pre-login token set in onInit (was ngxsOnInit) so requests carry a Bearer
 * header and the app renders as logged-in. login()/authClear() drive AccountStore
 * (were chain-dispatches). Real cookie-based auth lands with the API phase.
 */
type AuthStateModel = {
  email: string;
  token: string | number;
  access_token: string | null;
};

const FAKE_ACCESS_TOKEN =
  '115|laravel_sanctum_mp1jyyMyKeE4qVsD1bKrnSycnmInkFXXIrxKv49w49d2a2c5';

export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState<AuthStateModel>({ email: '', token: '', access_token: '' }),
  withComputed(store => ({
    isAuthenticated: computed(() => !!store.access_token()),
  })),
  withMethods((store, accountStore = inject(AccountStore), router = inject(Router)) => ({
    login(_payload: IAuthUserStateModel): void {
      accountStore.loadUser();
    },
    authClear(): void {
      patchState(store, { email: '', token: '', access_token: null });
      accountStore.clear();
    },
    // Logout was a no-op NGXS reducer; the navigation lived in app.ts's
    // ofActionDispatched(LogoutAction) listener — centralised here so callers
    // just invoke logout(). Token is intentionally left as-is (mock parity).
    logout(): void {
      void router.navigate(['/auth/login']);
    },
    // No-op hook points (were empty NGXS reducers — backend wiring comes later).
    register(_payload: IRegisterModal): void {},
    forgotPassword(_payload: IAuthUserForgotModel): void {},
    verifyEmail(_payload: IVerifyEmailOtpModel): void {},
    updatePassword(_payload: IUpdatePasswordModel): void {},
  })),
  withHooks({
    onInit(store) {
      patchState(store, {
        email: 'john.customer@example.com',
        token: '',
        access_token: FAKE_ACCESS_TOKEN,
      });
    },
  }),
);
