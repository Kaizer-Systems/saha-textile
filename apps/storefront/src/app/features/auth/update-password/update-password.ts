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

import { UpdatePasswordAction } from '@data-access/actions/auth.action';
import { Alert } from '@shared/ui/alert/alert';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';

@Component({
  selector: 'app-update-password',
  templateUrl: './update-password.html',
  styleUrls: ['./update-password.scss'],
  imports: [Breadcrumb, Alert, ReactiveFormsModule, Button, TranslateModule],
})
export class UpdatePassword {
  private store = inject(Store);
  private formBuilder = inject(FormBuilder);
  router = inject(Router);

  public form: FormGroup;
  public email: string;
  public token: string;
  public breadcrumb: IBreadcrumb = {
    title: 'Reset Password',
    items: [{ label: 'Reset Password', active: true }],
  };

  constructor() {
    this.email = this.store.selectSnapshot(state => state.auth.email);
    this.token = this.store.selectSnapshot(state => state.auth.token);
    this.form = this.formBuilder.group({
      newPassword: new FormControl('', [Validators.required]),
      confirmPassword: new FormControl('', [Validators.required]),
    });
  }

  submit() {
    this.form.markAllAsTouched();
    if (this.form.valid) {
      this.store
        .dispatch(
          new UpdatePasswordAction({
            email: this.email,
            token: this.token,
            password: this.form.value.newPassword,
            password_confirmation: this.form.value.confirmPassword,
          }),
        )
        .subscribe({
          complete: () => {
            void this.router.navigateByUrl('/auth/login');
          },
        });
    }
  }
}
