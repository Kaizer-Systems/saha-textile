import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { Select2Module } from 'ng-select2-component';

import { AuthStore } from '@core/state/auth.store';
import { Alert } from '@shared/ui/alert/alert';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';
import { translatedBreadcrumb } from '@shared/util/breadcrumb-i18n';

import * as data from '../../../shared/data/country-code';

/** Which identifier the person is offering. */
type Channel = 'email' | 'phone';

/**
 * Password recovery request.
 *
 * The template this screen came from advanced to an OTP page next. That flow does not exist
 * here: recovery is a single-use, short-lived, hash-only **token delivered by email** and
 * redeemed at `/auth/update-password`, while OTP is a separate login method with its own
 * purpose-bound challenge. Keeping those purposes apart is exactly what the auth architecture
 * requires, so this screen no longer navigates onward — it acknowledges and stops.
 *
 * ## Phone is accepted, and delivery still goes to email
 *
 * Phone is a login credential (`DEC-SIGNUP-VERIFICATION`), and this store is phone-first — so a
 * customer who has forgotten their password may well not remember which address they signed up
 * with. Refusing to accept a number here would strand exactly that person at an email-only box.
 *
 * The identifier only LOOKS THE ACCOUNT UP. The token is sent to the address recorded on that
 * account, never to whatever was typed, so recovery can never be steered somewhere the account
 * does not already own. It is not carried by SMS: a single-use 64-character token is the wrong
 * thing to read off a text message, and somebody who has their phone has a better route anyway
 * — signing in with a one-time code and setting a new password from the account security
 * screen. That alternative is offered on this page rather than left to be discovered.
 *
 * The acknowledgement is unconditional on purpose. The API answers identically for known and
 * unknown identifiers; routing or wording differently here would rebuild the account
 * enumeration oracle that the generic response exists to remove.
 */
@Component({
	selector: 'app-forgot-password',
	templateUrl: './forgot-password.html',
	styleUrls: ['./forgot-password.scss'],
	imports: [Breadcrumb, Alert, ReactiveFormsModule, Button, TranslocoModule, Select2Module, RouterLink],
})
export class ForgotPassword {
	private authStore = inject(AuthStore);
	formBuilder = inject(FormBuilder);

	public form: FormGroup;
	public breadcrumb = translatedBreadcrumb('forgot_password');
	public codes = data.countryCodes;

	public readonly submitted = signal(false);
	public readonly pending = this.authStore.pending;
	public readonly channel = signal<Channel>('email');

	/** What the server looks the account up by — an address, or a phone in E.164. */
	public readonly identifier = computed(() => {
		if (this.channel() === 'email') return String(this.form?.value.email ?? '').trim();
		const dial = String(this.form?.value.country_code ?? '91');
		return `+${dial}${String(this.form?.value.phone ?? '').trim()}`;
	});

	constructor() {
		this.form = this.formBuilder.group({
			email: new FormControl('', [Validators.required, Validators.email]),
			phone: new FormControl('', [Validators.pattern(/^[0-9]*$/)]),
			country_code: new FormControl('91'),
		});
		this.applyChannelValidators('email');
	}

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
	}

	async submit(): Promise<void> {
		this.identifierControl.markAsTouched();
		if (this.identifierControl.invalid || this.pending()) return;

		await this.authStore.requestPasswordReset(this.identifier());
		this.submitted.set(true);
	}
}
