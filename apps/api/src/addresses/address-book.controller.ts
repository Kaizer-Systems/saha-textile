import { Body, Controller, Inject, NotFoundException, Param, Post, Put, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SavedAddressWrite, type Customer } from '@saha-textile/contracts';
import type { CustomerRepository } from '@saha-textile/core-domain';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CUSTOMER_REPOSITORY } from '../infra/tokens';
import { API_TAGS } from '../openapi-tags';
import { AddressBookService } from './address-book.service';

/**
 * Shop › My account › Saved addresses, with the country rules (`DEC-ADDRESS`; brief shop14–shop16).
 * As with `storefront/account/addresses`, there is no customer id in the path: the session names
 * the account, so a caller can never reach someone else's addresses. Listing and removing stay on
 * `storefront/account/addresses`; these two routes add and replace an address with every check.
 */
@ApiTags(API_TAGS.storefrontAccount)
@Controller('storefront/account/address-book')
@Audience('storefront')
export class StorefrontAddressBookController {
	constructor(private readonly book: AddressBookService) {}

	private ownerId(principal: AuthenticatedPrincipal | undefined): string {
		if (!principal) throw new UnauthorizedException('Authentication required');
		return principal.userId;
	}

	@Post()
	@ApiOperation({
		operationId: 'addOwnCheckedAddress',
		summary: 'Save a named address, checked against the country rules',
	})
	add(
		@Body(new ZodValidationPipe(SavedAddressWrite)) body: SavedAddressWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<Customer> {
		return this.book.add(this.ownerId(principal), body);
	}

	@Put(':addressId')
	@ApiOperation({ operationId: 'replaceOwnCheckedAddress', summary: 'Replace one saved address, checked again' })
	replace(
		@Param('addressId') addressId: string,
		@Body(new ZodValidationPipe(SavedAddressWrite)) body: SavedAddressWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<Customer> {
		return this.book.replace(this.ownerId(principal), addressId, body);
	}
}

/** Admin › Customers › a customer's addresses (brief ad04–ad05): the same form and rules for staff. */
@ApiTags(API_TAGS.auth)
@Controller('admin/customers/:customerId/address-book')
@Audience('admin')
export class AdminCustomerAddressBookController {
	constructor(
		private readonly book: AddressBookService,
		@Inject(CUSTOMER_REPOSITORY) private readonly customers: CustomerRepository,
	) {}

	private async existing(customerId: string): Promise<void> {
		const customer = await this.customers.findById(customerId);
		if (!customer || customer.status === 'deleted') throw new NotFoundException('Customer not found');
	}

	@Post()
	@RequirePermissions('customer.update')
	@ApiOperation({ operationId: 'addCustomerCheckedAddress', summary: 'Add a named address for a customer, checked' })
	async add(
		@Param('customerId') customerId: string,
		@Body(new ZodValidationPipe(SavedAddressWrite)) body: SavedAddressWrite,
	): Promise<Customer> {
		await this.existing(customerId);
		return this.book.add(customerId, body);
	}

	@Put(':addressId')
	@RequirePermissions('customer.update')
	@ApiOperation({
		operationId: 'replaceCustomerCheckedAddress',
		summary: 'Replace a customer’s saved address, checked',
	})
	async replace(
		@Param('customerId') customerId: string,
		@Param('addressId') addressId: string,
		@Body(new ZodValidationPipe(SavedAddressWrite)) body: SavedAddressWrite,
	): Promise<Customer> {
		await this.existing(customerId);
		return this.book.replace(customerId, addressId, body);
	}
}
