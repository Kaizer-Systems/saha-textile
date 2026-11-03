import { Routes } from '@angular/router';

import { AcceptInvite } from './accept-invite/accept-invite';
import { ForgotPassword } from './forgot-password/forgot-password';
import { Login } from './login/login';
import { Otp } from './otp/otp';
import { UpdatePassword } from './update-password/update-password';

/**
 * Admin authentication routes.
 *
 * Three distinct things live here, and keeping them distinct is the whole design:
 *
 * 1. **Login** — the only launch methods are email-or-username plus password, the same
 *    identifier plus a configured six-digit PIN, and PIN quick-resume for an already-open
 *    session. No social login, no self-registration, no OTP login.
 * 2. **Recovery** — `forgot-password` → `otp` → `update-password`. This chain issues and
 *    redeems a single-use, short-lived, hash-only token delivered by email. It never mints
 *    a session and never verifies a credential in the browser.
 *
 * 3. **Onboarding** — `accept-invite` redeems a single-use invitation token from the
 *    `admin_invite` email and creates the account. It never mints a session: the new
 *    operator signs in afterwards with the credential they just set.
 *
 * The `otp` path is retained for its URL only. Its screen is the recovery-token step, not
 * an OTP verification: admin OTP login is `DO NOT BUILD AS LOGIN` under the owner lock, and
 * that component deliberately does not inject `AuthStore`, so it has no way to reach a
 * login or session method even by mistake.
 */
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
	{
		path: 'accept-invite',
		component: AcceptInvite,
	},
] as Routes;
