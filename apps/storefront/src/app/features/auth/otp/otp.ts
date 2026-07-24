import { Component, inject } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { AuthStore } from '@core/state/auth.store';
import { Alert } from '@shared/ui/alert/alert';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';
import { translatedBreadcrumb } from '@shared/util/breadcrumb-i18n';

@Component({
	selector: 'app-otp',
	templateUrl: './otp.html',
	styleUrls: ['./otp.scss'],
	imports: [Breadcrumb, Alert, ReactiveFormsModule, Button, TranslocoModule],
})
export class Otp {
	router = inject(Router);
	private authStore = inject(AuthStore);
	formBuilder = inject(FormBuilder);

	public form: FormGroup;
	public email: string;
	public breadcrumb = translatedBreadcrumb('otp');

	constructor() {
		this.email = this.authStore.email();
		this.form = this.formBuilder.group({
			otp: new FormControl('', [Validators.required, Validators.minLength(5)]),
		});
	}

	submit() {
		this.form.markAllAsTouched();
		if (this.form.valid) {
			this.authStore.verifyEmail({
				email: this.email,
				token: this.form.value.otp,
			});
			void this.router.navigateByUrl('/auth/update-password');
		}
	}
}
