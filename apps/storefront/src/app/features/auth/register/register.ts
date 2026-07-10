import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject } from '@angular/core';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';
import { Select2Module } from 'ng-select2-component';

import { AuthStore } from '@core/state/auth.store';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';
import * as data from '../../../shared/data/country-code';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { CustomValidators } from '@shared/validators/password-match';

@Component({
  selector: 'app-register',
  templateUrl: './register.html',
  styleUrls: ['./register.scss'],
  imports: [Breadcrumb, ReactiveFormsModule, Select2Module, Button, RouterLink, TranslateModule],
})
export class Register {
  private authStore = inject(AuthStore);
  private router = inject(Router);
  private formBuilder = inject(FormBuilder);
  private platformId = inject<Object>(PLATFORM_ID);

  public form: FormGroup;
  public breadcrumb: IBreadcrumb = {
    title: 'Sign In',
    items: [{ label: 'Sign In', active: true }],
  };
  public codes = data.countryCodes;
  public tnc = new FormControl(false, [Validators.requiredTrue]);
  public isBrowser: boolean;

  constructor() {
    this.isBrowser = isPlatformBrowser(this.platformId);
    this.form = this.formBuilder.group(
      {
        name: new FormControl('', [Validators.required]),
        email: new FormControl('', [Validators.required, Validators.email]),
        phone: new FormControl('', [Validators.required, Validators.pattern(/^[0-9]*$/)]),
        country_code: new FormControl('91', [Validators.required]),
        password: new FormControl('', [Validators.required]),
        password_confirmation: new FormControl('', [Validators.required]),
      },
      { validator: CustomValidators.MatchValidator('password', 'password_confirmation') },
    );
  }

  get passwordMatchError() {
    return this.form.getError('mismatch') && this.form.get('password_confirmation')?.touched;
  }

  submit() {
    this.form.markAllAsTouched();
    if (this.tnc.invalid) {
      return;
    }
    if (this.form.valid) {
      this.authStore.register(this.form.value);
      void this.router.navigateByUrl('/account/dashboard');
    }
  }
}
