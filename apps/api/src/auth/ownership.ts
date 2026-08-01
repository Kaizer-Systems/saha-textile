import { type ExecutionContext, ForbiddenException, NotFoundException, createParamDecorator } from '@nestjs/common';

import type { AuthenticatedPrincipal, RequestWithPrincipal } from './session.guard';

/** Injects the authenticated principal established by `SessionGuard`. */
export const Principal = createParamDecorator(
	(_data: unknown, ctx: ExecutionContext): AuthenticatedPrincipal | undefined =>
		ctx.switchToHttp().getRequest<RequestWithPrincipal>().principal,
);

/**
 * Object-level authorization (BOLA — the top API risk in the OWASP list the security
 * baseline names).
 *
 * A role check answers "may this KIND of user do this?"; it does not answer "does this
 * particular record belong to them?". Every read or write of an owned resource must call
 * this with the owner recorded on the record.
 *
 * It throws NOT FOUND rather than FORBIDDEN on purpose: a 403 confirms the id exists,
 * which turns the endpoint into an enumeration oracle. A caller who does not own the
 * record is told only that there is nothing there.
 */
export function assertOwnership(input: {
	principal: AuthenticatedPrincipal | undefined;
	ownerUserId: string | null | undefined;
	/** Roles allowed to bypass ownership (admin support paths). Empty by default. */
	allowRoles?: readonly string[];
}): void {
	if (!input.principal) throw new ForbiddenException('Authentication required');

	if (input.allowRoles?.includes(input.principal.role)) return;

	if (!input.ownerUserId || input.ownerUserId !== input.principal.userId) {
		throw new NotFoundException('Resource not found');
	}
}
