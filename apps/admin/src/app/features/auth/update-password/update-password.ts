import { NgClass } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';

import { AuthStore } from '@core/state/auth.store';
import { Alert } from '@shared/ui/alert/alert';
import { Button } from '@shared/ui/button/button';

@Component({
	selector: 'app-update-password',
	templateUrl: './update-password.html',
	styleUrls: ['./update-password.scss'],
	imports: [Alert, ReactiveFormsModule, NgClass, Button, TranslateModule],
})
export class UpdatePassword {
	private authStore = inject(AuthStore);
	private formBuilder = inject(FormBuilder);
	router = inject(Router);

	public form: FormGroup;
	public email: string;
	public token: number;
	public show: boolean = false;

	constructor() {
		this.email = this.authStore.email();
		this.token = this.authStore.token() as number;
		if (!this.email && !this.token) void this.router.navigateByUrl('/auth/login');
		this.form = this.formBuilder.group({
			newPassword: new FormControl('', [Validators.required]),
			confirmPassword: new FormControl('', [Validators.required]),
		});
	}

	showPassword() {
		this.show = !this.show;
	}

	submit() {
		this.form.markAllAsTouched();
		if (this.form.valid) {
			this.authStore.updatePassword({
				email: this.email,
				token: Number(this.token),
				password: this.form.value.newPassword,
				password_confirmation: this.form.value.confirmPassword,
			});
			void this.router.navigateByUrl('/auth/login');
		}
	}
}
