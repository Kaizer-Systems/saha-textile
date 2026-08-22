// AnalogJS file-based route. Thin wrapper: the real component lives under
// features/ (ported verbatim). File path = URL; see route map in app notes.

import { abandonSignupGuard } from '@core/guards/abandon-signup.guard';
import { Register } from '@features/auth/register/register';

/**
 * Leaving this screen abandons the signup in flight; reloading it does not.
 *
 * Declared here rather than inside the component because that is the distinction the ROUTER
 * owns. A teardown hook fires for both cases and could not tell them apart, and a pending record
 * that dies on every refresh would defeat the reason it lives on the server at all.
 */
export const routeMeta = { canDeactivate: [abandonSignupGuard] };

export default Register;
