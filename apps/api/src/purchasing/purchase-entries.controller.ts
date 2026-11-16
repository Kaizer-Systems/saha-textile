import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	DraftProductDefaultsQuery,
	DraftProductFromLine,
	PurchaseEntryListQuery,
	PurchaseEntryWrite,
	PurchaseGoodsCheck,
	PurchaseImportRequest,
	PurchaseItemSearchQuery,
	PurchaseItemsByVariantQuery,
	PurchasePost,
	PurchaseVoid,
	SupplierPaymentReverse,
	SupplierPaymentWrite,
	VariantGridQuery,
} from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { PurchaseEntriesService } from './purchase-entries.service';
import { PurchaseItemsService } from './purchase-items.service';
import { actorOf } from './purchasing-support';

/** Items for purchase lines: search, variant grid, spreadsheet import, draft products (p03–p05, p13). */
@ApiTags(API_TAGS.purchases)
@Audience('admin')
@Controller('admin/purchases/items')
export class PurchaseItemsController {
	constructor(private readonly items: PurchaseItemsService) {}

	@Get('search')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('purchase.index')
	@ApiOperation({
		operationId: 'searchPurchaseItems',
		summary: "Find by SKU, name, barcode or the supplier's own code",
	})
	search(@Query(new ZodValidationPipe(PurchaseItemSearchQuery)) query: PurchaseItemSearchQuery) {
		return this.items.search(query);
	}

	@Get('by-variants')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('purchase.index')
	@ApiOperation({
		operationId: 'purchaseItemsByVariant',
		summary: 'Item details for lines that arrive as variant ids (receiving an order)',
	})
	byVariants(@Query(new ZodValidationPipe(PurchaseItemsByVariantQuery)) query: PurchaseItemsByVariantQuery) {
		return this.items.byVariants(query.ids, query.supplierId ?? null);
	}

	@Get('products/:productId/variants')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('purchase.index')
	@ApiOperation({
		operationId: 'purchaseVariantGrid',
		summary: 'Every colour or size of a product, for the variant grid',
	})
	variants(
		@Param('productId') productId: string,
		@Query(new ZodValidationPipe(VariantGridQuery)) query: VariantGridQuery,
	) {
		return this.items.variantGrid(productId, query.supplierId ?? null);
	}

	@Post('import')
	@HttpCode(200)
	@RequirePermissions('purchase.create')
	@ApiOperation({
		operationId: 'matchPurchaseImport',
		summary: "Match a supplier spreadsheet's rows; only clean rows are ready",
	})
	importRows(@Body(new ZodValidationPipe(PurchaseImportRequest)) body: PurchaseImportRequest) {
		return this.items.importRows(body);
	}

	@Get('draft-product-defaults')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('purchase.create', 'product.create')
	@ApiOperation({
		operationId: 'draftProductDefaults',
		summary: 'Next SKU, HSN and returnability a draft product would get',
	})
	draftDefaults(@Query(new ZodValidationPipe(DraftProductDefaultsQuery)) query: DraftProductDefaultsQuery) {
		return this.items.draftProductDefaults(query.categoryId);
	}

	@Post('draft-product')
	@HttpCode(200)
	@RequirePermissions('purchase.create', 'product.create')
	@ApiOperation({
		operationId: 'createDraftProductFromLine',
		summary: 'Make a draft product for a new design on the bill',
	})
	draftProduct(
		@Body(new ZodValidationPipe(DraftProductFromLine)) body: DraftProductFromLine,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.items.createDraftProduct(body, actorOf(principal));
	}
}

/** Purchase entries: a supplier's bill from draft to stock and payment (p01–p12). */
@ApiTags(API_TAGS.purchases)
@Audience('admin')
@Controller('admin/purchases/entries')
export class PurchaseEntriesController {
	constructor(private readonly entries: PurchaseEntriesService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('purchase.index')
	@ApiOperation({
		operationId: 'listPurchaseEntries',
		summary: 'Entries with stock and payment status, and the tiles',
	})
	list(@Query(new ZodValidationPipe(PurchaseEntryListQuery)) query: PurchaseEntryListQuery) {
		return this.entries.list(query);
	}

	@Get(':id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('purchase.index')
	@ApiOperation({ operationId: 'getPurchaseEntry', summary: 'One entry; cost and margin only with stock.cost' })
	get(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.entries.get(id, principal);
	}

	@Post()
	@HttpCode(200)
	@RequirePermissions('purchase.create')
	@ApiOperation({ operationId: 'createPurchaseEntry', summary: 'Save a new draft; the same bill twice is refused' })
	create(
		@Body(new ZodValidationPipe(PurchaseEntryWrite)) body: PurchaseEntryWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.entries.create(body, principal);
	}

	@Put(':id')
	@RequirePermissions('purchase.create')
	@ApiOperation({
		operationId: 'updatePurchaseEntry',
		summary: 'Save a draft; a stale copy is refused with who changed it',
	})
	update(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(PurchaseEntryWrite)) body: PurchaseEntryWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.entries.update(id, body, principal);
	}

	@Delete(':id')
	@HttpCode(204)
	@RequirePermissions('purchase.create')
	@ApiOperation({ operationId: 'deletePurchaseEntry', summary: 'Delete a draft (a posted entry is voided instead)' })
	remove(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.entries.remove(id, actorOf(principal));
	}

	@Post(':id/goods-check')
	@HttpCode(200)
	@RequirePermissions('purchase.check')
	@ApiOperation({ operationId: 'checkPurchaseGoods', summary: 'Good, damaged and missing per line' })
	checkGoods(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(PurchaseGoodsCheck)) body: PurchaseGoodsCheck,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.entries.checkGoods(id, body, principal);
	}

	@Get(':id/post-preview')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('purchase.post')
	@ApiOperation({
		operationId: 'previewPurchasePost',
		summary: 'What posting will change, and the warnings to accept',
	})
	postPreview(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.entries.postPreview(id, principal);
	}

	@Post(':id/post')
	@HttpCode(200)
	@RequirePermissions('purchase.post')
	@ApiOperation({
		operationId: 'postPurchaseEntry',
		summary: 'Post to stock; the same request key never posts twice',
	})
	post(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(PurchasePost)) body: PurchasePost,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.entries.post(id, body, principal);
	}

	@Post(':id/void')
	@HttpCode(200)
	@RequirePermissions('purchase.void')
	@ApiOperation({ operationId: 'voidPurchaseEntry', summary: 'Void while nothing from it has moved on' })
	void(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(PurchaseVoid)) body: PurchaseVoid,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.entries.void(id, body, actorOf(principal));
	}

	@Get(':id/payments')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('purchase.index')
	@ApiOperation({ operationId: 'listPurchasePayments', summary: 'Payments recorded against the entry' })
	payments(@Param('id') id: string) {
		return this.entries.paymentsFor(id);
	}

	@Post(':id/payments')
	@HttpCode(200)
	@RequirePermissions('purchase.payment')
	@ApiOperation({ operationId: 'recordPurchasePayment', summary: 'Record a full or part payment' })
	recordPayment(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(SupplierPaymentWrite)) body: SupplierPaymentWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.entries.recordPayment(id, body, actorOf(principal));
	}

	@Post(':id/payments/:paymentId/reverse')
	@HttpCode(200)
	@RequirePermissions('purchase.payment')
	@ApiOperation({ operationId: 'reversePurchasePayment', summary: 'Reverse a payment with a reason' })
	reversePayment(
		@Param('id') id: string,
		@Param('paymentId') paymentId: string,
		@Body(new ZodValidationPipe(SupplierPaymentReverse)) body: SupplierPaymentReverse,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.entries.reversePayment(id, paymentId, body.reason, actorOf(principal));
	}

	@Get(':id/activity')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('purchase.index')
	@ApiOperation({ operationId: 'purchaseEntryActivity', summary: 'The audit trail in sentences (p10b)' })
	activity(@Param('id') id: string) {
		return this.entries.activity(id);
	}
}
