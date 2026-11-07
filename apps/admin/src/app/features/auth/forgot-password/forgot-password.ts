import { Component, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { AuthStore } from '@core/state/auth.store';
import { Alert } from '@shared/ui/alert/alert';
import { Button } from '@shared/ui/button/button';

/**
 * Step 1 of admin password recovery.
 *
 * Recovery is **not** a login method. It issues a single-use, short-lived, hash-only token
 * delivered by email; no session is created here and no OTP challenge exists. That
 * separation is the point — the owner lock marks admin OTP login `DO NOT BUILD AS LOGIN`,
 * so this flow must never be reachable as a way to sign in.
 *
 * The acknowledgement is unconditional. `POST /auth/admin/password/forgot` answers
 * identically for a real administrator, an unknown identifier, a customer account and a
 * disabled one; branching the UI on the outcome would rebuild the enumeration oracle that
 * generic response exists to remove. A back-office account directory is worth more to an
 * attacker than "no such user" is to a forgetful operator.
 *
 * The identifier accepts email OR username, matching admin login — an operator who
 * remembers only their username would otherwise have no route back in.
 */
@Component({
	selector: 'app-forgot-password',
	templateUrl: './forgot-password.html',
	styleUrls: ['./forgot-password.scss'],
	imports: [Alert, ReactiveFormsModule, RouterLink, Button, TranslocoModule],
})
export class ForgotPassword {
	private authStore = inject(AuthStore);
	formBuilder = inject(FormBuilder);

	public form: FormGroup;

	public readonly submitted = signal(false);
	public readonly pending = this.authStore.pending;

	constructor() {
		this.form = this.formBuilder.group({
			// Validated as present, not as an email: a username is equally valid here.
			identifier: ['', [Validators.required]],
		});
	}

	async submit(): Promise<void> {
		this.form.markAllAsTouched();
		if (!this.form.valid || this.pending()) return;

		await this.authStore.requestPasswordReset((this.form.value.identifier as string).trim());
		this.submitted.set(true);
	}
}
