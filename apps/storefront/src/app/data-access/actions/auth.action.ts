import {
  IAuthUserForgotModel,
  IAuthUserStateModel,
  IRegisterModal,
  IUpdatePasswordModel,
  IVerifyEmailOtpModel,
} from '@data-access/interfaces/auth.interface';

export class RegisterAction {
  static readonly type = '[Auth] Register';
  constructor(public payload: IRegisterModal) {}
}

export class LoginAction {
  static readonly type = '[Auth] Login';
  constructor(public payload: IAuthUserStateModel) {}
}

export class ForgotPassWordAction {
  static readonly type = '[Auth] Forgot';
  constructor(public payload: IAuthUserForgotModel) {}
}

export class VerifyEmailOtpAction {
  static readonly type = '[Auth] VerifyEmailOtp';
  constructor(public payload: IVerifyEmailOtpModel) {}
}

export class UpdatePasswordAction {
  static readonly type = '[Auth] UpdatePassword';
  constructor(public payload: IUpdatePasswordModel) {}
}

export class LogoutAction {
  static readonly type = '[Auth] Logout';
}

export class AuthClearAction {
  static readonly type = '[Auth] Clear';
}
