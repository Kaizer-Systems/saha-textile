import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { Select2Module } from 'ng-select2-component';

import { AuthStore } from '@core/state/auth.store';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';
import { translatedBreadcrumb } from '@shared/util/breadcrumb-i18n';
import { CustomValidators } from '@shared/validators/password-match';

import * as data from '../../../shared/data/country-code';

/** Owner lock: minimum 12 characters for storefront and admin alike. */
const PASSWORD_MIN_LENGTH = 12;

@Component({
	selector: 'app-register',
	templateUrl: './register.html',
	styleUrls: ['./register.scss'],
	imports: [Breadcrumb, ReactiveFormsModule, Select2Module, Button, RouterLink, TranslocoModule],
})
export class Register {
	private authStore = inject(AuthStore);
	private router = inject(Router);
	private formBuilder = inject(FormBuilder);
	private platformId = inject<Object>(PLATFORM_ID);

	public form: FormGroup;
	public breadcrumb = translatedBreadcrumb('sign_in');
	public codes = data.countryCodes;
	public tnc = new FormControl(false, [Validators.requiredTrue]);
	public isBrowser: boolean;

	public readonly error = this.authStore.error;
	public readonly pending = this.authStore.pending;
	public readonly passwordMinLength = PASSWORD_MIN_LENGTH;

	constructor() {
		this.isBrowser = isPlatformBrowser(this.platformId);
		this.form = this.formBuilder.group(
			{
				name: new FormControl('', [Validators.required]),
				email: new FormControl('', [Validators.required, Validators.email]),
				// Phone is collected at checkout/address time rather than registration (owner
				// lock), so these controls stay for template parity but are never sent.
				phone: new FormControl('', [Validators.pattern(/^[0-9]*$/)]),
				country_code: new FormControl('91'),
				// Mirrors the server policy so the failure is visible before a round trip.
				// The server remains the authority — this validator is convenience only.
				password: new FormControl('', [Validators.required, Validators.minLength(PASSWORD_MIN_LENGTH)]),
				password_confirmation: new FormControl('', [Validators.required]),
			},
			{ validator: CustomValidators.MatchValidator('password', 'password_confirmation') },
		);
	}

	get passwordMatchError() {
		return this.form.getError('mismatch') && this.form.get('password_confirmation')?.touched;
	}

	async submit(): Promise<void> {
		this.form.markAllAsTouched();
		if (this.tnc.invalid || !this.form.valid || this.pending()) return;

		const registered = await this.authStore.register({
			email: this.form.value.email as string,
			password: this.form.value.password as string,
			displayName: (this.form.value.name as string) || undefined,
		});
		// Navigate only on a real 201; the previous version routed to the dashboard
		// unconditionally, so a rejected registration still looked successful. The account
		// also starts unverified — the API mails a verification token at registration.
		if (!registered) return;

		await this.router.navigateByUrl('/account/dashboard');
	}
}
