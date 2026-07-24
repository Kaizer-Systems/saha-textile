import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';

import { Store, State, Selector, Action, StateContext } from '@ngxs/store';

import { AccountClearAction, GetUserDetailsAction } from '@data-access/actions/account.action';
import {
  RegisterAction,
  LoginAction,
  ForgotPassWordAction,
  VerifyEmailOtpAction,
  UpdatePasswordAction,
  LogoutAction,
  AuthClearAction,
} from '@data-access/actions/auth.action';
import { NotificationService } from '../services/notification.service';

export interface AuthStateModel {
  email: String;
  token: String | Number;
  access_token: String | null;
}

@State<AuthStateModel>({
  name: 'auth',
  defaults: {
    email: '',
    token: '',
    access_token: '',
  },
})
@Injectable()
export class AuthState {
  private store = inject(Store);
  router = inject(Router);
  private notificationService = inject(NotificationService);

  ngxsOnInit(ctx: StateContext<AuthStateModel>) {
    // Pre Fake Login (if you are using ap
    ctx.patchState({
      email: 'john.customer@example.com',
      token: '',
      access_token: '115|laravel_sanctum_mp1jyyMyKeE4qVsD1bKrnSycnmInkFXXIrxKv49w49d2a2c5',
    });
  }

  @Selector()
  static accessToken(state: AuthStateModel): String | null {
    return state.access_token;
  }

  @Selector()
  static isAuthenticated(state: AuthStateModel): Boolean {
    return !!state.access_token;
  }

  @Selector()
  static email(state: AuthStateModel): String {
    return state.email;
  }

  @Selector()
  static token(state: AuthStateModel): String | Number {
    return state.token;
  }

  @Action(RegisterAction)
  register(_ctx: StateContext<AuthStateModel>, _action: RegisterAction) {
    // Register Logic Here
  }

  @Action(LoginAction)
  login(_ctx: StateContext<AuthStateModel>, _action: LoginAction) {
    // Login Logic Here
    this.store.dispatch(new GetUserDetailsAction());
  }

  @Action(ForgotPassWordAction)
  forgotPassword(_ctx: StateContext<AuthStateModel>, _action: ForgotPassWordAction) {
    // Forgot Password Logic Here
  }

  @Action(VerifyEmailOtpAction)
  verifyEmail(_ctx: StateContext<AuthStateModel>, _action: VerifyEmailOtpAction) {
    // Verify Logic Here
  }

  @Action(UpdatePasswordAction)
  updatePassword(_ctx: StateContext<AuthStateModel>, _action: UpdatePasswordAction) {
    // Update Password Logic Here
  }

  @Action(LogoutAction)
  logout(_ctx: StateContext<AuthStateModel>) {
    // Logout LOgic Here
  }

  @Action(AuthClearAction)
  authClear(ctx: StateContext<AuthStateModel>) {
    ctx.patchState({
      email: '',
      token: '',
      access_token: null,
    });
    this.store.dispatch(new AccountClearAction());
  }
}
