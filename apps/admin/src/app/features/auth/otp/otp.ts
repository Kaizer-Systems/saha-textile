import { Component, inject } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';

import { AuthStore } from '@core/state/auth.store';
import { Alert } from '@shared/ui/alert/alert';
import { Button } from '@shared/ui/button/button';

@Component({
	selector: 'app-otp',
	templateUrl: './otp.html',
	styleUrls: ['./otp.scss'],
	imports: [Alert, ReactiveFormsModule, Button, TranslateModule],
})
export class Otp {
	router = inject(Router);
	private authStore = inject(AuthStore);
	formBuilder = inject(FormBuilder);

	public form: FormGroup;
	public email: string;
	public loading: boolean;

	constructor() {
		this.email = this.authStore.email();
		if (!this.email) void this.router.navigateByUrl('/auth/login');
		this.form = this.formBuilder.group({
			otp: new FormControl('', [Validators.required, Validators.minLength(5)]),
		});
	}

	submit() {
		this.form.markAllAsTouched();
		if (this.form.valid) {
			this.authStore.verifyEmailOtp({ email: this.email, token: this.form.value.otp });
			void this.router.navigateByUrl('/auth/update-password');
		}
	}
}
