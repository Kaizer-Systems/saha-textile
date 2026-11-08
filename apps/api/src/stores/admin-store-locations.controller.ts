import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	StoreLocationActiveWrite,
	StoreLocationOrderWrite,
	StoreLocationWrite,
	type StoreLocationWriteParsed,
} from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { StoreLocationsAdminService } from './store-locations-admin.service';

const actor = (principal: AuthenticatedPrincipal | undefined) => principal?.userId ?? null;

/**
 * Settings › Stores. Super admin only for now (owner, 2026-11-08): reading needs `setting.index`,
 * every change `setting.edit`, the same codes Brand Kit and the other Settings screens check.
 */
@ApiTags(API_TAGS.stores)
@Audience('admin')
@Controller('admin/store-locations')
export class AdminStoreLocationsController {
	constructor(private readonly stores: StoreLocationsAdminService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('setting.index')
	@ApiOperation({ operationId: 'listAdminStoreLocations', summary: 'Every store in display order, active or not' })
	list() {
		return this.stores.list();
	}

	@Get(':id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('setting.index')
	@ApiOperation({ operationId: 'getAdminStoreLocation', summary: 'One store with every language, for the form' })
	detail(@Param('id') id: string) {
		return this.stores.detail(id);
	}

	@Post()
	@HttpCode(200)
	@RequirePermissions('setting.edit')
	@ApiOperation({ operationId: 'createStoreLocation', summary: 'Add a store; it goes last in the order' })
	create(
		@Body(new ZodValidationPipe(StoreLocationWrite)) body: StoreLocationWriteParsed,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.stores.create(body, actor(principal));
	}

	@Post('order')
	@HttpCode(200)
	@RequirePermissions('setting.edit')
	@ApiOperation({ operationId: 'reorderStoreLocations', summary: 'Save the order dragged in the list' })
	async reorder(
		@Body(new ZodValidationPipe(StoreLocationOrderWrite)) body: StoreLocationOrderWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		await this.stores.reorder(body.ids, actor(principal));
		return { ok: true };
	}

	@Post(':id/active')
	@HttpCode(200)
	@RequirePermissions('setting.edit')
	@ApiOperation({ operationId: 'setStoreLocationActive', summary: "The list's switch: show or hide on Contact Us" })
	active(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(StoreLocationActiveWrite)) body: StoreLocationActiveWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.stores.setActive(id, body.active, actor(principal));
	}

	@Post(':id')
	@HttpCode(200)
	@RequirePermissions('setting.edit')
	@ApiOperation({ operationId: 'updateStoreLocation', summary: 'Save the store form' })
	update(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(StoreLocationWrite)) body: StoreLocationWriteParsed,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.stores.update(id, body, actor(principal));
	}

	@Delete(':id')
	@HttpCode(200)
	@RequirePermissions('setting.edit')
	@ApiOperation({
		operationId: 'deleteStoreLocation',
		summary: 'Delete a store; its photos stay in the media library',
	})
	async remove(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		await this.stores.remove(id, actor(principal));
		return { ok: true };
	}
}
