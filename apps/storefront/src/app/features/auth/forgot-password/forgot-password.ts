import { Component, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';

import { AuthStore } from '@core/state/auth.store';
import { Alert } from '@shared/ui/alert/alert';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';

@Component({
  selector: 'app-forgot-password',
  templateUrl: './forgot-password.html',
  styleUrls: ['./forgot-password.scss'],
  imports: [Breadcrumb, Alert, ReactiveFormsModule, Button, TranslateModule],
})
export class ForgotPassword {
  private authStore = inject(AuthStore);
  router = inject(Router);
  formBuilder = inject(FormBuilder);

  public form: FormGroup;
  public breadcrumb: IBreadcrumb = {
    title: 'Forgot Password',
    items: [{ label: 'Forgot Password', active: true }],
  };

  constructor() {
    this.form = this.formBuilder.group({
      email: ['', [Validators.required, Validators.email]],
    });
  }

  submit() {
    this.form.markAllAsTouched();
    if (this.form.valid) {
      this.authStore.forgotPassword(this.form.value);
      void this.router.navigateByUrl('/auth/otp');
    }
  }
}
