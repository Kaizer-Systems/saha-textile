import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbTooltip } from '@ng-bootstrap/ng-bootstrap';
import { Select2Module } from 'ng-select2-component';
import { firstValueFrom } from 'rxjs';

import { StorefrontAuthGateway, type PendingSignupView } from '@core/auth/auth-gateway';
import { refusalCode } from '@core/auth/refusal-code';
import { AuthStore } from '@core/state/auth.store';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';
import { SocialSignIn } from '@shared/ui/social-sign-in/social-sign-in';
import { translatedBreadcrumb } from '@shared/util/breadcrumb-i18n';
import { CustomValidators } from '@shared/validators/password-match';

import * as data from '../../../shared/data/country-code';

/** Owner lock: minimum 12 characters for storefront and admin alike. */
const PASSWORD_MIN_LENGTH = 12;

/**
 * Verified-before-creation registration (`DEC-SIGNUP-VERIFICATION`).
 *
 * ## What this screen does and does not know
 *
 * It RENDERS the server's view of the signup and never asserts one. `pending()` is what the
 * API says has been proven; the form's own controls are only what the person has typed. That
 * split is the security property in UI form — a screen that could claim "verified" would be a
 * screen that could claim somebody else's address.
 *
 * No account exists until both identifiers are proven, so "submit" is the LAST step rather
 * than the only one, and it sends no email or phone at all.
 */
@Component({
	selector: 'app-register',
	templateUrl: './register.html',
	styleUrls: ['./register.scss'],
	imports: [
		Breadcrumb,
		ReactiveFormsModule,
		Select2Module,
		Button,
		RouterLink,
		TranslocoModule,
		NgbTooltip,
		SocialSignIn,
	],
})
export class Register {
	private authStore = inject(AuthStore);
	private gateway = inject(StorefrontAuthGateway);
	private router = inject(Router);
	private formBuilder = inject(FormBuilder);
	private platformId = inject<Object>(PLATFORM_ID);

	public form: FormGroup;
	public breadcrumb = translatedBreadcrumb('sign_in');
	public codes = data.countryCodes;
	public tnc = new FormControl(false, [Validators.requiredTrue]);
	public marketingOptIn = new FormControl(false);
	public isBrowser: boolean;

	public readonly error = this.authStore.error;
	public readonly pending = this.authStore.pending;
	public readonly passwordMinLength = PASSWORD_MIN_LENGTH;

	/** The server's answer, or null before a signup has been started. */
	public readonly signup = signal<PendingSignupView | null>(null);
	/** Which field is mid-request, so only that control shows a busy state. */
	public readonly busyField = signal<'email' | 'phone' | null>(null);
	/** Stable refusal code from the API, rendered as a translated message. */
	public readonly refusal = signal<string | null>(null);
	/** Set when a verified identifier turned out to already have an account. */
	public readonly existingAccount = signal(false);

	public readonly emailState = computed(() => this.signup()?.email ?? null);
	public readonly phoneState = computed(() => this.signup()?.phone ?? null);
	public readonly canSubmit = computed(() => this.signup()?.complete === true);

	constructor() {
		this.isBrowser = isPlatformBrowser(this.platformId);
		this.form = this.formBuilder.group(
			{
				name: new FormControl('', [Validators.required]),
				email: new FormControl('', [Validators.required, Validators.email]),
				// Phone is now collected AND verified at registration — the earlier
				// collect-at-checkout lock was superseded by `DEC-SIGNUP-VERIFICATION`, because
				// every account carrying two proven channels is what makes recovery robust and
				// disconnecting a social login safe.
				phone: new FormControl('', [Validators.required, Validators.pattern(/^[0-9]*$/)]),
				country_code: new FormControl('91'),
				// Mirrors the server policy so the failure is visible before a round trip. The
				// server remains the authority — this validator is convenience only.
				password: new FormControl('', [Validators.required, Validators.minLength(PASSWORD_MIN_LENGTH)]),
				password_confirmation: new FormControl('', [Validators.required]),
			},
			{ validator: CustomValidators.MatchValidator('password', 'password_confirmation') },
		);
	}

	get passwordMatchError() {
		return this.form.getError('mismatch') && this.form.get('password_confirmation')?.touched;
	}

	/** E.164 for the API; the picker holds the dial code separately from the digits. */
	private phoneValue(): string {
		return `+${String(this.form.value.country_code ?? '91')}${String(this.form.value.phone ?? '')}`;
	}

	/**
	 * Starts or resumes the signup, then sends a code for one field.
	 *
	 * Starting is idempotent per browser: the server keys the pending record on a cookie, so a
	 * second tab continues the same signup rather than racing it.
	 */
	async verify(field: 'email' | 'phone'): Promise<void> {
		const control = this.form.get(field);
		control?.markAsTouched();
		if (control?.invalid || this.busyField()) return;

		this.busyField.set(field);
		this.refusal.set(null);
		try {
			if (!this.signup()) {
				this.signup.set(
					await firstValueFrom(
						this.gateway.startSignup({
							email: String(this.form.value.email ?? ''),
							phone: this.phoneValue(),
							displayName: String(this.form.value.name ?? '') || undefined,
							marketingOptIn: this.marketingOptIn.value === true,
						}),
					),
				);
			} else {
				// Editing clears that field's proof server-side, which is why the value is sent
				// before the code rather than alongside it.
				const value = field === 'email' ? String(this.form.value.email ?? '') : this.phoneValue();
				this.signup.set(await firstValueFrom(this.gateway.updateSignupField(field, value)));
			}
			this.signup.set(await firstValueFrom(this.gateway.requestSignupOtp(field)));
		} catch (error) {
			this.refusal.set(refusalCode(error, 'registration_failed'));
		} finally {
			this.busyField.set(null);
		}
	}

	/**
	 * Submits a code for one field.
	 *
	 * A successful verification may reveal that the identifier already belongs to an account —
	 * safe to say only because the person just proved they control it. The screen offers sign-in
	 * rather than letting them finish the form and be refused at the end.
	 */
	async submitCode(field: 'email' | 'phone', code: string): Promise<void> {
		if (this.busyField()) return;
		this.busyField.set(field);
		this.refusal.set(null);
		try {
			const result = await firstValueFrom(this.gateway.verifySignupOtp(field, code));
			this.signup.set(result.state);
			if (result.existingAccount) {
				this.existingAccount.set(true);
				// A disabled or locked account is not enterable even by its owner, so the screen
				// must not offer a sign-in that would be refused.
				this.refusal.set(result.accountUsable ? 'signup_identifier_taken' : 'account_not_accessible');
			}
		} catch (error) {
			this.refusal.set(refusalCode(error, 'registration_failed'));
		} finally {
			this.busyField.set(null);
		}
	}

	/**
	 * Creates the account.
	 *
	 * Sends only the password. Every identifier comes from what the server verified, so there is
	 * nothing here for a tampered form to substitute at the moment an account is minted.
	 */
	async submit(): Promise<void> {
		this.form.markAllAsTouched();
		if (this.tnc.invalid || !this.canSubmit() || this.pending()) return;

		this.refusal.set(null);
		const created = await this.authStore.finaliseSignup(String(this.form.value.password ?? ''));
		if (!created) return;

		await this.router.navigateByUrl('/account/dashboard');
	}
}
