import { Body, Controller, Inject, NotFoundException, Patch, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type Customer, UpdateOwnProfileRequest } from '@saha-textile/contracts';
import type { CustomerRepository } from '@saha-textile/core-domain';

import { Principal } from '../auth/ownership';
import { type AuthenticatedPrincipal, Audience } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CUSTOMER_REPOSITORY } from '../infra/tokens';
import { API_TAGS } from '../openapi-tags';

/**
 * The signed-in customer's own profile.
 *
 * No customer id in the route: the owner comes from the session, so this cannot be pointed at
 * anybody else's account.
 *
 * What it accepts is deliberately narrow — see `UpdateOwnProfileRequest`. Email and phone are
 * login credentials, and moving one is how an attacker with a live session makes their access
 * permanent; that needs proof and verification, not a patch field.
 */
@ApiTags(API_TAGS.storefrontAccount)
@Controller('storefront/account/profile')
@Audience('storefront')
export class StorefrontProfileController {
	constructor(@Inject(CUSTOMER_REPOSITORY) private readonly customers: CustomerRepository) {}

	@Patch()
	@ApiOperation({ operationId: 'updateOwnProfile', summary: "Change the current account's display name" })
	async update(
		@Body(new ZodValidationPipe(UpdateOwnProfileRequest)) body: UpdateOwnProfileRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<Customer> {
		if (!principal) throw new UnauthorizedException('Authentication required');

		const updated = await this.customers.update(principal.userId, { displayName: body.displayName.trim() });
		if (!updated) throw new NotFoundException('Account not found');
		return updated;
	}
}
