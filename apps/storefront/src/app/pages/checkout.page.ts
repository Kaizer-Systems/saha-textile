// AnalogJS file-based route. Thin wrapper: the real component lives under
// features/ (ported verbatim). File path = URL; see route map in app notes.

import { AuthGuard } from '@core/guards/auth.guard';
import { Checkout } from '@features/shop/checkout/checkout';

/** Guest checkout is off at launch (OD6): a guest signs in first and comes back here. */
export const routeMeta = { canActivate: [AuthGuard] };

export default Checkout;
