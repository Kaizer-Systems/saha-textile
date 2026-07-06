// AnalogJS file-based route. Thin wrapper: the real component lives under
// features/ (ported verbatim). File path = URL; see route map in app notes.

import { AuthGuard } from '@core/guards/auth.guard';
import { Account } from '@features/account/account';

export const routeMeta = { canActivate: [AuthGuard] };

export default Account;
