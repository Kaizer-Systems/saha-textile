import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	BusinessAddressWrite,
	BusinessReceiptWrite,
	AdminCartWrite,
	AdminOrderCreate,
	AdminOrderBuyerQuery,
	AdminProductCardQuery,
	AdminVariantChoiceQuery,
	CouponTryRequest,
	CustomerBuyerQuery,
	EInvoiceWrite,
	EWayBillWrite,
	InvoiceAddressWrite,
	ManualPaymentWrite,
	MarkPaymentReceivedWrite,
	OrderCommentWrite,
	PackTickWrite,
	OpenOrderAddLines,
	OpenOrderClose,
	OpenOrderRemoveLine,
	OrderListQuery,
	PaymentRequestPreviewQuery,
	PaymentRequestSendWrite,
	PaymentRequestWrite,
	StatusChangeWrite,
} from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { AdminCartService } from './admin-cart.service';
import { AdminOrderCreateService, type CheckoutRights } from './admin-order-create.service';
import { AdminOrdersService, type Actor } from './admin-orders.service';
import { BusinessAddressesService } from './business-addresses.service';
import { BusinessReceiptsService } from './business-receipts.service';
import { OpenOrdersService } from './open-orders.service';
import { PaymentRequestsService } from './payment-requests.service';

const actorOf = (principal: AuthenticatedPrincipal | undefined): Actor => ({
	id: principal?.userId ?? null,
	name: null,
});
const rightsOf = (principal: AuthenticatedPrincipal | undefined): CheckoutRights => ({
	belowCost: principal?.permissions.includes('stock.cost') ?? false,
	creditOverride: principal?.permissions.includes('business.approve') ?? false,
	keepOpen: principal?.permissions.includes('order.open') ?? false,
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
		private readonly checkout: AdminOrderCreateService,
		private readonly paymentRequests: PaymentRequestsService,
		private readonly openOrders: OpenOrdersService,
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

	@Get('cards/:productId/variants')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('order.create')
	@ApiOperation({
		operationId: 'listAdminVariantChoices',
		summary: 'A product’s variants priced for the buyer, for the variant picker on Create order',
	})
	variantChoices(
		@Param('productId') productId: string,
		@Query(new ZodValidationPipe(AdminVariantChoiceQuery)) query: AdminVariantChoiceQuery,
	) {
		return this.cart.variantChoices(productId, query);
	}

	@Get('customers')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('order.create')
	@ApiOperation({
		operationId: 'searchOrderCustomers',
		summary: 'Shop customers for the Create order picker, found by name, phone or email',
	})
	searchCustomers(@Query(new ZodValidationPipe(CustomerBuyerQuery)) query: CustomerBuyerQuery) {
		return this.checkout.searchCustomers(query.q, query.limit);
	}

	@Get('buyer-addresses')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('order.create')
	@ApiOperation({
		operationId: 'listOrderBuyerAddresses',
		summary: 'The chosen buyer’s saved addresses, for the checkout',
	})
	buyerAddresses(@Query(new ZodValidationPipe(AdminOrderBuyerQuery)) query: AdminOrderBuyerQuery) {
		return this.checkout.buyerAddresses(
			query.kind === 'person'
				? { kind: 'person', customerId: query.id }
				: { kind: 'business', businessId: query.id },
		);
	}

	@Post('checkout/coupons')
	@HttpCode(200)
	@RequirePermissions('order.create')
	@ApiOperation({
		operationId: 'listCheckoutCoupons',
		summary: 'Coupons this order can use, with what each would take off or why it cannot be used',
	})
	checkoutCoupons(
		@Body(new ZodValidationPipe(AdminOrderCreate)) body: AdminOrderCreate,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.checkout.couponOptions(body, rightsOf(principal));
	}

	@Post('checkout/quote')
	@HttpCode(200)
	@RequirePermissions('order.create')
	@ApiOperation({
		operationId: 'quoteAdminCheckout',
		summary: 'The checkout summary before placing: totals, shipping with its reason, coupons, credit, methods off',
	})
	quote(
		@Body(new ZodValidationPipe(AdminOrderCreate)) body: AdminOrderCreate,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.checkout.quote(body, rightsOf(principal));
	}

	@Post()
	@RequirePermissions('order.create')
	@ApiOperation({
		operationId: 'createAdminOrder',
		summary: 'Place an order for a shop customer or a business (its pieces are kept from now on)',
	})
	async create(
		@Body(new ZodValidationPipe(AdminOrderCreate)) body: AdminOrderCreate,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		const order = await this.checkout.create(body, actorOf(principal), rightsOf(principal));
		return this.orders.detail(order.id);
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

	@Put(':id/pack-ticks')
	@HttpCode(200)
	@RequirePermissions('order.update')
	@ApiOperation({ operationId: 'tickAdminOrderPackList', summary: 'Tick or untick one piece on the Pack list' })
	packTick(@Param('id') id: string, @Body(new ZodValidationPipe(PackTickWrite)) body: PackTickWrite) {
		return this.orders.packTick(id, body);
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

	@Get(':id/requests/preview')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('order.send')
	@ApiOperation({
		operationId: 'previewPaymentRequest',
		summary: 'What a payment request would be if sent now: gateway, rate, recipient, and why it cannot go',
	})
	previewRequest(
		@Param('id') id: string,
		@Query(new ZodValidationPipe(PaymentRequestPreviewQuery)) query: PaymentRequestPreviewQuery,
	) {
		return this.paymentRequests.preview(id, query);
	}

	@Post(':id/requests')
	@RequirePermissions('order.send')
	@ApiOperation({
		operationId: 'createPaymentRequest',
		summary: 'Ask the gateway to send its payment request (never more than is due)',
	})
	createRequest(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(PaymentRequestWrite)) body: PaymentRequestWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.paymentRequests.create(id, body, actorOf(principal));
	}

	@Post(':id/requests/:requestId/check')
	@HttpCode(200)
	@RequirePermissions('order.payment')
	@ApiOperation({ operationId: 'checkPaymentRequest', summary: 'Check payment status with the gateway now' })
	checkRequest(
		@Param('id') id: string,
		@Param('requestId') requestId: string,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.paymentRequests.check(id, requestId, actorOf(principal));
	}

	@Post(':id/requests/:requestId/cancel')
	@HttpCode(200)
	@RequirePermissions('order.send')
	@ApiOperation({
		operationId: 'cancelPaymentRequest',
		summary: 'Cancel the payment request (the link stops working)',
	})
	cancelRequest(
		@Param('id') id: string,
		@Param('requestId') requestId: string,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.paymentRequests.cancel(id, requestId, actorOf(principal));
	}

	@Get(':id/requests/:requestId/message')
	@RequirePermissions('order.send')
	@ApiOperation({
		operationId: 'previewPaymentRequestMessage',
		summary: 'The exact SMS or email before Send as SMS / Send as email (and why it can’t go)',
	})
	previewRequestMessage(
		@Param('id') id: string,
		@Param('requestId') requestId: string,
		@Query(new ZodValidationPipe(PaymentRequestSendWrite)) query: PaymentRequestSendWrite,
	) {
		return this.paymentRequests.messagePreview(id, requestId, query.channel);
	}

	@Post(':id/requests/:requestId/send')
	@HttpCode(200)
	@RequirePermissions('order.send')
	@ApiOperation({
		operationId: 'sendPaymentRequestMessage',
		summary: 'Send our own SMS or email about the request (only when pressed; never automatic)',
	})
	sendRequestMessage(
		@Param('id') id: string,
		@Param('requestId') requestId: string,
		@Body(new ZodValidationPipe(PaymentRequestSendWrite)) body: PaymentRequestSendWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.paymentRequests.sendMessage(id, requestId, body.channel, actorOf(principal));
	}

	@Post(':id/open/lines')
	@HttpCode(200)
	@RequirePermissions('order.open')
	@ApiOperation({ operationId: 'addOpenOrderLines', summary: 'Add pieces to an open order (kept from now on)' })
	addOpenLines(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(OpenOrderAddLines)) body: OpenOrderAddLines,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.openOrders.addLines(id, body, actorOf(principal), rightsOf(principal));
	}

	@Post(':id/open/remove-line')
	@HttpCode(200)
	@RequirePermissions('order.open')
	@ApiOperation({
		operationId: 'removeOpenOrderLine',
		summary: 'Remove a line from an open order (its pieces go back on sale)',
	})
	removeOpenLine(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(OpenOrderRemoveLine)) body: OpenOrderRemoveLine,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.openOrders.removeLine(id, body, actorOf(principal));
	}

	@Get(':id/open/close-preview')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('order.open')
	@ApiOperation({
		operationId: 'previewOpenOrderClose',
		summary: 'What closing an open order would do: one parcel’s shipping and what is due',
	})
	closeOpenPreview(@Param('id') id: string) {
		return this.openOrders.closePreview(id);
	}

	@Post(':id/open/close')
	@HttpCode(200)
	@RequirePermissions('order.open')
	@ApiOperation({
		operationId: 'closeOpenOrder',
		summary: 'Close an open order: shipping for one parcel, then what is due',
	})
	closeOpen(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(OpenOrderClose)) body: OpenOrderClose,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.openOrders.close(id, body, actorOf(principal));
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

/** Try it on the coupon builder (cp02): an unsaved coupon on a real cart at shop prices. */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/coupons')
export class AdminCouponTryController {
	constructor(private readonly checkout: AdminOrderCreateService) {}

	@Post('try')
	@HttpCode(200)
	@RequirePermissions('coupon.index')
	@ApiOperation({
		operationId: 'tryCoupon',
		summary: 'What an unsaved coupon takes off a real cart, line by line, and why',
	})
	tryCoupon(@Body(new ZodValidationPipe(CouponTryRequest)) body: CouponTryRequest) {
		return this.checkout.couponTry(body);
	}
}

/**
 * A business's receipts on account (brief bz06), here because a receipt settles orders: the open
 * orders it can pay (oldest first) and recording it with its split.
 */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/businesses')
export class AdminBusinessReceiptsController {
	constructor(private readonly receipts: BusinessReceiptsService) {}

	@Get(':id/open-orders')
	@RequirePermissions('order.payment')
	@ApiOperation({
		operationId: 'listBusinessOpenOrders',
		summary: 'Orders on account that still owe money, oldest first (the receipt’s Settles table)',
	})
	openOrders(@Param('id') id: string) {
		return this.receipts.openOrders(id);
	}

	@Post(':id/receipts')
	@RequirePermissions('order.payment')
	@ApiOperation({
		operationId: 'recordBusinessReceipt',
		summary: 'Record a receipt on account (RC number) and settle the orders it pays',
	})
	receipt(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(BusinessReceiptWrite)) body: BusinessReceiptWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.receipts.record(id, body, actorOf(principal));
	}
}

/** A business's delivery addresses (bz02), checked against the country rules like a customer's. */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/businesses')
export class AdminBusinessAddressesController {
	constructor(private readonly addresses: BusinessAddressesService) {}

	@Post(':id/addresses')
	@RequirePermissions('business.edit')
	@ApiOperation({ operationId: 'addBusinessAddress', summary: 'Add a delivery address to a business' })
	add(@Param('id') id: string, @Body(new ZodValidationPipe(BusinessAddressWrite)) body: BusinessAddressWrite) {
		return this.addresses.add(id, body);
	}

	@Put(':id/addresses/:addressId')
	@RequirePermissions('business.edit')
	@ApiOperation({ operationId: 'replaceBusinessAddress', summary: 'Change one of a business’s delivery addresses' })
	replace(
		@Param('id') id: string,
		@Param('addressId') addressId: string,
		@Body(new ZodValidationPipe(BusinessAddressWrite)) body: BusinessAddressWrite,
	) {
		return this.addresses.replace(id, addressId, body);
	}

	@Delete(':id/addresses/:addressId')
	@RequirePermissions('business.edit')
	@ApiOperation({ operationId: 'removeBusinessAddress', summary: 'Remove one of a business’s delivery addresses' })
	remove(@Param('id') id: string, @Param('addressId') addressId: string) {
		return this.addresses.remove(id, addressId);
	}
}
