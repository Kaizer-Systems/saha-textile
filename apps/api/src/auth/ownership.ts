import { type ExecutionContext, ForbiddenException, NotFoundException, createParamDecorator } from '@nestjs/common';

import type { PermissionCode } from '@saha-textile/contracts';

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
 * A permission check answers "may this KIND of operator do this?"; it does not answer
 * "does this particular record belong to them?". Every read or write of an owned resource
 * must call this with the owner recorded on the record.
 *
 * Support-read of a customer-owned resource requires admin audience **and** a named
 * permission (`order.index` / `cart.index`) — never a coarse staff/admin role bypass
 * (`DEC-ACCOUNT-SEPARATION` D4). Operator ids never equal customer ids after the split,
 * so id-equality alone is the customer path.
 *
 * It throws NOT FOUND rather than FORBIDDEN on purpose: a 403 confirms the id exists,
 * which turns the endpoint into an enumeration oracle. A caller who does not own the
 * record is told only that there is nothing there.
 */
export function assertOwnership(input: {
	principal: AuthenticatedPrincipal | undefined;
	ownerUserId: string | null | undefined;
	/**
	 * Permissions that authorize support-read/write without owning the record.
	 * Caller must also hold admin audience (enforced here).
	 */
	allowPermissions?: readonly PermissionCode[];
}): void {
	if (!input.principal) throw new ForbiddenException('Authentication required');

	if (
		input.principal.audience === 'admin' &&
		input.allowPermissions?.some((code) => input.principal!.permissions.includes(code))
	) {
		return;
	}

	if (!input.ownerUserId || input.ownerUserId !== input.principal.userId) {
		throw new NotFoundException('Resource not found');
	}
}
