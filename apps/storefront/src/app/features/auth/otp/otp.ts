import { Component, inject, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { AuthStore } from '@core/state/auth.store';
import { AuthService } from '@data-access/services/auth.service';
import { Alert } from '@shared/ui/alert/alert';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';
import { translatedBreadcrumb } from '@shared/util/breadcrumb-i18n';

/** Owner lock: six-digit CSPRNG code, 10-minute expiry, five attempts. */
const OTP_CODE_LENGTH = 6;

/**
 * Email OTP **login** — a canonical launch method, not a step in password recovery.
 *
 * The template placed this screen between "forgot password" and "update password", which
 * conflated two different mechanisms: recovery uses a single-use emailed token, while an
 * OTP challenge is purpose-bound (`login`) with its own expiry and attempt cap. The API
 * models them separately and this screen now matches, calling
 * `/auth/storefront/login/email-otp/request` and `.../verify`.
 *
 * The code is generated and verified by us; the notification provider only delivers it.
 * Locally that provider is the console adapter, which logs a hashed destination and
 * withholds the payload — so no code is transmitted or written to a log.
 */
@Component({
	selector: 'app-otp',
	templateUrl: './otp.html',
	styleUrls: ['./otp.scss'],
	imports: [Breadcrumb, Alert, ReactiveFormsModule, Button, TranslocoModule],
})
export class Otp {
	router = inject(Router);
	private authStore = inject(AuthStore);
	private authService = inject(AuthService);
	formBuilder = inject(FormBuilder);

	public form: FormGroup;
	public breadcrumb = translatedBreadcrumb('otp');

	/** `request` collects the address; `verify` collects the code the API just mailed. */
	public readonly step = signal<'request' | 'verify'>('request');
	public readonly sentTo = signal('');
	public readonly error = this.authStore.error;
	public readonly pending = this.authStore.pending;
	public readonly codeLength = OTP_CODE_LENGTH;

	constructor() {
		this.form = this.formBuilder.group({
			email: new FormControl('', [Validators.required, Validators.email]),
			code: new FormControl('', [
				Validators.minLength(OTP_CODE_LENGTH),
				Validators.maxLength(OTP_CODE_LENGTH),
				Validators.pattern(/^\d*$/),
			]),
		});
	}

	async requestCode(): Promise<void> {
		this.form.controls['email'].markAsTouched();
		if (this.form.controls['email'].invalid || this.pending()) return;

		const address = this.form.value.email as string;
		await this.authStore.requestEmailOtp(address, 'login');
		// Always advance. The API accepts the request identically for a registered and an
		// unregistered address, so stopping here for unknown ones would disclose which is
		// which; a caller who is not registered simply never receives a code.
		this.sentTo.set(address);
		this.step.set('verify');
	}

	async submit(): Promise<void> {
		if (this.step() === 'request') {
			await this.requestCode();
			return;
		}

		this.form.controls['code'].markAsTouched();
		const code = (this.form.value.code as string) ?? '';
		if (code.length !== OTP_CODE_LENGTH || this.pending()) return;

		const signedIn = await this.authStore.verifyEmailOtp({ email: this.sentTo(), code });
		if (!signedIn) return;

		const redirectUrl = this.authService.redirectUrl || '/account/dashboard';
		this.authService.redirectUrl = undefined;
		await this.router.navigateByUrl(redirectUrl);
	}
}
