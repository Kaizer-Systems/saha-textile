import { Component, inject, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { AuthStore } from '@core/state/auth.store';
import { Alert } from '@shared/ui/alert/alert';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';
import { translatedBreadcrumb } from '@shared/util/breadcrumb-i18n';
import { CustomValidators } from '@shared/validators/password-match';

/** Owner lock: minimum 12 characters whenever a password is set or changed. */
const PASSWORD_MIN_LENGTH = 12;

/**
 * Redeems an emailed password-reset token.
 *
 * The token arrives in the recovery link's query string and is the entire authorization
 * for this operation — single-use, short-lived, and stored server-side only as a hash. It
 * is deliberately never copied into the session store or persisted anywhere.
 *
 * A successful reset revokes every session for that account server-side, including any this
 * browser held, so the caller is returned to the login screen rather than into the account
 * area. The previous version read an `email`/`token` pair out of the fake session store and
 * navigated to login regardless of outcome.
 */
@Component({
	selector: 'app-update-password',
	templateUrl: './update-password.html',
	styleUrls: ['./update-password.scss'],
	imports: [Breadcrumb, Alert, ReactiveFormsModule, Button, TranslocoModule],
})
export class UpdatePassword {
	private authStore = inject(AuthStore);
	private formBuilder = inject(FormBuilder);
	private route = inject(ActivatedRoute);
	router = inject(Router);

	/** Same screen for password-reset and admin-created account activation (DEC-UI-REUSE). */
	private readonly isActivation = this.router.url.includes('/auth/activate');

	public form: FormGroup;
	public breadcrumb = translatedBreadcrumb(this.isActivation ? 'create_password' : 'reset_password');

	public readonly token = signal(this.route.snapshot.queryParamMap.get('token') ?? '');
	public readonly error = this.authStore.error;
	public readonly pending = this.authStore.pending;
	public readonly passwordMinLength = PASSWORD_MIN_LENGTH;

	constructor() {
		this.form = this.formBuilder.group(
			{
				newPassword: new FormControl('', [Validators.required, Validators.minLength(PASSWORD_MIN_LENGTH)]),
				confirmPassword: new FormControl('', [Validators.required]),
			},
			{ validator: CustomValidators.MatchValidator('newPassword', 'confirmPassword') },
		);
	}

	get passwordMatchError() {
		return this.form.getError('mismatch') && this.form.get('confirmPassword')?.touched;
	}

	async submit(): Promise<void> {
		this.form.markAllAsTouched();
		if (!this.token() || !this.form.valid || this.pending()) return;

		const input = {
			token: this.token(),
			newPassword: this.form.value.newPassword as string,
		};
		const ok = this.isActivation
			? await this.authStore.activateAccount(input)
			: await this.authStore.resetPassword(input);
		// Navigate only on success. Expired, already-used and unknown tokens fail
		// identically, so the caller learns the link is invalid but not which case it was.
		if (!ok) return;

		await this.router.navigateByUrl('/auth/login');
	}
}
