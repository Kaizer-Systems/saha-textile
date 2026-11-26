// AnalogJS file-based route → /<locale>/checkout. An index page inside checkout/, not checkout.page.ts:
// a page named like a folder becomes that folder's layout, and the checkout has no router outlet, so
// /checkout/payment-return would draw the checkout and never run the return page.

import { AuthGuard } from '@core/guards/auth.guard';
import { Checkout } from '@features/shop/checkout/checkout';

/** Guest checkout is off at launch (OD6): a guest signs in first and comes back here. */
export const routeMeta = { canActivate: [AuthGuard] };

export default Checkout;
