import { IPaymentDetails } from '@data-access/interfaces/payment-details.interface';

export class GetPaymentDetailsAction {
  static readonly type = '[Payment Details] Get';
}

export class UpdatePaymentDetailsAction {
  static readonly type = '[Payment Details] Post';
  constructor(public payload: IPaymentDetails) {}
}
