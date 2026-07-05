export interface IAuthUserStateModel {
	email: string;
	password: string;
}

export interface IAuthUserForgotModel {
	email: string;
}

export interface IVerifyEmailOtpModel {
	email: string;
	token: number;
}

export interface IUpdatePasswordModel {
	password: string;
	password_confirmation: string;
	email: string;
	token: number;
}
