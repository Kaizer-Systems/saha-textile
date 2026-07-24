export interface IAuthUserStateModel {
	email: string;
	password: string;
}

export interface IAuthUserForgotModel {
	email: string;
}

export interface IVerifyEmailOtpModel {
	email: string;
	token: string;
}

export interface IUpdatePasswordModel {
	password: string;
	password_confirmation: string;
	email: string;
	token: string;
}

export interface IRegisterModal {
	name: string;
	email: string;
	phone: number;
	country_code: number;
	password: string;
	password_confirmation: string;
}
