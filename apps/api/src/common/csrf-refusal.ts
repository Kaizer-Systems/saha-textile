import { ForbiddenException } from '@nestjs/common';

/**
 * The CSRF check failed. A separate type so the client can tell this recoverable refusal from
 * a permissions 403, which must never be retried. The `reason` says only that the token was
 * refused, not which half was wrong.
 */
export class CsrfRefusal extends ForbiddenException {
	readonly reason = 'csrf_rejected' as const;

	constructor() {
		super('CSRF validation failed');
	}
}
