import { Component, inject } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { AuthStore } from '@core/state/auth.store';
import { Alert } from '@shared/ui/alert/alert';
import { Button } from '@shared/ui/button/button';

@Component({
	selector: 'app-login',
	templateUrl: './login.html',
	styleUrls: ['./login.scss'],
	imports: [Alert, ReactiveFormsModule, RouterModule, TranslocoModule, Button],
})
export class Login {
	private authStore = inject(AuthStore);
	private router = inject(Router);
	private formBuilder = inject(FormBuilder);

	public form: FormGroup;

	constructor() {
		this.form = this.formBuilder.group({
			email: new FormControl('admin@example.com', [Validators.required, Validators.email]),
			password: new FormControl('123456789', [Validators.required]),
		});
	}

	submit() {
		this.form.markAllAsTouched();
		if (this.form.valid) {
			this.authStore.login(this.form.value);
			void this.router.navigateByUrl('/dashboard');
		}
	}
}
