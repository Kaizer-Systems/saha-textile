import { Component, inject } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { AuthStore } from '@core/state/auth.store';
import { AuthService } from '@data-access/services/auth.service';
import { Alert } from '@shared/ui/alert/alert';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';
import { translatedBreadcrumb } from '@shared/util/breadcrumb-i18n';

@Component({
	selector: 'app-login',
	templateUrl: './login.html',
	styleUrls: ['./login.scss'],
	imports: [Breadcrumb, Alert, ReactiveFormsModule, RouterLink, Button, TranslocoModule],
})
export class Login {
	private authStore = inject(AuthStore);
	private router = inject(Router);
	private formBuilder = inject(FormBuilder);
	private authService = inject(AuthService);

	public form: FormGroup;
	public breadcrumb = translatedBreadcrumb('log_in');

	/** Bound by the template so a failed sign-in is visible instead of silent. */
	public readonly error = this.authStore.error;
	public readonly pending = this.authStore.pending;

	constructor() {
		// Empty, not pre-filled. The demo pair that used to sit here made the form look
		// like a working login while the store faked the session; worse, a copied demo
		// credential is exactly the kind of thing that survives into a deployed build.
		this.form = this.formBuilder.group({
			email: new FormControl('', [Validators.required, Validators.email]),
			password: new FormControl('', [Validators.required]),
		});
	}

	async submit(): Promise<void> {
		this.form.markAllAsTouched();
		if (!this.form.valid || this.pending()) return;

		const signedIn = await this.authStore.loginWithPassword({
			email: this.form.value.email as string,
			password: this.form.value.password as string,
		});
		// Navigate only after the API confirms the session. The previous version routed to
		// the account dashboard immediately, so a rejected login still looked successful.
		if (!signedIn) return;

		const redirectUrl = this.authService.redirectUrl || '/account/dashboard';
		this.authService.redirectUrl = undefined;
		await this.router.navigateByUrl(redirectUrl);
	}
}
