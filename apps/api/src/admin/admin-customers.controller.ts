import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	CreateCustomerAddressRequest,
	CreateCustomerRequest,
	type Customer,
	CustomerListQuery,
	type CustomerListResponse,
	CustomerOrdersQuery,
	type CustomerOrdersResponse,
	ResendCustomerActivationRequest,
	UpdateCustomerAddressRequest,
	UpdateCustomerRequest,
} from '@saha-textile/contracts';

import { Audience, RequirePermissions } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { AdminCustomersService } from './admin-customers.service';

/**
 * Admin Customer CRM — directory, create/activate, profile/address edits, soft-delete.
 *
 * Operators only reach this surface (`DEC-ACCOUNT-SEPARATION` D3). Storefront customers
 * never share `/admin/users/**`; those codes stay operator-scoped.
 */
@ApiTags(API_TAGS.auth)
@Audience('admin')
@Controller('admin/customers')
export class AdminCustomersController {
	constructor(private readonly customers: AdminCustomersService) {}

	@Get()
	@RequirePermissions('customer.index')
	@ApiOperation({ operationId: 'listCustomers', summary: 'Paginated customer directory (optional search/status)' })
	list(@Query(new ZodValidationPipe(CustomerListQuery)) query: CustomerListQuery): Promise<CustomerListResponse> {
		return this.customers.list(query);
	}

	@Post()
	@RequirePermissions('customer.create')
	@ApiOperation({
		operationId: 'createCustomer',
		summary: 'Create a customer without password; mint activation on selected channels',
	})
	create(@Body(new ZodValidationPipe(CreateCustomerRequest)) body: CreateCustomerRequest): Promise<Customer> {
		return this.customers.create(body);
	}

	@Get(':customerId')
	@RequirePermissions('customer.index')
	@ApiOperation({ operationId: 'getCustomer', summary: 'Customer detail' })
	get(@Param('customerId') customerId: string): Promise<Customer> {
		return this.customers.get(customerId);
	}

	@Get(':customerId/orders')
	@RequirePermissions('customer.index')
	@ApiOperation({ operationId: 'listCustomerOrders', summary: 'List orders for a specific customer' })
	listOrders(
		@Param('customerId') customerId: string,
		@Query(new ZodValidationPipe(CustomerOrdersQuery)) query: CustomerOrdersQuery,
	): Promise<CustomerOrdersResponse> {
		return this.customers.listOrders(customerId, query);
	}

	@Patch(':customerId')
	@RequirePermissions('customer.update')
	@ApiOperation({ operationId: 'updateCustomer', summary: 'Patch customer profile fields' })
	update(
		@Param('customerId') customerId: string,
		@Body(new ZodValidationPipe(UpdateCustomerRequest)) body: UpdateCustomerRequest,
	): Promise<Customer> {
		return this.customers.update(customerId, body);
	}

	@Delete(':customerId')
	@RequirePermissions('customer.destroy')
	@ApiOperation({ operationId: 'deleteCustomer', summary: 'Soft-delete a customer (status deleted)' })
	softDelete(@Param('customerId') customerId: string): Promise<Customer> {
		return this.customers.softDelete(customerId);
	}

	@Post(':customerId/activation/resend')
	@RequirePermissions('customer.update')
	@ApiOperation({
		operationId: 'resendCustomerActivation',
		summary: 'Remint activation token and send on selected channels',
	})
	resend(
		@Param('customerId') customerId: string,
		@Body(new ZodValidationPipe(ResendCustomerActivationRequest)) body: ResendCustomerActivationRequest,
	): Promise<Customer> {
		return this.customers.resendActivation(customerId, body);
	}

	@Post(':customerId/addresses')
	@RequirePermissions('customer.update')
	@ApiOperation({ operationId: 'addCustomerAddress', summary: 'Add a saved address' })
	addAddress(
		@Param('customerId') customerId: string,
		@Body(new ZodValidationPipe(CreateCustomerAddressRequest)) body: CreateCustomerAddressRequest,
	): Promise<Customer> {
		return this.customers.addAddress(customerId, body);
	}

	@Patch(':customerId/addresses/:addressId')
	@RequirePermissions('customer.update')
	@ApiOperation({ operationId: 'updateCustomerAddress', summary: 'Patch a saved address' })
	updateAddress(
		@Param('customerId') customerId: string,
		@Param('addressId') addressId: string,
		@Body(new ZodValidationPipe(UpdateCustomerAddressRequest)) body: UpdateCustomerAddressRequest,
	): Promise<Customer> {
		return this.customers.updateAddress(customerId, addressId, body);
	}

	@Delete(':customerId/addresses/:addressId')
	@RequirePermissions('customer.update')
	@ApiOperation({ operationId: 'deleteCustomerAddress', summary: 'Remove a saved address' })
	deleteAddress(@Param('customerId') customerId: string, @Param('addressId') addressId: string): Promise<Customer> {
		return this.customers.deleteAddress(customerId, addressId);
	}
}
