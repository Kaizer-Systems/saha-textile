import { Component, inject } from '@angular/core';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';

import { AuthStore } from '@core/state/auth.store';
import { Alert } from '@shared/ui/alert/alert';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { AuthService } from '@data-access/services/auth.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.html',
  styleUrls: ['./login.scss'],
  imports: [Breadcrumb, Alert, ReactiveFormsModule, RouterLink, Button, TranslateModule],
})
export class Login {
  private authStore = inject(AuthStore);
  private router = inject(Router);
  private formBuilder = inject(FormBuilder);
  private authService = inject(AuthService);

  public form: FormGroup;
  public breadcrumb: IBreadcrumb = {
    title: 'Log in',
    items: [{ label: 'Log in', active: true }],
  };

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
