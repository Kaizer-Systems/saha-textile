import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	PurchaseItemSearchQuery,
	PurchaseOrderClose,
	PurchaseOrderListQuery,
	PurchaseOrderSend,
	PurchaseOrderWrite,
} from '@saha-textile/contracts';
import type { FastifyReply } from 'fastify';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { PurchaseItemsService } from './purchase-items.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { actorOf } from './purchasing-support';

/** Purchase orders (po01–po05). */
@ApiTags(API_TAGS.purchases)
@Audience('admin')
@Controller('admin/purchase-orders')
export class PurchaseOrdersController {
	constructor(
		private readonly orders: PurchaseOrdersService,
		private readonly items: PurchaseItemsService,
	) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('purchase_order.index')
	@ApiOperation({ operationId: 'listPurchaseOrders', summary: 'Orders with late badges and filter counts' })
	list(@Query(new ZodValidationPipe(PurchaseOrderListQuery)) query: PurchaseOrderListQuery) {
		return this.orders.list(query);
	}

	@Get('items/search')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('purchase_order.create')
	@ApiOperation({
		operationId: 'searchPurchaseOrderItems',
		summary: "Find by SKU, name, barcode or the supplier's own code",
	})
	search(@Query(new ZodValidationPipe(PurchaseItemSearchQuery)) query: PurchaseItemSearchQuery) {
		return this.items.search(query);
	}

	@Get(':id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('purchase_order.index')
	@ApiOperation({ operationId: 'getPurchaseOrder', summary: 'One order: ordered, received and still to come' })
	get(@Param('id') id: string) {
		return this.orders.get(id);
	}

	@Get(':id/activity')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('purchase_order.index')
	@ApiOperation({ operationId: 'purchaseOrderActivity', summary: 'The audit trail in sentences' })
	activity(@Param('id') id: string) {
		return this.orders.activity(id);
	}

	@Get(':id/receive-draft')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('purchase.create')
	@ApiOperation({
		operationId: 'purchaseOrderReceiveDraft',
		summary: 'A purchase entry filled with what is still to come',
	})
	receiveDraft(@Param('id') id: string) {
		return this.orders.receiveDraft(id);
	}

	@Get(':id/pdf')
	@RequirePermissions('purchase_order.index')
	@ApiOperation({ operationId: 'purchaseOrderPdf', summary: 'The order as a PDF (vendor invoice template)' })
	async pdf(@Param('id') id: string, @Res() reply: FastifyReply) {
		const file = await this.orders.pdf(id);
		void reply
			.header('Content-Type', 'application/pdf')
			.header('Content-Disposition', `attachment; filename="${file.fileName}"`)
			.header('Cache-Control', 'no-store')
			.send(Buffer.from(file.data));
	}

	@Post()
	@HttpCode(200)
	@RequirePermissions('purchase_order.create')
	@ApiOperation({ operationId: 'createPurchaseOrder', summary: 'A new draft order with its number' })
	create(
		@Body(new ZodValidationPipe(PurchaseOrderWrite)) body: PurchaseOrderWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.orders.create(body, actorOf(principal));
	}

	@Put(':id')
	@RequirePermissions('purchase_order.create')
	@ApiOperation({ operationId: 'updatePurchaseOrder', summary: 'Change a draft order' })
	update(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(PurchaseOrderWrite)) body: PurchaseOrderWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.orders.update(id, body, actorOf(principal));
	}

	@Delete(':id')
	@HttpCode(204)
	@RequirePermissions('purchase_order.create')
	@ApiOperation({ operationId: 'deletePurchaseOrder', summary: 'Delete a draft order' })
	remove(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.orders.remove(id, actorOf(principal));
	}

	@Post(':id/copy')
	@HttpCode(200)
	@RequirePermissions('purchase_order.create')
	@ApiOperation({ operationId: 'copyPurchaseOrder', summary: 'Copy as a new draft' })
	copy(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.orders.copy(id, actorOf(principal));
	}

	@Post(':id/send')
	@HttpCode(200)
	@RequirePermissions('purchase_order.send')
	@ApiOperation({ operationId: 'sendPurchaseOrder', summary: 'Email with the PDF, or mark sent after a download' })
	send(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(PurchaseOrderSend)) body: PurchaseOrderSend,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.orders.send(id, body, actorOf(principal));
	}

	@Post(':id/close')
	@HttpCode(200)
	@RequirePermissions('purchase_order.cancel')
	@ApiOperation({ operationId: 'closePurchaseOrderShort', summary: 'Close with what is short' })
	close(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(PurchaseOrderClose)) body: PurchaseOrderClose,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.orders.closeShort(id, body.reason, actorOf(principal));
	}

	@Post(':id/cancel')
	@HttpCode(200)
	@RequirePermissions('purchase_order.cancel')
	@ApiOperation({ operationId: 'cancelPurchaseOrder', summary: 'Cancel before anything is received' })
	cancel(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(PurchaseOrderClose)) body: PurchaseOrderClose,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.orders.cancel(id, body.reason, actorOf(principal));
	}
}
