// AnalogJS file-based route: /<locale>/checkout/payment-return?attempt=…, where the gateways send the
// shopper back (CCAvenue via the API's return route, PayPal directly).

import { AuthGuard } from '@core/guards/auth.guard';
import { PaymentReturn } from '@features/shop/checkout/payment-return/payment-return';

/** The confirm call needs the shopper's session: a shopper signed out meanwhile signs in and comes back. */
export const routeMeta = { canActivate: [AuthGuard] };

export default PaymentReturn;
