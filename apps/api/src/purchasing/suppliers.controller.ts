import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	GST_STATES,
	SupplierGstinCheckQuery,
	SupplierItemCodeWrite,
	SupplierListQuery,
	SupplierWrite,
} from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { actorOf } from './purchasing-support';
import { SuppliersService } from './suppliers.service';

/** Suppliers (s01–s03). */
@ApiTags(API_TAGS.purchases)
@Audience('admin')
@Controller('admin/suppliers')
export class SuppliersController {
	constructor(private readonly suppliers: SuppliersService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('supplier.index')
	@ApiOperation({
		operationId: 'listSuppliers',
		summary: 'Suppliers with what is owed, filters All / Owed money / Inactive',
	})
	list(@Query(new ZodValidationPipe(SupplierListQuery)) query: SupplierListQuery) {
		return this.suppliers.list(query);
	}

	@Get('states')
	@Header('Cache-Control', 'private, max-age=3600')
	@RequirePermissions('supplier.index')
	@ApiOperation({ operationId: 'gstStates', summary: 'GST State codes and names, for the supplier form' })
	states() {
		return GST_STATES.filter((state) => !state.retired).map((state) => ({ code: state.code, name: state.name }));
	}

	@Get('gstin-check')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('supplier.index')
	@ApiOperation({
		operationId: 'checkSupplierGstin',
		summary: 'Check digit, State, PAN, and suppliers already using it',
	})
	checkGstin(@Query(new ZodValidationPipe(SupplierGstinCheckQuery)) query: SupplierGstinCheckQuery) {
		return this.suppliers.checkGstin(query.gstin, query.excludeId ?? null);
	}

	@Get(':id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('supplier.index')
	@ApiOperation({ operationId: 'getSupplier', summary: 'One supplier for the form' })
	get(@Param('id') id: string) {
		return this.suppliers.get(id);
	}

	@Get(':id/summary')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('supplier.index')
	@ApiOperation({ operationId: 'getSupplierSummary', summary: 'Supplier page tiles and statement' })
	summary(@Param('id') id: string) {
		return this.suppliers.summary(id);
	}

	@Get(':id/activity')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('supplier.index')
	@ApiOperation({ operationId: 'supplierActivity', summary: 'The audit trail in sentences' })
	activity(@Param('id') id: string) {
		return this.suppliers.activity(id);
	}

	@Post()
	@HttpCode(200)
	@RequirePermissions('supplier.create')
	@ApiOperation({ operationId: 'createSupplier', summary: 'Add a supplier; the same GSTIN twice is refused' })
	create(
		@Body(new ZodValidationPipe(SupplierWrite)) body: SupplierWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.suppliers.create(body, actorOf(principal));
	}

	@Put(':id')
	@RequirePermissions('supplier.edit')
	@ApiOperation({ operationId: 'updateSupplier', summary: 'Change a supplier; posted bills keep their tax' })
	update(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(SupplierWrite)) body: SupplierWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.suppliers.update(id, body, actorOf(principal));
	}

	@Post(':id/item-codes')
	@HttpCode(204)
	@RequirePermissions('supplier.edit')
	@ApiOperation({
		operationId: 'rememberSupplierItemCode',
		summary: "Link one of the supplier's own codes to a variant",
	})
	rememberCode(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(SupplierItemCodeWrite)) body: SupplierItemCodeWrite,
	) {
		return this.suppliers.rememberCode(id, body.code, body.variantId);
	}

	@Delete(':id')
	@HttpCode(204)
	@RequirePermissions('supplier.destroy')
	@ApiOperation({ operationId: 'deleteSupplier', summary: 'Soft delete; refused while it has entries or orders' })
	remove(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.suppliers.remove(id, actorOf(principal));
	}
}
