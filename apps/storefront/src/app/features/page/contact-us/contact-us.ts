import { Component, inject } from '@angular/core';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { IContact, IOption } from '@data-access/interfaces/theme-option.interface';
import { ThemeOptionState } from '@data-access/states/theme-option.state';

@Component({
  selector: 'app-contact-us',
  templateUrl: './contact-us.html',
  styleUrls: ['./contact-us.scss'],
  imports: [Breadcrumb, ReactiveFormsModule, Button, TranslateModule],
})
export class ContactUs {
  private formBuilder = inject(FormBuilder);
  private store = inject(Store);

  themeOption$: Observable<IOption> = inject(Store).select(
    ThemeOptionState.themeOptions,
  ) as Observable<IOption>;

  public breadcrumb: IBreadcrumb = {
    title: 'Contact Us',
    items: [{ label: 'Contact Us', active: true }],
  };

  public form: FormGroup;
  public contactData: IContact;

  constructor() {
    this.form = this.formBuilder.group({
      name: new FormControl('', [Validators.required]),
      email: new FormControl('', [Validators.required, Validators.email]),
      phone: new FormControl('', [Validators.required]),
      subject: new FormControl('', [Validators.required]),
      message: new FormControl('', [Validators.required]),
    });

    this.themeOption$.subscribe(data => (this.contactData = data?.contact_us));
  }

  submit() {
    this.form.markAllAsTouched();
    if (this.form.valid) {
      // Contact form has no backend yet — just reset locally.
      this.form.reset();
    }
  }
}
