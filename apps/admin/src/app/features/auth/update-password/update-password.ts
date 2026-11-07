import { NgClass } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { AuthStore } from '@core/state/auth.store';
import { Alert } from '@shared/ui/alert/alert';
import { Button } from '@shared/ui/button/button';

/** Owner lock: minimum 12 characters whenever a password is set or changed. */
const PASSWORD_MIN_LENGTH = 12;

/**
 * Step 3 of admin password recovery — redeems the token and sets the new password.
 *
 * The token arrives in `?token=`, from either the emailed link or the paste step. It is the
 * entire authorization for this operation: single-use, short-lived, and stored server-side
 * only as a hash. It is read from the URL at construction and never copied into the store
 * or browser storage.
 *
 * A successful reset is a security event, not just a form submission. Server-side it
 * revokes every admin session, bumps `tokenVersion`, and suspends PIN use until the new
 * password has been used once — so this browser is signed out by definition and the
 * operator is sent to the login screen rather than into the back office.
 *
 * The previous version read an `email`/`token` pair out of the fake session store and
 * navigated to login regardless of outcome.
 */
@Component({
	selector: 'app-update-password',
	templateUrl: './update-password.html',
	styleUrls: ['./update-password.scss'],
	imports: [Alert, ReactiveFormsModule, NgClass, Button, TranslocoModule],
})
export class UpdatePassword {
	private authStore = inject(AuthStore);
	private formBuilder = inject(FormBuilder);
	private route = inject(ActivatedRoute);
	router = inject(Router);

	public form: FormGroup;
	public show: boolean = false;

	public readonly token = signal(this.route.snapshot.queryParamMap.get('token') ?? '');
	public readonly error = this.authStore.error;
	public readonly pending = this.authStore.pending;
	public readonly passwordMinLength = PASSWORD_MIN_LENGTH;

	constructor() {
		this.form = this.formBuilder.group({
			// Mirrors the server policy so the failure is visible before a round trip. The
			// server remains the authority; this is convenience only.
			newPassword: new FormControl('', [Validators.required, Validators.minLength(PASSWORD_MIN_LENGTH)]),
			confirmPassword: new FormControl('', [Validators.required]),
		});
	}

	get passwordMismatch(): boolean {
		const { newPassword, confirmPassword } = this.form.value as Record<string, string>;
		return Boolean(confirmPassword) && newPassword !== confirmPassword;
	}

	showPassword(): void {
		this.show = !this.show;
	}

	async submit(): Promise<void> {
		this.form.markAllAsTouched();
		if (!this.token() || !this.form.valid || this.passwordMismatch || this.pending()) return;

		const reset = await this.authStore.resetPassword({
			token: this.token(),
			newPassword: this.form.value.newPassword as string,
		});
		// Navigate only on success. Expired, already-used, unknown and wrong-audience tokens
		// all fail identically, so the operator learns the link is invalid but not which.
		if (!reset) return;

		await this.router.navigateByUrl('/auth/login');
	}
}
