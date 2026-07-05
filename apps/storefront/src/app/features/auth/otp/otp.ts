import { Component, inject } from '@angular/core';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { Router } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';

import { VerifyEmailOtpAction } from '@data-access/actions/auth.action';
import { Alert } from '@shared/ui/alert/alert';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';

@Component({
  selector: 'app-otp',
  templateUrl: './otp.html',
  styleUrls: ['./otp.scss'],
  imports: [Breadcrumb, Alert, ReactiveFormsModule, Button, TranslateModule],
})
export class Otp {
  router = inject(Router);
  store = inject(Store);
  formBuilder = inject(FormBuilder);

  public form: FormGroup;
  public email: string;
  public breadcrumb: IBreadcrumb = {
    title: 'OTP',
    items: [{ label: 'OTP', active: true }],
  };

  constructor() {
    this.email = this.store.selectSnapshot(state => state.auth.email);
    this.form = this.formBuilder.group({
      otp: new FormControl('', [Validators.required, Validators.minLength(5)]),
    });
  }

  submit() {
    this.form.markAllAsTouched();
    if (this.form.valid) {
      this.store
        .dispatch(
          new VerifyEmailOtpAction({
            email: this.email,
            token: this.form.value.otp,
          }),
        )
        .subscribe({
          complete: () => {
            void this.router.navigateByUrl('/auth/update-password');
          },
        });
    }
  }
}
