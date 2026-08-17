import { randomUUID } from 'node:crypto';

import {
	Body,
	Controller,
	Delete,
	Get,
	Inject,
	NotFoundException,
	Param,
	Patch,
	Post,
	UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type Address, CreateOwnAddressRequest, type Customer, UpdateOwnAddressRequest } from '@saha-textile/contracts';
import type { CustomerRepository } from '@saha-textile/core-domain';

import { Principal } from '../auth/ownership';
import { type AuthenticatedPrincipal, Audience } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CUSTOMER_REPOSITORY } from '../infra/tokens';
import { API_TAGS } from '../openapi-tags';

/**
 * A customer's OWN saved addresses.
 *
 * ## The ownership guarantee is structural, not a check
 *
 * There is no `:customerId` anywhere in these routes. The id comes from the session principal,
 * so a caller cannot even NAME another customer's account, let alone reach it — the class of bug
 * where a guard is added on three routes and forgotten on the fourth is not available here.
 *
 * That is the whole reason these are separate from `admin/customers/:customerId/addresses`
 * rather than the same handlers with a permission check. An operator route is *about* acting on
 * somebody else's account and is authorised per permission; a self-service route must never be
 * able to. Two shapes, two surfaces, and neither can be mistaken for the other.
 *
 * `@Audience('storefront')` closes the other direction: an operator session must not act on a
 * customer account through the customer's own doorway.
 *
 * Each route answers the whole updated `Customer`, so the browser re-renders from the server's
 * view rather than patching its own copy and hoping the two agree.
 */
@ApiTags(API_TAGS.storefrontAccount)
@Controller('storefront/account/addresses')
@Audience('storefront')
export class StorefrontAddressesController {
	constructor(@Inject(CUSTOMER_REPOSITORY) private readonly customers: CustomerRepository) {}

	/** Narrows the principal once, so every handler below can assume an id. */
	private ownerId(principal: AuthenticatedPrincipal | undefined): string {
		if (!principal) throw new UnauthorizedException('Authentication required');
		return principal.userId;
	}

	@Get()
	@ApiOperation({ operationId: 'listOwnAddresses', summary: "The signed-in customer's saved addresses" })
	async list(@Principal() principal: AuthenticatedPrincipal | undefined): Promise<{ addresses: Address[] }> {
		const customer = await this.customers.findById(this.ownerId(principal));
		if (!customer) throw new UnauthorizedException('Account not found');
		return { addresses: customer.addresses };
	}

	@Post()
	@ApiOperation({ operationId: 'addOwnAddress', summary: 'Save a new address on the current account' })
	async add(
		@Body(new ZodValidationPipe(CreateOwnAddressRequest)) body: CreateOwnAddressRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<Customer> {
		const customerId = this.ownerId(principal);
		const address: Address = { ...body, id: `adr_${randomUUID()}` };
		const updated = await this.customers.addAddress(customerId, address);
		if (!updated) throw new UnauthorizedException('Account not found');
		return updated;
	}

	@Patch(':addressId')
	@ApiOperation({ operationId: 'updateOwnAddress', summary: 'Patch one of the current account’s addresses' })
	async update(
		@Param('addressId') addressId: string,
		@Body(new ZodValidationPipe(UpdateOwnAddressRequest)) body: UpdateOwnAddressRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<Customer> {
		// Scoped to the caller: an id belonging to somebody else simply does not match.
		const updated = await this.customers.updateAddress(this.ownerId(principal), addressId, body);
		if (!updated) throw new NotFoundException('Address not found');
		return updated;
	}

	@Delete(':addressId')
	@ApiOperation({ operationId: 'deleteOwnAddress', summary: 'Remove one of the current account’s addresses' })
	async remove(
		@Param('addressId') addressId: string,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<Customer> {
		const updated = await this.customers.deleteAddress(this.ownerId(principal), addressId);
		if (!updated) throw new NotFoundException('Address not found');
		return updated;
	}
}
