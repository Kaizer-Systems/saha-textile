import { Routes } from '@angular/router';

import { ForgotPassword } from './forgot-password/forgot-password';
import { Login } from './login/login';
import { Otp } from './otp/otp';
import { UpdatePassword } from './update-password/update-password';

export default [
	{
		path: 'login',
		component: Login,
	},
	{
		path: 'forgot-password',
		component: ForgotPassword,
	},
	{
		path: 'otp',
		component: Otp,
	},
	{
		path: 'update-password',
		component: UpdatePassword,
	},
] as Routes;
