import { Body, Controller, Get, Header, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	AdjustmentDecision,
	AdjustmentRequestListQuery,
	AgeingQuery,
	InventorySettingsWrite,
	ShopDetailsWrite,
	MovementReportQuery,
	OpeningStockCheck,
	OpeningStockPost,
	PurchaseRegisterQuery,
	ReorderToOrders,
	StockAdjustmentWrite,
	StockAlertsSeen,
	StockCountEntry,
	StockCountListQuery,
	StockCountRecount,
	StockCountStart,
	StockDetailQuery,
	StockHoldListQuery,
	StockListQuery,
	ValuationQuery,
} from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { InventorySettingsService } from './inventory-settings.service';
import { ShopDetailsService } from './shop-details.service';
import { OpeningStockService } from './opening-stock.service';
import { actorOf, canSeeCost, refuse } from './purchasing-support';
import { StockApprovalsService } from './stock-approvals.service';
import { StockCountsService } from './stock-counts.service';
import { StockReportsService } from './stock-reports.service';
import { StockService } from './stock.service';

/** Stock (i01–i06): All stock, history, cost layers, Adjust, held stock, the bell. */
@ApiTags(API_TAGS.stock)
@Audience('admin')
@Controller('admin/stock')
export class StockController {
	constructor(
		private readonly stock: StockService,
		private readonly approvals: StockApprovalsService,
	) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('stock.index')
	@ApiOperation({ operationId: 'listStock', summary: 'All stock with tiles; value only with stock.cost' })
	list(
		@Query(new ZodValidationPipe(StockListQuery)) query: StockListQuery,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.stock.list(query, principal);
	}

	@Get('alerts')
	@Header('Cache-Control', 'no-store')
	@ApiOperation({
		operationId: 'stockAlerts',
		summary: 'The bell: approvals waiting, my decisions, late orders, bills near the limit',
	})
	alerts(@Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.stock.alerts(principal);
	}

	@Post('alerts/seen')
	@HttpCode(204)
	@ApiOperation({ operationId: 'stockAlertsSeen', summary: 'Mark decisions on my own requests as seen' })
	seen(
		@Body(new ZodValidationPipe(StockAlertsSeen)) body: StockAlertsSeen,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.stock.markSeen(body.ids, principal);
	}

	@Get('held')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('stock.index')
	@ApiOperation({ operationId: 'listHeldStock', summary: 'Held pieces by reason, overdue past the reminder' })
	held(@Query(new ZodValidationPipe(StockHoldListQuery)) query: StockHoldListQuery) {
		return this.stock.heldList(query);
	}

	@Get('items/:variantId')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('stock.index')
	@ApiOperation({ operationId: 'stockItemDetail', summary: 'Stock history and cost layers of one item' })
	detail(
		@Param('variantId') variantId: string,
		@Query(new ZodValidationPipe(StockDetailQuery)) query: StockDetailQuery,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.stock.detail(variantId, query, principal);
	}

	@Get('items/:variantId/holds')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('stock.index')
	@ApiOperation({ operationId: 'stockItemHolds', summary: 'Open holds on one item' })
	holdsOf(@Param('variantId') variantId: string) {
		return this.stock.holdsOf(variantId);
	}

	@Post('adjustments/preview')
	@HttpCode(200)
	@RequirePermissions('stock.index')
	@ApiOperation({
		operationId: 'previewStockAdjustment',
		summary: 'What a change would do, whether it waits for approval, and why not',
	})
	preview(
		@Body(new ZodValidationPipe(StockAdjustmentWrite)) body: StockAdjustmentWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.stock.preview(body, principal);
	}

	@Post('adjustments')
	@HttpCode(200)
	@RequirePermissions('stock.adjust')
	@ApiOperation({ operationId: 'adjustStock', summary: 'Write off or add: applies for approvers, else a request' })
	adjust(
		@Body(new ZodValidationPipe(StockAdjustmentWrite)) body: StockAdjustmentWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		if (body.action !== 'remove' && body.action !== 'add') {
			throw refuse('wrong_route', 'Holds and releases go through the holds route.', 'action');
		}
		return this.stock.adjust(body, principal);
	}

	@Post('holds')
	@HttpCode(200)
	@RequirePermissions('stock.hold')
	@ApiOperation({ operationId: 'holdStock', summary: 'Move to held or release; never needs approval' })
	hold(
		@Body(new ZodValidationPipe(StockAdjustmentWrite)) body: StockAdjustmentWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		if (body.action !== 'hold' && body.action !== 'release') {
			throw refuse('wrong_route', 'Write-offs and additions go through the adjustments route.', 'action');
		}
		return this.stock.adjust(body, principal);
	}

	@Get('approvals')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('stock.approve')
	@ApiOperation({
		operationId: 'listStockApprovals',
		summary: 'Write-offs and count differences waiting, approved or rejected',
	})
	approvalsList(
		@Query(new ZodValidationPipe(AdjustmentRequestListQuery)) query: AdjustmentRequestListQuery,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.approvals.list(query, principal);
	}

	@Post('approvals/:id/approve')
	@HttpCode(200)
	@RequirePermissions('stock.approve')
	@ApiOperation({ operationId: 'approveStockRequest', summary: 'Approve; nobody decides their own request' })
	approve(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.approvals.approve(id, principal);
	}

	@Post('approvals/:id/reject')
	@HttpCode(200)
	@RequirePermissions('stock.approve')
	@ApiOperation({ operationId: 'rejectStockRequest', summary: 'Reject with a reason the requester sees' })
	reject(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(AdjustmentDecision)) body: AdjustmentDecision,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.approvals.reject(id, body.reason, principal);
	}
}

/** Stock counts (c01–c03, g02). */
@ApiTags(API_TAGS.stock)
@Audience('admin')
@Controller('admin/stock-counts')
export class StockCountsController {
	constructor(private readonly counts: StockCountsService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('stock_count.count')
	@ApiOperation({ operationId: 'listStockCounts', summary: 'Counting, to review, waiting for approval, posted' })
	list(@Query(new ZodValidationPipe(StockCountListQuery)) query: StockCountListQuery) {
		return this.counts.list(query);
	}

	@Get(':id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('stock_count.count')
	@ApiOperation({
		operationId: 'getStockCount',
		summary: 'One count; a blind count hides expected figures from counters',
	})
	get(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.counts.get(id, principal);
	}

	@Post()
	@HttpCode(200)
	@RequirePermissions('stock_count.create')
	@ApiOperation({ operationId: 'startStockCount', summary: 'Start a count; the shop keeps selling' })
	start(
		@Body(new ZodValidationPipe(StockCountStart)) body: StockCountStart,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.counts.start(body, actorOf(principal));
	}

	@Post(':id/entries')
	@HttpCode(200)
	@RequirePermissions('stock_count.count')
	@ApiOperation({ operationId: 'enterStockCount', summary: 'Counted figures from one phone or screen' })
	enter(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(StockCountEntry)) body: StockCountEntry,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.counts.enter(id, body, principal);
	}

	@Post(':id/finish')
	@HttpCode(200)
	@RequirePermissions('stock_count.post')
	@ApiOperation({ operationId: 'finishStockCount', summary: 'Counting done; the count goes to review' })
	finish(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.counts.finish(id, actorOf(principal));
	}

	@Post(':id/recount')
	@HttpCode(200)
	@RequirePermissions('stock_count.post')
	@ApiOperation({ operationId: 'recountStockCount', summary: 'Send differing lines back to the counters' })
	recount(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(StockCountRecount)) body: StockCountRecount,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.counts.recount(id, body.variantIds, actorOf(principal));
	}

	@Post(':id/post')
	@HttpCode(200)
	@RequirePermissions('stock_count.post')
	@ApiOperation({ operationId: 'postStockCount', summary: 'Post the differences, or send them for approval' })
	post(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.counts.post(id, principal);
	}
}

/** Opening stock (o01). */
@ApiTags(API_TAGS.stock)
@Audience('admin')
@Controller('admin/opening-stock')
export class OpeningStockController {
	constructor(private readonly opening: OpeningStockService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('stock.opening')
	@ApiOperation({ operationId: 'listOpeningStock', summary: 'Posted opening-stock loads' })
	list(@Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.opening.list(canSeeCost(principal));
	}

	@Post('check')
	@HttpCode(200)
	@RequirePermissions('stock.opening')
	@ApiOperation({ operationId: 'checkOpeningStock', summary: 'Ready, cost missing, unknown SKU, already has stock' })
	check(@Body(new ZodValidationPipe(OpeningStockCheck)) body: OpeningStockCheck) {
		return this.opening.check(body.rows);
	}

	@Post()
	@HttpCode(200)
	@RequirePermissions('stock.opening')
	@ApiOperation({ operationId: 'postOpeningStock', summary: 'Post when every row is ready; once per SKU' })
	post(
		@Body(new ZodValidationPipe(OpeningStockPost)) body: OpeningStockPost,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.opening.post(body.rows, body.requestKey, actorOf(principal));
	}
}

/** Reorder list and reports (i07–i10). */
@ApiTags(API_TAGS.stock)
@Audience('admin')
@Controller('admin/stock-reports')
export class StockReportsController {
	constructor(private readonly reports: StockReportsService) {}

	@Get('reorder')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('stock_report.index')
	@ApiOperation({ operationId: 'reorderList', summary: 'What to reorder and from whom' })
	reorder(@Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.reports.reorder(principal);
	}

	@Post('reorder/orders')
	@HttpCode(200)
	@RequirePermissions('stock_report.index', 'purchase_order.create')
	@ApiOperation({ operationId: 'reorderToOrders', summary: 'Ticked lines become one draft order per supplier' })
	toOrders(
		@Body(new ZodValidationPipe(ReorderToOrders)) body: ReorderToOrders,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.reports.reorderToOrders(body.lines, principal);
	}

	@Get('ageing')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('stock_report.index')
	@ApiOperation({ operationId: 'stockAgeing', summary: 'Value in age bands, oldest first' })
	ageing(
		@Query(new ZodValidationPipe(AgeingQuery)) query: AgeingQuery,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.reports.ageing(query, principal);
	}

	@Get('valuation')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('stock_report.index', 'stock.cost')
	@ApiOperation({ operationId: 'stockValuation', summary: 'Stock value at cost on any day' })
	valuation(@Query(new ZodValidationPipe(ValuationQuery)) query: ValuationQuery) {
		return this.reports.valuation(query.asOn, query.groupBy);
	}

	@Get('purchase-register')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('stock_report.index', 'purchase.index')
	@ApiOperation({ operationId: 'purchaseRegister', summary: 'Posted bills for the CA' })
	register(@Query(new ZodValidationPipe(PurchaseRegisterQuery)) query: PurchaseRegisterQuery) {
		return this.reports.purchaseRegister(query.from, query.to);
	}

	@Get('movements')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('stock_report.index')
	@ApiOperation({ operationId: 'stockMovements', summary: 'Every stock movement, filtered' })
	movements(@Query(new ZodValidationPipe(MovementReportQuery)) query: MovementReportQuery) {
		return this.reports.movements(query);
	}

	@Get('unpaid-bills')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('stock_report.index', 'purchase.index')
	@ApiOperation({ operationId: 'unpaidBills', summary: 'Unpaid bills, oldest first, near the 180-day rule' })
	unpaid() {
		return this.reports.unpaidBills();
	}
}

/** Settings › Purchases and stock (x02). */
@ApiTags(API_TAGS.stock)
@Audience('admin')
@Controller('admin/settings/inventory')
export class InventorySettingsController {
	constructor(private readonly settings: InventorySettingsService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('setting.index')
	@ApiOperation({ operationId: 'getInventorySettings', summary: 'Purchases and stock settings' })
	get(@Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.settings.view(principal?.role === 'admin');
	}

	@Post()
	@HttpCode(200)
	@RequirePermissions('setting.edit')
	@ApiOperation({ operationId: 'saveInventorySettings', summary: 'Save; every change is audited' })
	async save(
		@Body(new ZodValidationPipe(InventorySettingsWrite)) body: InventorySettingsWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		await this.settings.update(body, actorOf(principal), { superAdmin: principal?.role === 'admin' });
		return this.settings.view(principal?.role === 'admin');
	}
}

/** Settings › Shop details (X04–X04D, R3-1): read with Settings access, changed with Edit shop details. */
@ApiTags(API_TAGS.stock)
@Audience('admin')
@Controller('admin/settings/shop-details')
export class ShopDetailsController {
	constructor(private readonly shop: ShopDetailsService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('setting.index')
	@ApiOperation({ operationId: 'getShopDetails', summary: "The shop's name, GSTIN and address on documents" })
	get(@Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.shop.view(canEditShop(principal));
	}

	@Get('impact')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('shop_details.edit')
	@ApiOperation({ operationId: 'shopDetailsImpact', summary: 'What a new GSTIN changes: State and suppliers' })
	impact(@Query('gstin') gstin: string | undefined) {
		return this.shop.impact(gstin ?? '');
	}

	/**
	 * Gated on Settings access, not on the edit permission, so that a refused change reaches the
	 * service and is written to the audit log as an attempt.
	 */
	@Put()
	@RequirePermissions('setting.index')
	@ApiOperation({ operationId: 'saveShopDetails', summary: 'Save; every change is audited with old and new values' })
	async save(
		@Body(new ZodValidationPipe(ShopDetailsWrite)) body: ShopDetailsWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		await this.shop.update(body, actorOf(principal), { canEdit: canEditShop(principal) });
		return this.shop.view(canEditShop(principal));
	}
}

const canEditShop = (principal: AuthenticatedPrincipal | undefined): boolean =>
	!!principal?.permissions.includes('shop_details.edit');
