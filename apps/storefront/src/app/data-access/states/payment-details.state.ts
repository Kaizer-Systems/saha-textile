import { Injectable, inject } from '@angular/core';

import { Action, Selector, State, StateContext } from '@ngxs/store';
import { tap } from 'rxjs';

import {
  GetPaymentDetailsAction,
  UpdatePaymentDetailsAction,
} from '@data-access/actions/payment-details.action';
import { IPaymentDetails } from '@data-access/interfaces/payment-details.interface';
import { PaymentDetailsService } from '../services/payment-details.service';

export class PaymentDetailsStateModel {
  paymentDetails: IPaymentDetails | null;
}

@State<PaymentDetailsStateModel>({
  name: 'paymentDetails',
  defaults: {
    paymentDetails: null,
  },
})
@Injectable()
export class PaymentDetailsState {
  private PaymentDetailsService = inject(PaymentDetailsService);

  @Selector()
  static paymentDetails(state: PaymentDetailsStateModel) {
    return state.paymentDetails;
  }

  @Action(GetPaymentDetailsAction)
  getPaymentDetails(ctx: StateContext<PaymentDetailsStateModel>) {
    return this.PaymentDetailsService.getPaymentAccount().pipe(
      tap({
        next: result => {
          ctx.patchState({
            paymentDetails: result,
          });
        },
        error: err => {
          throw new Error(err?.error?.message);
        },
      }),
    );
  }

  @Action(UpdatePaymentDetailsAction)
  updatePaymentDetails(
    _ctx: StateContext<PaymentDetailsStateModel>,
    _action: UpdatePaymentDetailsAction,
  ) {
    // Update Payment Details Logic Here
  }
}
