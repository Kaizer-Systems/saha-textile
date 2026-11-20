import { Body, Controller, Get, Header, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	AdminCartWrite,
	AdminProductCardQuery,
	EInvoiceWrite,
	EWayBillWrite,
	InvoiceAddressWrite,
	ManualPaymentWrite,
	MarkPaymentReceivedWrite,
	OrderCommentWrite,
	OrderListQuery,
	StatusChangeWrite,
} from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { AdminCartService } from './admin-cart.service';
import { AdminOrdersService, type Actor } from './admin-orders.service';

const actorOf = (principal: AuthenticatedPrincipal | undefined): Actor => ({
	id: principal?.userId ?? null,
	name: null,
});

/**
 * Admin › Orders (brief ol02–ol04, oc01–oc03, od05–od08, st01–st05): the list with search and date
 * range, the create-order cart and zone-priced cards, and the order page's actions.
 */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/orders')
export class AdminOrdersController {
	constructor(
		private readonly cart: AdminCartService,
		private readonly orders: AdminOrdersService,
	) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('order.index')
	@ApiOperation({
		operationId: 'listAdminOrders',
		summary: 'Orders with search, filters, date range and the four tiles',
	})
	list(@Query(new ZodValidationPipe(OrderListQuery)) query: OrderListQuery) {
		return this.orders.list(query);
	}

	@Post('cart')
	@HttpCode(200)
	@RequirePermissions('order.create')
	@ApiOperation({
		operationId: 'priceAdminCart',
		summary: 'Price the create-order cart for the chosen buyer and currency (zone prices for businesses)',
	})
	priceCart(@Body(new ZodValidationPipe(AdminCartWrite)) body: AdminCartWrite) {
		return this.cart.price(body);
	}

	@Get('cards')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('order.create')
	@ApiOperation({
		operationId: 'listAdminProductCards',
		summary: 'Product cards priced for the buyer; a product the zone does not price is greyed',
	})
	cards(@Query(new ZodValidationPipe(AdminProductCardQuery)) query: AdminProductCardQuery) {
		return this.cart.cards(query);
	}

	@Get(':id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('order.index')
	@ApiOperation({ operationId: 'getAdminOrder', summary: 'Everything the order page shows, in one read' })
	detail(@Param('id') id: string) {
		return this.orders.detail(id);
	}

	@Post(':id/status')
	@HttpCode(200)
	@RequirePermissions('order.update')
	@ApiOperation({ operationId: 'changeAdminOrderStatus', summary: 'Move the order one step on the status machine' })
	changeStatus(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(StatusChangeWrite)) body: StatusChangeWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.orders.changeStatus(id, body, actorOf(principal));
	}

	@Post(':id/comments')
	@HttpCode(200)
	@RequirePermissions('order.edit')
	@ApiOperation({ operationId: 'commentOnAdminOrder', summary: 'Add a staff comment to the order history' })
	comment(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(OrderCommentWrite)) body: OrderCommentWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.orders.comment(id, body.comment, body.revision, actorOf(principal));
	}

	@Put(':id/invoice-address')
	@RequirePermissions('order.address')
	@ApiOperation({
		operationId: 'setOrderInvoiceAddress',
		summary: 'Add the staff-only Indian invoice address (od04)',
	})
	invoiceAddress(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(InvoiceAddressWrite)) body: InvoiceAddressWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.orders.setInvoiceAddress(id, body, actorOf(principal));
	}

	@Get(':id/payments/prefill')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('order.payment')
	@ApiOperation({
		operationId: 'adminPaymentPrefill',
		summary: 'The amount the Record payment popup opens with (amount due now)',
	})
	prefill(@Param('id') id: string) {
		return this.orders.paymentPrefill(id);
	}

	@Post(':id/payments')
	@HttpCode(200)
	@RequirePermissions('order.payment')
	@ApiOperation({
		operationId: 'recordAdminPayment',
		summary: 'Record a payment typed by hand (UPI, bank transfer, cash on delivery)',
	})
	recordPayment(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(ManualPaymentWrite)) body: ManualPaymentWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.orders.recordPayment(id, body, actorOf(principal));
	}

	@Post(':id/payments/:paymentId/received')
	@HttpCode(200)
	@RequirePermissions('order.payment')
	@ApiOperation({
		operationId: 'markAdminPaymentReceived',
		summary: 'Mark a bank transfer that has now arrived as received',
	})
	markReceived(
		@Param('id') id: string,
		@Param('paymentId') paymentId: string,
		@Body(new ZodValidationPipe(MarkPaymentReceivedWrite)) body: MarkPaymentReceivedWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.orders.markReceived(id, paymentId, body, actorOf(principal));
	}

	@Post(':id/e-invoice/raise')
	@HttpCode(200)
	@RequirePermissions('order.edit')
	@ApiOperation({
		operationId: 'raiseOrderEInvoice',
		summary: 'Raise the e-invoice (not connected: type it by hand)',
	})
	raiseEInvoice(@Param('id') id: string, @Principal() principal?: AuthenticatedPrincipal) {
		return this.orders.raise(id, 'eInvoice', actorOf(principal));
	}

	@Put(':id/e-invoice')
	@RequirePermissions('order.edit')
	@ApiOperation({ operationId: 'setOrderEInvoice', summary: 'Type the e-invoice IRN, Ack No and date by hand' })
	setEInvoice(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(EInvoiceWrite)) body: EInvoiceWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.orders.setEInvoice(id, body, actorOf(principal));
	}

	@Post(':id/e-way-bill/raise')
	@HttpCode(200)
	@RequirePermissions('order.edit')
	@ApiOperation({
		operationId: 'raiseOrderEWayBill',
		summary: 'Raise the e-way bill (not connected: type it by hand)',
	})
	raiseEWayBill(@Param('id') id: string, @Principal() principal?: AuthenticatedPrincipal) {
		return this.orders.raise(id, 'eWayBill', actorOf(principal));
	}

	@Put(':id/e-way-bill')
	@RequirePermissions('order.edit')
	@ApiOperation({ operationId: 'setOrderEWayBill', summary: 'Type the e-way bill details by hand' })
	setEWayBill(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(EWayBillWrite)) body: EWayBillWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.orders.setEWayBill(id, body, actorOf(principal));
	}
}
