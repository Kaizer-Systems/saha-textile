// AnalogJS file-based route. Thin wrapper: the real component lives under
// features/ (ported verbatim). File path = URL; see route map in app notes.

import { guestOnlyGuard } from '@core/guards/auth.guard';
import { ForgotPassword } from '@features/auth/forgot-password/forgot-password';

/** A signed-in customer has nothing to do here; see `guestOnlyGuard`. */
export const routeMeta = { canActivate: [guestOnlyGuard] };

export default ForgotPassword;
