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

	constructor() {
		this.form = this.formBuilder.group({
			email: new FormControl('john.customer@example.com', [Validators.required, Validators.email]),
			password: new FormControl('123456789', [Validators.required]),
		});
	}

	submit() {
		this.form.markAllAsTouched();
		if (this.form.valid) {
			this.authStore.login(this.form.value);
			// Navigate to the intended URL after login (login() is a synchronous mock).
			const redirectUrl = this.authService.redirectUrl || '/account/dashboard';
			void this.router.navigateByUrl(redirectUrl);
			// Clear the stored redirect URL
			this.authService.redirectUrl = undefined;
		}
	}
}
