import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
	type Order,
	type OrderPayment,
	type PayPageView,
	type PaymentRequest,
	type PaymentRequestCheck,
	type PaymentRequestWrite,
} from '@saha-textile/contracts';
import {
	checkRequestAmount,
	isRequestActive,
	requestExpiry,
	type OrderPaymentRepository,
	type OrderSettingsRepository,
	type PaymentRequestRepository,
	type ShopDetailsRepository,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';

import { codedRefusal } from '../common/coded-refusal';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { CurrencyService } from '../currency/currency.service';
import type { PaymentRequestPorts } from '../infra/payment-gateway-factory';
import {
	ORDER_PAYMENT_REPOSITORY,
	ORDER_SETTINGS_REPOSITORY,
	PAYMENT_REQUEST_PORTS,
	PAYMENT_REQUEST_REPOSITORY,
	SHOP_DETAILS_REPOSITORY,
	TRANSACTION_MANAGER,
} from '../infra/tokens';
import { DocumentNumbersService } from '../orders-setup/document-numbers.service';
import { AdminOrdersService, type Actor } from './admin-orders.service';

export const hashPayToken = (token: string): string => createHash('sha256').update(token).digest('hex');
const minor = (amount: number): number => Math.round(amount * 100);

/**
 * Payment requests (brief pl01–pl05, pr01–pr03, oo07; owner messages 16 and 18): the gateway sends
 * its own request (CCAvenue Quick Invoice by email and SMS, PayPal Invoicing by email) for no more
 * than is due; ₹ goes to the INR gateway and any other currency to PayPal, each request priced at
 * that day's rate with the markup (K10). Beside it, our forwarding link sahatextile.com/pay/<token>
 * (K1) always points at the order's current request. Check payment status asks the gateway and
 * records each captured payment once; a new request replaces and cancels the old one.
 */
@Injectable()
export class PaymentRequestsService {
	constructor(
		private readonly orders: AdminOrdersService,
		private readonly numbers: DocumentNumbersService,
		private readonly currency: CurrencyService,
		@Inject(PAYMENT_REQUEST_REPOSITORY) private readonly requests: PaymentRequestRepository,
		@Inject(ORDER_PAYMENT_REPOSITORY) private readonly payments: OrderPaymentRepository,
		@Inject(ORDER_SETTINGS_REPOSITORY) private readonly settings: OrderSettingsRepository,
		@Inject(SHOP_DETAILS_REPOSITORY) private readonly shop: ShopDetailsRepository,
		@Inject(PAYMENT_REQUEST_PORTS) private readonly ports: PaymentRequestPorts,
		@Inject(TRANSACTION_MANAGER) private readonly transactions: TransactionManagerPort,
		@Inject(APP_CONFIG) private readonly config: AppConfig,
	) {}

	/** Creates the gateway's request; the token of our link is returned once, inside `ourUrl`. */
	async create(orderId: string, input: PaymentRequestWrite, actor: Actor, now = new Date()): Promise<PaymentRequest> {
		const order = await this.orders.get(orderId);
		const settings = await this.settings.get();
		if (!settings.adminPaymentMethods.paymentLink) {
			throw new ConflictException(codedRefusal('method_off', 'Payment links are switched off', 'currency'));
		}
		if (!order.balance)
			throw new ConflictException(codedRefusal('nothing_due', 'Nothing is due on this order', 'amountINR'));
		const refusal = checkRequestAmount(order.balance, input.amountINR);
		if (refusal) {
			throw new ConflictException(
				codedRefusal(
					refusal === 'nothingDue' ? 'nothing_due' : 'more_than_due',
					'Ask for no more than is due',
					'amountINR',
					{
						dueINR: order.balance.dueINR,
					},
				),
			);
		}
		const gateway = input.currency.toUpperCase() === 'INR' ? 'ccavenue' : 'paypal';
		const port = this.ports.get(gateway);
		if (!port) {
			throw new ConflictException(
				codedRefusal('gateway_not_configured', 'That gateway is not set up', 'currency', { gateway }),
			);
		}
		const contact = this.contactOf(order);
		if (!contact.email && !contact.mobile) {
			throw new ConflictException(
				codedRefusal('no_contact', 'The billing contact has no email or mobile', 'currency'),
			);
		}
		const conversion = await this.currency.convert(input.amountINR, input.currency);
		const existing = await this.requests.listByOrder(orderId);
		const number = await this.numbers.childNumber('paymentRequest', order.orderNumber, existing.length + 1);
		const validDays = input.validDays ?? settings.paymentLinkDays;
		const created = await port.createPaymentRequest({
			reference: number,
			orderNumber: order.orderNumber,
			currency: conversion.currency,
			amountMinor: minor(conversion.amount),
			customer: { name: contact.name, email: contact.email, mobile: contact.mobile },
			validDays,
			emailSubject: `Pay for your Saha Textile order ${order.orderNumber}`,
			smsText: null,
			items: [{ name: `Order ${order.orderNumber}`, quantity: 1, unitAmountMinor: minor(conversion.amount) }],
		});
		const token = randomBytes(24).toString('base64url');
		const shopOrigin = this.config.media.shopOrigin?.replace(/\/$/, '') ?? null;
		const at = now.toISOString();
		const request: PaymentRequest = {
			id: `req_${randomUUID()}`,
			orderId,
			number,
			gateway,
			currency: conversion.currency,
			amount: conversion.amount,
			amountINR: input.amountINR,
			rateFromINR: conversion.rateFromINR,
			markupPercent: conversion.markupPercent,
			gatewayRequestId: created.gatewayRequestId,
			gatewayUrl: created.url,
			tokenHash: hashPayToken(token),
			ourUrl: shopOrigin ? `${shopOrigin}/pay/${token}` : null,
			sentTo: {
				email: contact.email,
				mobile: contact.mobile ? `+${contact.mobile.countryCallingCode} ${contact.mobile.number}` : null,
			},
			expiresAt: requestExpiry(now, validDays),
			status: 'active',
			attempts: [],
			sends: [],
			replacedBy: null,
			lastCheckedAt: null,
			createdBy: actor.id ?? 'unknown',
			createdAt: at,
		};
		// Taken before the save, so the new request is never among those it replaces.
		const replaced = existing.filter((row) => isRequestActive(row, now));
		await this.transactions.withTransaction(async (context) => {
			for (const old of replaced) {
				await this.requests.save({ ...old, status: 'replaced', replacedBy: request.id }, context);
			}
			await this.requests.save(request, context);
			await this.orders.settle(order, input.revision, actor, at, context, {
				kind: 'paymentRequest',
				detail: { number, gateway, amountINR: input.amountINR, currency: conversion.currency },
			});
		});
		for (const old of replaced.filter((row) => row.gatewayRequestId)) {
			// The gateway's own request stops working too; a failure here leaves it to expire by itself.
			await this.ports
				.get(old.gateway)
				?.cancelPaymentRequest(old.gatewayRequestId as string)
				.catch(() => undefined);
		}
		return request;
	}

	/** Check payment status (pl02, pl03): records each captured payment once, then the order is settled again. */
	async check(orderId: string, requestId: string, actor: Actor, now = new Date()): Promise<PaymentRequestCheck> {
		const request = await this.requestOf(orderId, requestId);
		const port = this.ports.get(request.gateway);
		if (!port || !request.gatewayRequestId) {
			throw new ConflictException(
				codedRefusal('gateway_not_configured', 'That gateway is not set up', 'requestId'),
			);
		}
		const report = await port.fetchPaymentRequestStatus(request.gatewayRequestId);
		const at = now.toISOString();
		let recorded: OrderPayment | null = null;
		await this.transactions.withTransaction(async (context) => {
			for (const paid of report.payments) {
				if (await this.payments.findByGatewayReference(request.gateway, paid.gatewayReference)) continue;
				const share = request.amount > 0 ? paid.amountMinor / 100 / request.amount : 0;
				const payment: OrderPayment = {
					id: `pay_${randomUUID()}`,
					orderId,
					method: 'gateway',
					state: 'received',
					amountINR: Math.round(request.amountINR * share * 100) / 100,
					currency: paid.currency,
					amount: paid.amountMinor / 100,
					reference: paid.gatewayReference,
					gateway: {
						id: request.gateway,
						attemptId: request.gatewayRequestId as string,
						reference: paid.gatewayReference,
						requestId: request.id,
					},
					paypal: null,
					collector: null,
					receivedOn: paid.at.slice(0, 10),
					receiptNumber: await this.numbers.issue('receipt', context, now),
					note: null,
					proofMediaId: null,
					recordedBy: actor.id,
					recordedAt: at,
				};
				await this.payments.save(payment, context);
				recorded = payment;
			}
			const status: PaymentRequest['status'] =
				report.state === 'paid'
					? 'paid'
					: report.state === 'cancelled'
						? 'cancelled'
						: report.state === 'expired'
							? 'expired'
							: request.status;
			await this.requests.save(
				{
					...request,
					status,
					lastCheckedAt: at,
					attempts: [
						...request.attempts,
						...report.payments.map((paid) => ({
							at: paid.at,
							state: 'captured' as const,
							method: paid.method,
							reason: null,
							gatewayReference: paid.gatewayReference,
						})),
					],
				},
				context,
			);
			if (recorded) {
				const order = await this.orders.get(orderId);
				await this.orders.settle(order, order.revision, actor, at, context, {
					kind: 'payment',
					detail: { gateway: request.gateway, reference: (recorded as OrderPayment).reference },
				});
			}
		});
		return { request: await this.requestOf(orderId, requestId), recorded: recorded !== null, payment: recorded };
	}

	async cancel(orderId: string, requestId: string, actor: Actor, now = new Date()): Promise<PaymentRequest> {
		const request = await this.requestOf(orderId, requestId);
		if (!isRequestActive(request, now)) {
			throw new ConflictException(codedRefusal('request_not_active', 'That request is not active', 'requestId'));
		}
		if (request.gatewayRequestId)
			await this.ports.get(request.gateway)?.cancelPaymentRequest(request.gatewayRequestId);
		const order = await this.orders.get(orderId);
		const at = now.toISOString();
		await this.transactions.withTransaction(async (context) => {
			await this.requests.save({ ...request, status: 'cancelled' }, context);
			await this.orders.settle(order, order.revision, actor, at, context, {
				kind: 'paymentRequest',
				detail: { number: request.number, cancelled: true },
			});
		});
		return this.requestOf(orderId, requestId);
	}

	/** The shop's pay page (shop10, shop11): our link always shows the order's current request. */
	async payPage(token: string, now = new Date()): Promise<PayPageView> {
		const found = await this.requests.findByTokenHash(hashPayToken(token));
		if (!found) throw new NotFoundException('That payment link does not exist');
		const all = await this.requests.listByOrder(found.orderId);
		const current = all.find((row) => isRequestActive(row, now)) ?? found;
		const order = await this.orders.get(found.orderId);
		if (order.paymentStatus === 'paid' || order.paymentStatus === 'paid_ahead' || current.status === 'paid') {
			return { state: 'paid', orderNumber: order.orderNumber };
		}
		if (isRequestActive(current, now) && current.gatewayUrl) {
			return {
				state: 'payable',
				orderNumber: order.orderNumber,
				currency: current.currency,
				amount: current.amount,
				items: order.lines.map((line) => ({ title: line.title.en, quantity: line.quantity, imageUrl: null })),
				deliveryCity: order.addresses?.delivery.city ?? null,
				deliveryCountry: order.addresses?.delivery.countryCode ?? order.addresses?.delivery.country ?? null,
				expiresAt: current.expiresAt,
				payUrl: current.gatewayUrl,
			};
		}
		const shop = await this.shop.get();
		return {
			state: 'expired',
			orderNumber: order.orderNumber,
			contactPhone: shop?.phone || null,
			contactEmail: shop?.email || null,
		};
	}

	private async requestOf(orderId: string, requestId: string): Promise<PaymentRequest> {
		const request = await this.requests.findById(requestId);
		if (!request || request.orderId !== orderId) {
			throw new NotFoundException(codedRefusal('request_missing', 'That request does not exist', 'requestId'));
		}
		return request;
	}

	/** The billing contact: the request goes to the actual billing address's phone and email (owner, message 16). */
	private contactOf(order: Order) {
		const billing = order.addresses?.billing;
		return {
			name: billing?.fullName ?? order.buyer?.name ?? '',
			email: order.buyer?.email ?? null,
			mobile: billing?.mobile ?? order.buyer?.mobile ?? null,
		};
	}
}
