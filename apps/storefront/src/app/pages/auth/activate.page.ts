// AnalogJS file-based route: `/auth/activate?token=…`
// Reuses the update-password feature screen (DEC-UI-REUSE) — activation vs reset
// is selected from the route path inside the component.

import { UpdatePassword } from '@features/auth/update-password/update-password';

export default UpdatePassword;
