import { BadRequestException } from '@nestjs/common';
import { evaluatePassword } from '@saha-textile/core-domain';

/**
 * The single place a domain password verdict becomes an HTTP refusal.
 *
 * Core decides; this translates. Five surfaces set a password — storefront registration,
 * storefront password reset, admin invite acceptance, admin password change and admin password
 * reset — and one helper is what stops the policy being enforced on four of them and forgotten
 * on the fifth, which is exactly how it came to be missing on all five.
 *
 * Shaped as a validation issue for the same reason as `assertPinAcceptable` next door:
 * `HttpExceptionFilter` replaces an exception's message with a safe one chosen by status, so a
 * `BadRequestException('that password is too common')` reaches the user as "The request could
 * not be processed". `issues` is the one channel the filter preserves, because issues describe
 * the caller's own input, and a rejected password is exactly that.
 *
 * The `code` is stable and machine-readable so a client can localise rather than display the
 * server's English. The password itself never appears in either.
 *
 * ## Anti-enumeration note for callers
 *
 * On any surface where the response otherwise depends on whether an account exists, call this
 * BEFORE that lookup. If a weak password were refused only after the existence check, the
 * status code would differ for known and unknown identifiers and the endpoint would become a
 * directory — see the registration handler, where this ordering is load-bearing.
 */
export function assertPasswordAcceptable(password: string): void {
	const decision = evaluatePassword(password);
	if (decision.acceptable) return;

	throw new BadRequestException({
		message: 'Validation failed',
		issues: [{ path: 'password', message: decision.message, code: `password_${decision.refusal}` }],
	});
}
