import { randomUUID } from 'node:crypto';

import {
	ConflictException,
	Inject,
	Injectable,
	Logger,
	NotFoundException,
	ServiceUnavailableException,
} from '@nestjs/common';
import type {
	CheckoutConfirm,
	CheckoutPaymentOutcome,
	Order,
	OrderPayment,
	PaymentAttempt,
} from '@saha-textile/contracts';
import {
	CouponUsedUpError,
	attemptIdFor,
	decidePaymentResult,
	holdIsLive,
	nextAttemptCheck,
	paymentPopup,
	type AdminOrderRepository,
	type CartRepository,
	type CouponRepository,
	type OrderPaymentRepository,
	type PaymentAttemptRepository,
	type PaymentReport,
	type PaymentRequestRepository,
	type ShippingRuleRepository,
	type TransactionContext,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';

import { historyEntry, metaOf, type Actor, AdminOrdersService } from '../admin-orders/admin-orders.service';
import { OrderStock } from '../admin-orders/order-stock';
import { PaymentRequestsService } from '../admin-orders/payment-requests.service';
import type { AuthenticatedPrincipal } from '../auth/session.guard';
import { codedRefusal } from '../common/coded-refusal';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { CurrencyService } from '../currency/currency.service';
import { gatewayNamed, type CheckoutGateways } from '../infra/payment-gateway-factory';
import {
	ADMIN_ORDER_REPOSITORY,
	CART_REPOSITORY,
	CHECKOUT_GATEWAYS,
	COUPON_REPOSITORY,
	ORDER_PAYMENT_REPOSITORY,
	PAYMENT_ATTEMPT_REPOSITORY,
	PAYMENT_REQUEST_REPOSITORY,
	SHIPPING_RULE_REPOSITORY,
	TRANSACTION_MANAGER,
} from '../infra/tokens';
import { DocumentNumbersService } from '../orders-setup/document-numbers.service';
import { DEFAULT_SHIPPING_SETTINGS } from '../shipping/shipping-admin.service';

const SYSTEM: Actor = { id: null, name: 'System' };
const PAID = new Set<PaymentAttempt['state']>(['authorized', 'captured']);
const istDay = (at: Date): string => new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** A PayPal webhook event, as far as this code reads it. */
interface PayPalEvent {
	event_type?: string;
	resource?: {
		id?: string;
		custom_id?: string;
		purchase_units?: Array<{ custom_id?: string }>;
		supplementary_data?: { related_ids?: { order_id?: string } };
		invoice?: { id?: string };
	};
}

/**
 * The shop's payment after Pay (OD1 `DEC-STOCK-RESERVE`; shipping brief shop04/shop05; lifecycle page
 * "Judging a gateway's answer"):
 *
 * - each press of Pay is an attempt with its own id; the browser goes to the gateway's page;
 * - every answer (the browser's return, CCAvenue's echo, PayPal's webhook, the sweep) only asks the
 *   gateway directly and lets core `decidePaymentResult` judge; the return is a claim, never proof;
 * - paid within the 15-minute hold: the payment is recorded and the order placed; paid after the hold
 *   ended: the pieces are kept again if they are all still free, otherwise the whole payment is
 *   refunded and the sold lines named (OD1; backorders, OD2, are not built yet, so none apply);
 * - failed or cancelled: the hold is let go at once; the shopper is back at checkout with the popup;
 * - a `review` decision changes nothing: the attempt keeps its state, the order is flagged for staff,
 *   and the enquiry keeps running (a CCAvenue return can come 5–10 minutes before its status record).
 */
@Injectable()
export class ShopPaymentsService {
	private readonly logger = new Logger('ShopPayments');

	constructor(
		private readonly orders: AdminOrdersService,
		private readonly stock: OrderStock,
		private readonly numbers: DocumentNumbersService,
		private readonly requests: PaymentRequestsService,
		private readonly currency: CurrencyService,
		@Inject(APP_CONFIG) private readonly config: AppConfig,
		@Inject(CHECKOUT_GATEWAYS) private readonly gateways: CheckoutGateways,
		@Inject(ADMIN_ORDER_REPOSITORY) private readonly orderRepo: AdminOrderRepository,
		@Inject(PAYMENT_ATTEMPT_REPOSITORY) private readonly attempts: PaymentAttemptRepository,
		@Inject(ORDER_PAYMENT_REPOSITORY) private readonly payments: OrderPaymentRepository,
		@Inject(PAYMENT_REQUEST_REPOSITORY) private readonly paymentRequests: PaymentRequestRepository,
		@Inject(CART_REPOSITORY) private readonly carts: CartRepository,
		@Inject(COUPON_REPOSITORY) private readonly coupons: CouponRepository,
		@Inject(SHIPPING_RULE_REPOSITORY) private readonly shippingRules: ShippingRuleRepository,
		@Inject(TRANSACTION_MANAGER) private readonly transactions: TransactionManagerPort,
	) {}

	/* ------------------------------------------------------------------ starting a payment */

	/**
	 * A new attempt for an order waiting for payment, and the hand-off to the gateway. A press within a
	 * minute of the last one answers with the same hand-off, so a double click can't start two payments.
	 */
	async start(order: Order, locale: string, now = new Date()): Promise<PaymentAttempt> {
		const previous = await this.attempts.listByOrder(order.id);
		const last = previous[previous.length - 1];
		if (last?.state === 'pending' && last.handoff && now.getTime() - new Date(last.createdAt).getTime() < 60_000) {
			return last;
		}
		const gatewayId = order.currency === 'INR' ? 'inr' : 'paypal';
		const port = gatewayId === 'inr' ? this.gateways.inr : this.gateways.paypal;
		if (!port) {
			throw new ConflictException(codedRefusal('pay_blocked', 'Pay is off', 'currency', { reason: 'noGateway' }));
		}
		const amount = order.currency === 'INR' ? order.totalINR : order.totalPaid;
		const at = now.toISOString();
		const attempt: PaymentAttempt = {
			id: attemptIdFor(order.orderNumber, previous.length + 1),
			orderId: order.id,
			gateway: port.gateway,
			currency: order.currency,
			amountMinor: Math.round(amount * 100),
			amountINR: order.totalINR,
			state: 'pending',
			gatewayOrderId: null,
			gatewayReference: null,
			handoff: null,
			failureReason: null,
			reviewReason: null,
			refund: null,
			checks: 0,
			nextCheckAt: nextAttemptCheck(now, 0)?.toISOString() ?? null,
			lastCheckedAt: null,
			createdAt: at,
			updatedAt: at,
		};
		const { returnUrl, cancelUrl } = this.returnUrls(attempt, locale);
		try {
			const intent = await port.createPayment({
				attemptId: attempt.id,
				amountMinor: attempt.amountMinor,
				currency: attempt.currency,
				returnUrl,
				cancelUrl,
			});
			attempt.handoff = intent.handoff;
			attempt.gatewayOrderId = intent.auditRecord['paypal_order_id'] ?? null;
		} catch (error) {
			// The shopper can press Pay again on the same order; the pieces stay held meanwhile.
			await this.attempts.save({
				...attempt,
				state: 'failed',
				failureReason: 'The payment could not start',
				nextCheckAt: null,
			});
			this.logger.warn(
				`Payment for ${order.orderNumber} could not start: ${error instanceof Error ? error.message : 'unknown'}`,
			);
			throw new ServiceUnavailableException(
				codedRefusal('payment_not_started', 'The payment could not start; please try again', 'pay'),
			);
		}
		return this.attempts.save(attempt);
	}

	/**
	 * Where the gateway sends the shopper back. CCAvenue posts to the one registered address on the API
	 * host (`CCAVENUE_RETURN_URL`), which then sends the browser to the shop; PayPal returns straight to
	 * the shop's return page, which asks this API.
	 */
	private returnUrls(attempt: PaymentAttempt, locale: string): { returnUrl: string; cancelUrl: string } {
		if (attempt.gateway === 'ccavenue') {
			const registered = this.config.payments.ccavenue.returnUrl;
			if (!registered) throw new ServiceUnavailableException('The INR gateway has no return address');
			return { returnUrl: registered, cancelUrl: registered };
		}
		const page = this.resultPage(attempt.id, locale);
		return { returnUrl: page, cancelUrl: `${page}&cancelled=1` };
	}

	/** The shop page that shows how a payment ended. */
	resultPage(attemptId: string, locale: string): string {
		const shop = this.config.media.shopOrigin?.replace(/\/$/, '');
		if (!shop) throw new ServiceUnavailableException('SHOP_ORIGIN is not set');
		return `${shop}/${locale}/checkout/payment-return?attempt=${encodeURIComponent(attemptId)}`;
	}

	/* ------------------------------------------------------------------ answers from the gateway */

	/** CCAvenue's post to the return address: a claim, judged beside a status enquiry. */
	async ccavenueReturn(form: unknown, now = new Date()): Promise<PaymentAttempt | null> {
		const port = this.gateways.inr;
		if (!port || port.gateway !== 'ccavenue') return null;
		let claim: PaymentReport;
		try {
			claim = await port.verifyCallback(form);
		} catch {
			return null;
		}
		const attempt = await this.attempts.findById(claim.attemptId);
		return attempt ? this.settle(attempt, claim, now) : null;
	}

	/** PayPal's webhook: identifies the attempt (or our payment request); the status enquiry decides. */
	async paypalWebhook(
		headers: Readonly<Record<string, string | undefined>>,
		rawBody: string,
		now = new Date(),
	): Promise<'handled' | 'ignored' | 'unverified'> {
		const port = this.gateways.paypal;
		if (!port || !(await port.verifyWebhook(headers, rawBody).catch(() => false))) return 'unverified';
		const event = JSON.parse(rawBody) as PayPalEvent;
		const type = event.event_type ?? '';
		const resource = event.resource ?? {};
		if (type.startsWith('INVOICING.INVOICE.') && resource.invoice?.id) {
			const request = await this.paymentRequests.findByGatewayRequestId('paypal', resource.invoice.id);
			if (!request) return 'ignored';
			await this.requests.check(request.orderId, request.id, SYSTEM, now);
			return 'handled';
		}
		const attemptId =
			type === 'CHECKOUT.ORDER.APPROVED' ? resource.purchase_units?.[0]?.custom_id : resource.custom_id;
		const paypalOrderId =
			type === 'CHECKOUT.ORDER.APPROVED' ? resource.id : resource.supplementary_data?.related_ids?.order_id;
		if (!attemptId) return 'ignored';
		const attempt = await this.attempts.findById(attemptId);
		if (!attempt || attempt.gateway !== 'paypal') return 'ignored';
		if (paypalOrderId && attempt.gatewayOrderId && paypalOrderId !== attempt.gatewayOrderId) return 'ignored';
		await this.settle(attempt, undefined, now);
		return 'handled';
	}

	/** The shop's return page (PayPal's return or cancel, or after CCAvenue): the shopper's own attempts only. */
	async confirm(
		attemptId: string,
		input: CheckoutConfirm,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<CheckoutPaymentOutcome> {
		let { attempt, order } = await this.owned(attemptId, principal);
		if (input.cancelled && attempt.state === 'pending') {
			// The shopper pressed Cancel at the gateway: let the hold go now (OD1). The attempt itself
			// changes only on the gateway's word; a payment that still arrives follows the late rule.
			order = await this.releaseHold(order, attempt, 'cancelledAtGateway', now);
			return this.outcome(attempt, order, 'cancelled');
		}
		attempt = await this.settle(attempt, undefined, now);
		return this.outcome(attempt, await this.orders.get(attempt.orderId));
	}

	/** How an attempt ended, for the shop's return page. */
	async outcomeFor(
		attemptId: string,
		principal: AuthenticatedPrincipal | undefined,
	): Promise<CheckoutPaymentOutcome> {
		const { attempt, order } = await this.owned(attemptId, principal);
		return this.outcome(attempt, order);
	}

	/**
	 * Asks the gateway about one attempt and applies core's decision. Safe to repeat: the same answer
	 * decides `duplicate`, and a payment is recorded once by its gateway reference.
	 */
	async settle(attempt: PaymentAttempt, claim: PaymentReport | undefined, now = new Date()): Promise<PaymentAttempt> {
		const port = gatewayNamed(this.gateways, attempt.gateway);
		if (!port) return attempt;
		let status: PaymentReport | null;
		try {
			status = await port.fetchPaymentStatus({
				attemptId: attempt.id,
				gatewayReference: attempt.gateway === 'paypal' ? attempt.gatewayOrderId : attempt.gatewayReference,
			});
		} catch (error) {
			this.logger.warn(
				`Status of ${attempt.id} could not be read: ${error instanceof Error ? error.message : 'unknown'}`,
			);
			return this.attempts.save(this.checked(attempt, now));
		}
		// PayPal's return carries only its order id, not a state: identification, not a claim.
		const decision = decidePaymentResult(
			{
				attemptId: attempt.id,
				amountMinor: attempt.amountMinor,
				currency: attempt.currency,
				state: attempt.state,
				gatewayReference: attempt.gatewayReference,
			},
			status,
			attempt.gateway === 'ccavenue' ? claim : undefined,
		);
		switch (decision.kind) {
			case 'pending':
				return this.attempts.save(this.checked(attempt, now));
			case 'duplicate':
				return this.attempts.save({ ...this.checked(attempt, now), nextCheckAt: attempt.nextCheckAt });
			case 'review':
				return this.review(attempt, decision.reason, now);
			case 'apply': {
				const next: PaymentAttempt = {
					...this.checked(attempt, now),
					state: decision.state,
					gatewayReference: decision.gatewayReference ?? attempt.gatewayReference,
					failureReason: status?.failureReason?.slice(0, 300) ?? attempt.failureReason,
					reviewReason: null,
				};
				if (decision.state === 'pending') return this.attempts.save(next);
				next.nextCheckAt = null;
				if (PAID.has(decision.state)) return this.paid(next, status as PaymentReport, now);
				if (decision.state === 'failed' || decision.state === 'cancelled') return this.unpaid(next, now);
				return this.attempts.save(next);
			}
		}
	}

	/** The next status enquiry, spaced out; stops after two days. */
	private checked(attempt: PaymentAttempt, now: Date): PaymentAttempt {
		const checks = attempt.checks + 1;
		return {
			...attempt,
			checks,
			lastCheckedAt: now.toISOString(),
			updatedAt: now.toISOString(),
			nextCheckAt:
				attempt.state === 'pending'
					? (nextAttemptCheck(new Date(attempt.createdAt), checks)?.toISOString() ?? null)
					: null,
		};
	}

	/** `review`: change nothing, flag the order for staff, keep asking (the record may just be late). */
	private async review(attempt: PaymentAttempt, reason: string, now: Date): Promise<PaymentAttempt> {
		const saved = await this.attempts.save({ ...this.checked(attempt, now), reviewReason: reason });
		this.logger.warn(`Attempt ${attempt.id} needs a person: ${reason}`);
		await this.flag(attempt.orderId, attempt.id, reason, now);
		return saved;
	}

	private async flag(orderId: string, attemptId: string, reason: string, now: Date): Promise<void> {
		const order = await this.orders.get(orderId);
		if (order.paymentReview?.attemptId === attemptId && order.paymentReview.reason === reason) return;
		const next: Order = { ...order, paymentReview: { attemptId, reason, at: now.toISOString() } };
		await this.orderRepo.update(next, order.revision, undefined, metaOf(next)).catch(() => undefined);
	}

	/* ------------------------------------------------------------------ paid */

	private async paid(attempt: PaymentAttempt, status: PaymentReport, now: Date): Promise<PaymentAttempt> {
		const order = await this.orders.get(attempt.orderId);
		const reference = attempt.gatewayReference ?? attempt.id;
		if (order.status === 'cancelled') return this.refund(attempt, status, order, [], 'orderCancelled', now);
		if (
			order.status === 'awaiting_payment' &&
			!holdIsLive(order.holdUntil, now) &&
			!order.lines.some((l) => l.held)
		) {
			// Paid after the hold ended (OD1): keep the pieces again if every one is still free.
			const soldOut = await this.stock.unavailableLines(order);
			if (soldOut.length) return this.refund(attempt, status, order, soldOut, 'soldOutBeforePayment', now);
			try {
				return await this.record(attempt, status, order, reference, now, true);
			} catch (error) {
				if (!(error instanceof ConflictException)) throw error;
				const raced = await this.stock.unavailableLines(order);
				return this.refund(attempt, status, order, raced, 'soldOutBeforePayment', now);
			}
		}
		return this.record(attempt, status, order, reference, now, false);
	}

	/** Records the payment once, keeps the pieces when asked, and places the order (settle). */
	private async record(
		attempt: PaymentAttempt,
		status: PaymentReport,
		order: Order,
		reference: string,
		now: Date,
		reserveAgain: boolean,
	): Promise<PaymentAttempt> {
		const at = now.toISOString();
		const placedBefore = order.status !== 'awaiting_payment';
		const saved = await this.transactions.withTransaction(async (context) => {
			const savedAttempt = await this.attempts.save(attempt, context);
			if (await this.payments.findByGatewayReference(attempt.gateway, reference)) return savedAttempt;
			await this.payments.save(await this.paymentOf(attempt, status, reference, now, context), context);
			let current = await this.orders.get(order.id);
			if (current.status === 'awaiting_payment') {
				if (reserveAgain) await this.stock.reserve(current, current.lines, null, context, at);
				current = {
					...current,
					holdUntil: null,
					lines: current.lines.map((line) => ({ ...line, held: !line.madeToOrder })),
				};
			}
			await this.orders.settle(current, current.revision, SYSTEM, at, context, {
				kind: 'payment',
				detail: { gateway: attempt.gateway, reference, attempt: attempt.id },
			});
			return savedAttempt;
		});
		const after = await this.orders.get(order.id);
		if (placedBefore && after.paymentReview?.reason !== 'paidTwice' && (after.balance?.paidAheadINR ?? 0) > 0) {
			await this.flag(order.id, attempt.id, 'paidTwice', now);
		}
		if (!placedBefore && after.status === 'placed') await this.afterPlaced(after);
		return saved;
	}

	private async paymentOf(
		attempt: PaymentAttempt,
		status: PaymentReport,
		reference: string,
		now: Date,
		context: TransactionContext,
	): Promise<OrderPayment> {
		const receivable = status.receivable;
		return {
			id: `pay_${randomUUID()}`,
			orderId: attempt.orderId,
			method: 'gateway',
			state: 'received',
			amountINR: attempt.amountINR,
			currency: attempt.currency,
			amount: attempt.amountMinor / 100,
			reference,
			gateway: { id: attempt.gateway, attemptId: attempt.id, reference, requestId: null },
			paypal: receivable
				? {
						grossAmount: receivable.grossAmount,
						grossCurrency: receivable.grossCurrency,
						paypalFee: receivable.fee,
						netAmount: receivable.net,
						receivableINR: receivable.receivableINR,
						exchangeRate: receivable.exchangeRate,
						source: 'capture',
					}
				: null,
			collector: null,
			receivedOn: istDay(now),
			receiptNumber: await this.numbers.issue('receipt', context, now),
			note: null,
			proofMediaId: null,
			recordedBy: null,
			recordedAt: now.toISOString(),
		};
	}

	/** The order is placed: its pieces leave the shopper's bag and its coupons count as used. */
	private async afterPlaced(order: Order): Promise<void> {
		const customerId = order.buyer?.customerId ?? order.userId;
		if (customerId) {
			const cart = await this.carts.findByUserId(customerId);
			if (cart) {
				const ordered = new Set(order.lines.map((line) => `${line.productId}:${line.variationId ?? ''}`));
				const kept = cart.lines.filter((line) => !ordered.has(`${line.productId}:${line.variationId ?? ''}`));
				if (kept.length !== cart.lines.length) await this.carts.save({ ...cart, lines: kept });
			}
		}
		for (const coupon of order.coupons) {
			try {
				await this.coupons.recordUse(coupon.couponId, `customer:${customerId ?? 'unknown'}`, order.id);
			} catch (error) {
				// The money is taken; a coupon that reached its limit meanwhile stays on this order.
				if (!(error instanceof CouponUsedUpError)) throw error;
				this.logger.warn(`Coupon ${coupon.code} passed its limit on ${order.orderNumber}`);
			}
		}
	}

	/**
	 * Paid, but the pieces can't be kept (OD1): the payment is recorded, then refunded in full through
	 * the gateway with our own reference (a retry can't refund twice), and the order is cancelled with
	 * the sold lines named. A refund the gateway refuses or doesn't answer is flagged for staff.
	 */
	private async refund(
		attempt: PaymentAttempt,
		status: PaymentReport,
		order: Order,
		soldOutLineIds: string[],
		reason: 'soldOutBeforePayment' | 'orderCancelled',
		now: Date,
	): Promise<PaymentAttempt> {
		const at = now.toISOString();
		const reference = attempt.gatewayReference ?? attempt.id;
		const refundReference = `R${attempt.id.replace(/[^A-Za-z0-9]/g, '')}`.slice(0, 30);
		let payment = await this.payments.findByGatewayReference(attempt.gateway, reference);
		if (!payment) {
			payment = await this.transactions.withTransaction(async (context) => {
				const row = await this.paymentOf(attempt, status, reference, now, context);
				await this.payments.save(row, context);
				return row;
			});
		}
		const port = gatewayNamed(this.gateways, attempt.gateway);
		let outcome: NonNullable<PaymentAttempt['refund']>['outcome'] = 'unknown';
		if (port) {
			try {
				outcome = (
					await port.refundPayment({
						gatewayReference: reference,
						refundReference,
						amountMinor: attempt.amountMinor,
						currency: attempt.currency,
					})
				).outcome;
			} catch (error) {
				this.logger.warn(
					`Refund of ${attempt.id} got no answer: ${error instanceof Error ? error.message : 'unknown'}`,
				);
			}
		}
		const refunded = outcome === 'accepted' || outcome === 'duplicate';
		const savedPayment = payment;
		const saved = await this.transactions.withTransaction(async (context) => {
			const next = await this.attempts.save(
				{ ...attempt, refund: { reference: refundReference, outcome, soldOutLineIds, at } },
				context,
			);
			if (refunded) await this.payments.save({ ...savedPayment, state: 'refunded' }, context);
			const current = await this.orders.get(order.id);
			const cancelled: Order =
				current.status === 'awaiting_payment'
					? {
							...current,
							status: 'cancelled',
							holdUntil: null,
							statusTimeline: [...current.statusTimeline, { status: 'cancelled', at }],
							history: [
								...current.history,
								historyEntry(SYSTEM, at, 'status', {
									from: current.status,
									to: 'cancelled',
									detail: { reason, soldOutLines: soldOutLineIds.join(',') },
								}),
							],
						}
					: current;
			await this.orders.settle(cancelled, current.revision, SYSTEM, at, context, {
				kind: 'payment',
				detail: { refund: refundReference, outcome, attempt: attempt.id },
			});
			return next;
		});
		if (!refunded) await this.flag(order.id, attempt.id, 'refundNotConfirmed', now);
		return saved;
	}

	/* ------------------------------------------------------------------ not paid */

	private async unpaid(attempt: PaymentAttempt, now: Date): Promise<PaymentAttempt> {
		const saved = await this.attempts.save(attempt);
		const order = await this.orders.get(attempt.orderId);
		await this.releaseHold(order, attempt, attempt.state, now);
		return saved;
	}

	/** OD1: the hold goes the moment a payment fails or is cancelled, or when its 15 minutes run out. */
	async releaseHold(order: Order, attempt: PaymentAttempt | null, why: string, now: Date): Promise<Order> {
		if (order.status !== 'awaiting_payment' || !order.lines.some((line) => line.held)) return order;
		const at = now.toISOString();
		return this.transactions.withTransaction(async (context) => {
			const current = await this.orders.get(order.id);
			if (current.status !== 'awaiting_payment') return current;
			await this.stock.release(current, current.lines, null, context, at);
			const next: Order = {
				...current,
				holdUntil: null,
				lines: current.lines.map((line) => ({ ...line, held: false })),
				history: [
					...current.history,
					historyEntry(SYSTEM, at, 'payment', {
						detail: { hold: 'released', why, attempt: attempt?.id ?? null },
					}),
				],
			};
			return this.orderRepo.update(next, current.revision, context, metaOf(next));
		});
	}

	/* ------------------------------------------------------------------ the sweep */

	/**
	 * One pass of the shop's payment sweep: pending attempts whose next enquiry is due are asked again,
	 * and holds whose 15 minutes ran out are let go, after one last enquiry so a payment made in the
	 * last seconds still lands on its held pieces. A failure on one never stops the rest.
	 */
	async sweep(now = new Date(), batch = 25): Promise<{ checked: number; released: number }> {
		let checked = 0;
		let released = 0;
		for (const attempt of await this.attempts.listDue(now, batch)) {
			try {
				await this.settle(attempt, undefined, now);
				checked += 1;
			} catch (error) {
				this.logger.warn(`Attempt ${attempt.id}: ${error instanceof Error ? error.message : 'unknown'}`);
			}
		}
		for (const order of await this.orderRepo.listHoldsEnded(now, batch)) {
			try {
				for (const attempt of await this.attempts.listByOrder(order.id)) {
					if (attempt.state === 'pending') await this.settle(attempt, undefined, now);
				}
				const current = await this.orders.get(order.id);
				if (current.status === 'awaiting_payment' && !holdIsLive(current.holdUntil, now)) {
					await this.releaseHold(current, null, 'holdEnded', now);
					if (current.holdUntil && !current.lines.some((line) => line.held)) {
						// Nothing was held (made-to-order only): just clear the time.
						await this.orderRepo.update({ ...current, holdUntil: null }, current.revision);
					}
					released += 1;
				}
			} catch (error) {
				this.logger.warn(`Hold on ${order.orderNumber}: ${error instanceof Error ? error.message : 'unknown'}`);
			}
		}
		return { checked, released };
	}

	async localeOf(attempt: PaymentAttempt): Promise<string> {
		return (await this.orderRepo.findById(attempt.orderId))?.locale ?? 'en';
	}

	/* ------------------------------------------------------------------ the shopper's view */

	private async owned(
		attemptId: string,
		principal: AuthenticatedPrincipal | undefined,
	): Promise<{ attempt: PaymentAttempt; order: Order }> {
		const attempt = principal?.audience === 'storefront' ? await this.attempts.findById(attemptId) : null;
		const order = attempt ? await this.orderRepo.findById(attempt.orderId) : null;
		const owner = order?.buyer?.customerId ?? order?.userId ?? null;
		// Someone else's attempt reads as missing, so ids can't be probed.
		if (!attempt || !order || !principal || owner !== principal.userId) {
			throw new NotFoundException(codedRefusal('attempt_missing', 'That payment was not found', 'attempt'));
		}
		return { attempt, order };
	}

	private async outcome(
		attempt: PaymentAttempt,
		order: Order,
		forced?: CheckoutPaymentOutcome['result'],
	): Promise<CheckoutPaymentOutcome> {
		const result: CheckoutPaymentOutcome['result'] =
			forced ??
			(attempt.refund
				? 'refunded'
				: PAID.has(attempt.state)
					? 'paid'
					: attempt.state === 'failed'
						? 'failed'
						: attempt.state === 'cancelled'
							? 'cancelled'
							: 'pending');
		let popup: CheckoutPaymentOutcome['popup'] = null;
		let firstCurrency: string | null = null;
		if (result === 'failed' || result === 'cancelled') {
			const settings = (await this.shippingRules.getSettings()) ?? DEFAULT_SHIPPING_SETTINGS;
			const billing = order.addresses?.billing;
			const chosen = paymentPopup({
				gateway: attempt.gateway,
				state: result,
				failureReason: attempt.failureReason,
				billingCountry: billing?.countryCode ?? billing?.country ?? settings.homeCountry,
				homeCountry: settings.homeCountry,
				enabled: (await this.currency.listEnabled()).map((row) => row.code),
			});
			popup = chosen.popup;
			firstCurrency = chosen.firstCurrency;
		}
		return {
			orderId: order.id,
			orderNumber: order.orderNumber,
			result,
			popup,
			firstCurrency,
			soldOutLineIds: attempt.refund?.soldOutLineIds ?? [],
		};
	}
}
