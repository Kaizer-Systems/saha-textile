import { BadRequestException } from '@nestjs/common';
import { evaluateAdminPin } from '@saha-textile/core-domain';

/**
 * The single place a domain PIN verdict becomes an HTTP refusal.
 *
 * Core decides; this translates. Two surfaces set a PIN — invite acceptance and Security
 * Settings — and giving them one helper is what stops the policy being enforced on one and
 * forgotten on the other, which is exactly how the check came to be missing in the first
 * place.
 *
 * ## Why the refusal is shaped as a validation issue
 *
 * `HttpExceptionFilter` replaces an exception's message with a safe one chosen by status, so
 * a `BadRequestException('that PIN is sequential')` reaches the operator as "The request
 * could not be processed" — true, useless, and guaranteed to produce a support ticket. The
 * one channel the filter preserves is `issues`, deliberately, because those describe the
 * CALLER'S OWN INPUT and are safe to return. A weak-PIN refusal is precisely that.
 *
 * ## Why saying this much is safe here and would not be at login
 *
 * Both call sites are authorized — a live admin session, or possession of a single-use
 * invite token. The operator is being told something about a PIN they just typed, not about
 * an account they are guessing at. That is the same boundary `AuthRefusalReason` draws: a
 * pre-authentication refusal stays generic, a caller who has proven who they are gets told
 * what is wrong.
 *
 * The `code` is stable and machine-readable so a client can localize the message rather than
 * display the server's English. The PIN itself never appears in either.
 */
export function assertPinAcceptable(pin: string): void {
	const decision = evaluateAdminPin(pin);
	if (decision.acceptable) return;

	throw new BadRequestException({
		message: 'Validation failed',
		issues: [{ path: 'pin', message: decision.message, code: `pin_${decision.refusal}` }],
	});
}
