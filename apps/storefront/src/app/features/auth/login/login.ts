import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { Select2Module } from 'ng-select2-component';

import { ResendCountdown } from '@core/auth/resend-countdown';
import { AuthStore } from '@core/state/auth.store';
import { AuthService } from '@data-access/services/auth.service';
import { Alert } from '@shared/ui/alert/alert';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';
import { SocialSignIn } from '@shared/ui/social-sign-in/social-sign-in';
import { translatedBreadcrumb } from '@shared/util/breadcrumb-i18n';

import * as data from '../../../shared/data/country-code';

/** Owner lock: six-digit CSPRNG code, 10-minute expiry, five attempts. */
const OTP_CODE_LENGTH = 6;

/** Which credential the person is signing in WITH. */
type Channel = 'email' | 'phone';
/** Which proof they are offering. `code` is a two-step view; `password` is one step. */
type Method = 'password' | 'code';

/**
 * Storefront sign-in.
 *
 * ## Phone is a credential, not a profile field
 *
 * `DEC-SIGNUP-VERIFICATION` proves BOTH identifiers before an account exists, so either one
 * can open the door. The channel toggle picks which is sent; the API resolves whichever column
 * the value is shaped like. It never queries both — typing a phone number into the email box
 * would otherwise reveal that the number is registered.
 *
 * ## One refusal for every failure
 *
 * Wrong password, unknown identifier, inactive account and operator-only address all answer
 * the same, and the screen shows a single fixed message. Rendering the API's per-case reason
 * would hand back exactly the signal the API is being careful not to give.
 *
 * ## The one-time code is a login method
 *
 * Not a recovery step. The challenge is purpose-bound (`login`) with its own expiry and attempt
 * cap, and it travels by email or SMS according to the identifier — so somebody who typed a
 * phone number is never told an address exists on the account.
 */
@Component({
	selector: 'app-login',
	templateUrl: './login.html',
	styleUrls: ['./login.scss'],
	imports: [Breadcrumb, Alert, ReactiveFormsModule, RouterLink, Button, TranslocoModule, SocialSignIn, Select2Module],
})
export class Login {
	private authStore = inject(AuthStore);
	private router = inject(Router);
	private formBuilder = inject(FormBuilder);
	private authService = inject(AuthService);

	public form: FormGroup;
	public breadcrumb = translatedBreadcrumb('log_in');
	public codes = data.countryCodes;

	/** Bound by the template so a failed sign-in is visible instead of silent. */
	public readonly error = this.authStore.error;
	public readonly pending = this.authStore.pending;
	public readonly codeLength = OTP_CODE_LENGTH;

	public readonly channel = signal<Channel>('email');
	public readonly method = signal<Method>('password');

	/**
	 * "Remember me" — asked once, and it governs BOTH proofs.
	 *
	 * It lives outside the form group because it belongs to the sign-in rather than to the
	 * credential: switching between password and one-time code must not silently discard the
	 * answer. The API turns it into a dated cookie plus the long idle TTL, or a session cookie
	 * plus a short one; this screen only carries the intent.
	 */
	public readonly rememberMe = new FormControl(false);
	/** Only meaningful while `method() === 'code'`: has a code been sent yet. */
	public readonly codeSent = signal(false);

	/**
	 * How long until another code may be requested.
	 *
	 * A code is sent the moment this view opens, so the resend starts disabled rather than
	 * inviting a second send that the server would refuse anyway.
	 */
	public readonly resend = new ResendCountdown();

	/** What the API is asked about — an address, or a phone in E.164. */
	public readonly identifier = computed(() => {
		if (this.channel() === 'email') return String(this.form?.value.email ?? '').trim();
		const dial = String(this.form?.value.country_code ?? '91');
		return `+${dial}${String(this.form?.value.phone ?? '').trim()}`;
	});

	constructor() {
		// Empty, not pre-filled. The demo pair that used to sit here made the form look
		// like a working login while the store faked the session; worse, a copied demo
		// credential is exactly the kind of thing that survives into a deployed build.
		this.form = this.formBuilder.group({
			email: new FormControl('', [Validators.required, Validators.email]),
			phone: new FormControl('', [Validators.pattern(/^[0-9]*$/)]),
			country_code: new FormControl('91'),
			password: new FormControl('', [Validators.required]),
			code: new FormControl('', [
				Validators.minLength(OTP_CODE_LENGTH),
				Validators.maxLength(OTP_CODE_LENGTH),
				Validators.pattern(/^\d*$/),
			]),
		});
		this.applyChannelValidators('email');
	}

	/** The control the current channel actually uses, for touch/validity checks. */
	private get identifierControl() {
		return this.form.controls[this.channel() === 'email' ? 'email' : 'phone'];
	}

	/**
	 * Only the ACTIVE identifier is required.
	 *
	 * Angular validates every control regardless of what is rendered, so leaving both required
	 * would make the form permanently invalid the moment one is hidden.
	 */
	private applyChannelValidators(channel: Channel): void {
		const email = this.form.controls['email'];
		const phone = this.form.controls['phone'];

		email.setValidators(channel === 'email' ? [Validators.required, Validators.email] : []);
		phone.setValidators(channel === 'phone' ? [Validators.required, Validators.pattern(/^[0-9]*$/)] : []);
		email.updateValueAndValidity();
		phone.updateValueAndValidity();
	}

	selectChannel(channel: Channel): void {
		if (this.channel() === channel) return;
		this.channel.set(channel);
		this.applyChannelValidators(channel);
		// A code was sent to the OTHER identifier, so it cannot verify this one.
		this.resetCode();
	}

	selectMethod(method: Method): void {
		if (this.method() === method) return;
		this.method.set(method);
		this.resetCode();
	}

	/** Drops a half-finished challenge whenever the thing it was bound to changes. */
	private resetCode(): void {
		this.codeSent.set(false);
		this.resend.reset();
		this.form.controls['code'].reset('');
	}

	/** Sends a one-time code, then always advances. */
	async requestCode(): Promise<void> {
		this.identifierControl.markAsTouched();
		if (this.identifierControl.invalid || this.pending()) return;

		await this.authStore.requestLoginOtp(this.identifier(), 'login');
		// Advance unconditionally. The API accepts the request identically for a registered and
		// an unregistered identifier, so stopping here for unknown ones would disclose which is
		// which; somebody who is not registered simply never receives a code.
		this.codeSent.set(true);
		// No server timestamp on purpose — see `ResendCountdown` for why this path cannot have one.
		this.resend.start();
	}

	async submit(): Promise<void> {
		if (this.method() === 'code') {
			await (this.codeSent() ? this.submitCode() : this.requestCode());
			return;
		}
		await this.submitPassword();
	}

	private async submitPassword(): Promise<void> {
		this.identifierControl.markAsTouched();
		this.form.controls['password'].markAsTouched();
		if (this.identifierControl.invalid || this.form.controls['password'].invalid || this.pending()) return;

		const signedIn = await this.authStore.loginWithPassword({
			identifier: this.identifier(),
			password: this.form.value.password as string,
			rememberMe: this.rememberMe.value === true,
		});
		// Navigate only after the API confirms the session. The previous version routed to
		// the account dashboard immediately, so a rejected login still looked successful.
		if (!signedIn) return;
		await this.goToDestination();
	}

	private async submitCode(): Promise<void> {
		this.form.controls['code'].markAsTouched();
		const code = (this.form.value.code as string) ?? '';
		if (code.length !== OTP_CODE_LENGTH || this.pending()) return;

		const signedIn = await this.authStore.verifyLoginOtp({
			identifier: this.identifier(),
			code,
			rememberMe: this.rememberMe.value === true,
		});
		if (!signedIn) return;
		await this.goToDestination();
	}

	/** Honours wherever the guard interrupted them, defaulting to the account dashboard. */
	private async goToDestination(): Promise<void> {
		const redirectUrl = this.authService.redirectUrl || '/account/dashboard';
		this.authService.redirectUrl = undefined;
		await this.router.navigateByUrl(redirectUrl);
	}
}
