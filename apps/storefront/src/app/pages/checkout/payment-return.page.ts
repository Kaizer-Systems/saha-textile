// AnalogJS file-based route: /<locale>/checkout/payment-return?attempt=…, where the gateways send the
// shopper back (CCAvenue via the API's return route, PayPal directly).

import { PaymentReturn } from '@features/shop/checkout/payment-return/payment-return';

export default PaymentReturn;
