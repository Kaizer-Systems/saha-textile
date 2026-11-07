import { UnauthorizedException } from '@nestjs/common';
import type { AuthRefusalReason } from '@saha-textile/contracts';

/**
 * A 401 that is allowed to say WHY.
 *
 * The distinction this type draws is a security boundary, not a convenience. The global
 * filter attaches a `reason` to the error envelope only when the thrown exception is one of
 * these, and it never infers one from a status code or an exception message. That keeps the
 * rule mechanical rather than remembered: a plain `UnauthorizedException` — which is what
 * every credential endpoint raises — cannot acquire a reason by accident, however its message
 * is worded or wherever it is copied from.
 *
 * Only refusals about the CALLER'S OWN session belong here, because the caller proved that
 * session by presenting its cookie. Never construct one on a login, PIN, OTP or recovery
 * path: telling an unauthenticated stranger "PIN locked" rather than "invalid" confirms the
 * guessed account exists. See `AuthRefusalReason` for the full reasoning.
 */
export class SessionRefusal extends UnauthorizedException {
	constructor(
		readonly reason: AuthRefusalReason,
		description: string,
	) {
		// The description is for server logs and developers reading a handler; the client is
		// sent the generic safe message for its status, exactly as before.
		super(description);
	}
}
