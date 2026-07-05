import { Component, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import {
  GetPaymentDetailsAction,
  UpdatePaymentDetailsAction,
} from '@data-access/actions/payment-details.action';
import { Button } from '@shared/ui/button/button';
import { IPaymentDetails } from '@data-access/interfaces/payment-details.interface';
import { PaymentDetailsState } from '@data-access/states/payment-details.state';

@Component({
  selector: 'app-bank-details',
  templateUrl: './bank-details.html',
  styleUrls: ['./bank-details.scss'],
  imports: [ReactiveFormsModule, Button, TranslateModule],
})
export class BankDetails {
  private store = inject(Store);

  paymentDetails$: Observable<IPaymentDetails> = inject(Store).select(
    PaymentDetailsState.paymentDetails,
  ) as Observable<IPaymentDetails>;

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
  }

  ngOnInit(): void {
    this.store.dispatch(new GetPaymentDetailsAction());
    this.paymentDetails$.subscribe(paymentDetails => {
      this.form.patchValue({
        bank_account_no: paymentDetails?.bank_account_no,
        bank_name: paymentDetails?.bank_name,
        bank_holder_name: paymentDetails?.bank_holder_name,
        swift: paymentDetails?.swift,
        ifsc: paymentDetails?.ifsc,
        paypal_email: paymentDetails?.paypal_email,
      });
    });
  }

  submit() {
    this.form.markAllAsTouched();
    if (this.form.valid) {
      this.store.dispatch(new UpdatePaymentDetailsAction(this.form.value));
    }
  }
}
