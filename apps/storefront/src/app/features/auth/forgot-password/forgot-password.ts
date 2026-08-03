import { Component, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';

import { AuthStore } from '@core/state/auth.store';
import { Alert } from '@shared/ui/alert/alert';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';
import { translatedBreadcrumb } from '@shared/util/breadcrumb-i18n';

/**
 * Password recovery request.
 *
 * The template this screen came from advanced to an OTP page next. That flow does not
 * exist here: recovery is a single-use, short-lived, hash-only **token delivered by email**
 * and redeemed at `/auth/update-password`, while OTP is a separate login method with its
 * own purpose-bound challenge. Keeping those purposes apart is exactly what the auth
 * architecture requires, so this screen no longer navigates onward — it acknowledges and
 * stops.
 *
 * The acknowledgement is unconditional on purpose. The API answers identically for known
 * and unknown addresses; routing or wording differently here would rebuild the account
 * enumeration oracle that the generic response exists to remove.
 */
@Component({
	selector: 'app-forgot-password',
	templateUrl: './forgot-password.html',
	styleUrls: ['./forgot-password.scss'],
	imports: [Breadcrumb, Alert, ReactiveFormsModule, Button, TranslocoModule],
})
export class ForgotPassword {
	private authStore = inject(AuthStore);
	formBuilder = inject(FormBuilder);

	public form: FormGroup;
	public breadcrumb = translatedBreadcrumb('forgot_password');

	public readonly submitted = signal(false);
	public readonly pending = this.authStore.pending;

	constructor() {
		this.form = this.formBuilder.group({
			email: ['', [Validators.required, Validators.email]],
		});
	}

	async submit(): Promise<void> {
		this.form.markAllAsTouched();
		if (!this.form.valid || this.pending()) return;

		await this.authStore.requestPasswordReset(this.form.value.email as string);
		this.submitted.set(true);
	}
}
