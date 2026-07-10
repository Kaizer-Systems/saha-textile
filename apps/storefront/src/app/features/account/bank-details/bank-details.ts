import { Component, effect, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { TranslateModule } from '@ngx-translate/core';

import { injectPaymentDetailsQuery } from '@data-access/queries/payment-details.queries';
import { Button } from '@shared/ui/button/button';

@Component({
  selector: 'app-bank-details',
  templateUrl: './bank-details.html',
  styleUrls: ['./bank-details.scss'],
  imports: [ReactiveFormsModule, Button, TranslateModule],
})
export class BankDetails {
  private readonly paymentQuery = injectPaymentDetailsQuery();

  public form: FormGroup;
  public active = 'bank';

  constructor() {
    this.form = new FormGroup({
      bank_account_no: new FormControl(),
      bank_name: new FormControl(),
      bank_holder_name: new FormControl(),
      swift: new FormControl(),
      ifsc: new FormControl(),
      paypal_email: new FormControl('', [Validators.email]),
    });

    // Patch the form when the payment details query resolves (was ngOnInit +
    // GetPaymentDetailsAction dispatch + paymentDetails$ subscribe).
    effect(() => {
      const paymentDetails = this.paymentQuery.data();
      if (paymentDetails) {
        this.form.patchValue({
          bank_account_no: paymentDetails?.bank_account_no,
          bank_name: paymentDetails?.bank_name,
          bank_holder_name: paymentDetails?.bank_holder_name,
          swift: paymentDetails?.swift,
          ifsc: paymentDetails?.ifsc,
          paypal_email: paymentDetails?.paypal_email,
        });
      }
    });
  }

  submit() {
    this.form.markAllAsTouched();
    if (this.form.valid) {
      // Payment details update has no backend yet — was UpdatePaymentDetailsAction (mock).
    }
  }
}
