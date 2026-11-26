import { Body, Controller, Delete, Get, Header, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminShopEventListQuery, ProductSaleWrite, ShopEventCreate, ShopEventWrite } from '@saha-textile/contracts';
import type { AdminUserRepository } from '@saha-textile/core-domain';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ADMIN_USER_REPOSITORY } from '../infra/tokens';
import { API_TAGS } from '../openapi-tags';
import { EventProductsService } from './event-products.service';
import { EventsAdminService } from './events-admin.service';

const actor = (principal: AuthenticatedPrincipal | undefined) => principal?.userId ?? null;

/**
 * Launch and sale events for the admin. Publish has its own permission, so a staff member can
 * prepare an event that only the owner sends out; cancelling and ending have theirs too.
 */
@ApiTags(API_TAGS.events)
@Audience('admin')
@Controller('admin/events')
export class AdminEventsController {
	constructor(
		private readonly events: EventsAdminService,
		@Inject(ADMIN_USER_REPOSITORY) private readonly admins: AdminUserRepository,
		private readonly saleProducts: EventProductsService,
	) {}

	/**
	 * Put on sale from the product list: products join a sale that has not ended, or a new draft
	 * sale made for them. Joining a sale needs the right to edit events; a new sale, to add them.
	 * `dryRun` shows every price and every product left out, and changes nothing.
	 */
	@Post('sale-products')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('event.index', 'product.index')
	@ApiOperation({ operationId: 'addProductsToSale', summary: 'Put products on sale from the product list' })
	addProducts(
		@Body(new ZodValidationPipe(ProductSaleWrite)) body: ProductSaleWrite,
		@Principal() principal: AuthenticatedPrincipal,
	) {
		return this.saleProducts.addProducts(body, principal);
	}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('event.index')
	@ApiOperation({ operationId: 'listAdminShopEvents', summary: 'Every event, any state' })
	list(@Query(new ZodValidationPipe(AdminShopEventListQuery)) query: AdminShopEventListQuery) {
		return this.events.list(query);
	}

	@Get('category-products/:categoryId')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('event.index')
	@ApiOperation({ operationId: 'listShopEventCategoryProducts', summary: 'A category’s products and SKU prices' })
	categoryProducts(@Param('categoryId') categoryId: string) {
		return this.events.categoryProducts(categoryId);
	}

	@Get(':id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('event.index')
	@ApiOperation({ operationId: 'getAdminShopEvent', summary: 'One event for the form' })
	detail(@Param('id') id: string) {
		return this.events.detail(id);
	}

	@Get(':id/review')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('event.index')
	@ApiOperation({ operationId: 'reviewShopEvent', summary: 'Items, final prices, what stops Publish, and the reach' })
	review(@Param('id') id: string) {
		return this.events.review(id);
	}

	@Post()
	@HttpCode(200)
	@RequirePermissions('event.create')
	@ApiOperation({ operationId: 'createShopEvent', summary: 'Add a launch or a sale; it starts as a draft' })
	create(
		@Body(new ZodValidationPipe(ShopEventCreate)) body: ShopEventCreate,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.events.create(body, actor(principal));
	}

	@Post(':id/publish')
	@HttpCode(200)
	@RequirePermissions('event.publish')
	@ApiOperation({
		operationId: 'publishShopEvent',
		summary: 'Arm the event and send its message, or list what stops it',
	})
	publish(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.events.publish(id, actor(principal));
	}

	@Post(':id/unpublish')
	@HttpCode(200)
	@RequirePermissions('event.publish')
	@ApiOperation({ operationId: 'unpublishShopEvent', summary: 'Back to draft before the start' })
	unpublish(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.events.unpublish(id, actor(principal));
	}

	@Post(':id/cancel')
	@HttpCode(200)
	@RequirePermissions('event.cancel')
	@ApiOperation({
		operationId: 'cancelShopEvent',
		summary: 'Cancel for good; a running sale’s prices go back at once',
	})
	cancel(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.events.cancel(id, actor(principal));
	}

	@Post(':id/end-now')
	@HttpCode(200)
	@RequirePermissions('event.cancel')
	@ApiOperation({ operationId: 'endShopEventNow', summary: 'End a running sale now and keep its record' })
	endNow(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.events.endNow(id, actor(principal));
	}

	@Post(':id/preview')
	@HttpCode(200)
	@RequirePermissions('event.index')
	@ApiOperation({
		operationId: 'previewShopEventLink',
		summary: 'A 30-minute link that opens the event popup on the shop',
	})
	preview(@Param('id') id: string) {
		return this.events.previewLink(id);
	}

	@Post(':id/test-message')
	@HttpCode(200)
	@RequirePermissions('event.edit')
	@ApiOperation({ operationId: 'testShopEventMessage', summary: 'Send the message to the signed-in admin' })
	async test(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		const admin = principal ? await this.admins.findById(principal.userId) : null;
		return this.events.sendTest(id, admin?.email ?? null);
	}

	@Post(':id')
	@HttpCode(200)
	@RequirePermissions('event.edit')
	@ApiOperation({ operationId: 'updateShopEvent', summary: 'Save the event form' })
	update(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(ShopEventWrite)) body: ShopEventWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.events.update(id, body, actor(principal));
	}

	@Delete(':id')
	@HttpCode(204)
	@RequirePermissions('event.destroy')
	@ApiOperation({ operationId: 'deleteShopEvent', summary: 'Delete a draft' })
	remove(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.events.remove(id, actor(principal));
	}
}
