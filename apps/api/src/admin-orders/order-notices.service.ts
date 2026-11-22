import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Business, BusinessReceiptWrite, Order, OrderAddress, OrderPayment } from '@saha-textile/contracts';
import {
	messageForm,
	plannedNotices,
	statusNotices,
	type NotificationListRow,
	type NotificationPort,
	type NotificationVariable,
	type OrderNotice,
	type OrderNoticeContact,
} from '@saha-textile/core-domain';

import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { NOTIFICATION_PORT } from '../infra/tokens';

/** What a message needs beyond the order itself. */
export interface OrderNoticeFacts {
	/** order_shipped: the parcel as staff typed it. */
	shipment?: { courierName: string; trackingNumber: string; trackingUrl?: string | null };
	/** payment_receipt: the payment just recorded. */
	payment?: OrderPayment;
	/** order_refunded_sold_out, refund_processed: the lines that sold out and the amount refunded. */
	soldOutLineIds?: readonly string[];
	refundedINR?: number;
}

const DAY = new Intl.DateTimeFormat('en-IN', {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
	timeZone: 'Asia/Kolkata',
});

const METHOD_WORDS: Readonly<Record<OrderPayment['method'], string>> = {
	gateway: 'Online payment',
	upi: 'UPI',
	bankTransfer: 'Bank transfer',
	cashOnDelivery: 'Cash on delivery',
	onAccount: 'On account',
	setOff: 'Set-off',
};

/** ₹23,050 · £280.97: whole rupees, two decimals for other currencies. */
export function noticeMoney(amount: number, currency: string): string {
	const whole = currency === 'INR';
	return new Intl.NumberFormat('en-IN', {
		style: 'currency',
		currency,
		minimumFractionDigits: whole ? 0 : 2,
		maximumFractionDigits: whole ? 0 : 2,
	}).format(amount);
}

/**
 * The shipping line's reason in the email, in the shop checkout's own English words
 * (chk_ship_*), from the rule trace kept on the order.
 */
export function shippingNote(trace: readonly string[]): string {
	const entries = trace.flatMap((raw) => {
		try {
			const entry = JSON.parse(raw) as {
				result?: string;
				units?: number;
				furtherUnits?: number;
				unitAmountINR?: number;
				amountINR?: number;
			};
			return entry && typeof entry.result === 'string' ? [entry] : [];
		} catch {
			return [];
		}
	});
	const abroad = entries.find((entry) => entry.result === 'firstAndFurther');
	if (abroad) return `Sent abroad: first piece, then ${abroad.furtherUnits ?? 0} more`;
	const charged = entries.filter((entry) => entry.result === 'productCharge' && (entry.amountINR ?? 0) > 0);
	if (!charged.length) return entries.length ? 'Every piece ships free' : '';
	const units = charged.reduce((sum, entry) => sum + (entry.units ?? 1), 0);
	const unit = charged[0]?.unitAmountINR ?? charged[0]?.amountINR ?? 0;
	const words = `${units} discounted ${units === 1 ? 'piece' : 'pieces'} × ${noticeMoney(unit, 'INR')}`;
	return entries.some((entry) => entry.result === 'free') ? `${words}; full-price pieces ship free` : words;
}

const oneLine = (address: OrderAddress | undefined): string =>
	address
		? [address.fullName, address.line1, address.line2, `${address.city} ${address.postalCode ?? ''}`.trim()]
				.filter((part) => !!part && part.trim())
				.join(', ')
		: '';

/**
 * Sends the customer messages an order change tells (orders brief 2026-11-20). Runs only after the
 * change is saved, so a message never goes out for a change that didn't happen; a message that
 * fails is recorded in the message outbox by the sender and never undoes the order change. Every
 * message obeys Settings › Communications and the channel switches inside `NotificationPort`.
 */
@Injectable()
export class OrderNoticesService {
	private readonly logger = new Logger('OrderNotices');

	constructor(
		@Inject(NOTIFICATION_PORT) private readonly notifications: NotificationPort,
		@Inject(APP_CONFIG) private readonly config: AppConfig,
	) {}

	/** The billing contact: email from the buyer, mobile from the billing address (owner, message 16). */
	contactOf(order: Order): OrderNoticeContact {
		const mobile = order.addresses?.billing.mobile ?? order.buyer?.mobile ?? null;
		return {
			email: order.buyer?.email ?? null,
			mobile: mobile ? `+${mobile.countryCallingCode}${mobile.number}` : null,
		};
	}

	/** What the history records as "Customer told": only messages that have somewhere to go. */
	plan(order: Order, templates: readonly string[]): OrderNotice[] {
		return plannedNotices(templates, this.contactOf(order));
	}

	/** The messages a saved status change tells; nothing when the status didn't move. */
	async afterChange(before: Order, after: Order, facts: OrderNoticeFacts = {}): Promise<void> {
		const templates = statusNotices(before.status, after.status);
		if (templates.length) await this.send(after, templates, facts);
	}

	/**
	 * Tries each planned message once. `key` makes a retry of the same change safe (the sender
	 * keeps one message per key); by default it is the change's place in the status timeline.
	 */
	async send(
		order: Order,
		templates: readonly string[],
		facts: OrderNoticeFacts = {},
		key: string = String(order.statusTimeline.length),
	): Promise<void> {
		const contact = this.contactOf(order);
		for (const notice of this.plan(order, templates)) {
			const destination = notice.channel === 'email' ? contact.email : contact.mobile;
			if (!destination) continue;
			try {
				const result = await this.notifications.send({
					channel: notice.channel,
					category: 'transactional',
					templateKey: notice.template,
					destination,
					variables: this.variables(order, notice, facts),
					...(order.userId ? { userId: order.userId } : {}),
					idempotencyKey: `order:${order.id}:${notice.template}:${notice.channel}:${key}`,
				});
				if (result.status === 'failed') {
					this.logger.warn(`${notice.template} by ${notice.channel} for ${order.orderNumber} failed`);
				}
			} catch (error) {
				this.logger.warn(
					`${notice.template} by ${notice.channel} for ${order.orderNumber} not sent: ${
						error instanceof Error ? error.message : 'unknown'
					}`,
				);
			}
		}
	}

	/** The template's variables, every figure formatted here (the emails take no logic). */
	variables(order: Order, notice: OrderNotice, facts: OrderNoticeFacts): Record<string, NotificationVariable> {
		// K6: the SMS form drops the hyphens (MSG91's variable takes letters and digits only).
		const sms = notice.channel === 'sms';
		const number = sms ? messageForm(order.orderNumber) : order.orderNumber;
		const base = { order_number: number, order_url: this.orderUrl(order) };
		// SMS amounts are whole rupees: DLT's #numeric# takes no decimal point (templates note 3).
		const rupees = (amountINR: number): string =>
			sms ? String(Math.round(amountINR)) : noticeMoney(amountINR, 'INR');
		switch (notice.template) {
			case 'order_confirmed':
				if (sms) return { ...base, amount: rupees(order.totalINR) };
				return {
					...base,
					order_date: DAY.format(new Date(order.createdAt ?? Date.now())),
					items: this.items(order),
					subtotal: noticeMoney(order.subtotalPaid, order.currency),
					shipping: noticeMoney(order.shipping?.value ?? 0, order.shipping?.currency ?? order.currency),
					shipping_note: shippingNote(order.shipping?.trace ?? []),
					gst_note: 'Included',
					total: noticeMoney(order.totalPaid, order.currency),
					payment_line: this.paymentLine(order),
					delivery_address: oneLine(order.addresses?.delivery),
					has_cancel_note: order.lines.some((line) => line.madeToOrder === true),
				};
			case 'order_shipped':
				return {
					...base,
					courier_name: facts.shipment?.courierName ?? '',
					tracking_number: facts.shipment?.trackingNumber ?? '',
					has_tracking_url: !!facts.shipment?.trackingUrl,
					tracking_url: facts.shipment?.trackingUrl ?? '',
				};
			case 'order_cancelled': {
				const paidINR = order.balance?.paidINR ?? 0;
				return {
					...base,
					has_refund: paidINR > 0,
					refund_line: paidINR > 0 ? `${noticeMoney(paidINR, 'INR')} goes back to the way you paid.` : '',
				};
			}
			case 'order_refunded_sold_out': {
				const sold = new Set(facts.soldOutLineIds ?? []);
				return {
					...base,
					amount: rupees(facts.refundedINR ?? order.totalINR),
					...(sms
						? {}
						: { sold_out_items: this.items(order, (line) => !!line.lineId && sold.has(line.lineId)) }),
					similar_url: this.shopUrl(order, 'collections'),
				};
			}
			case 'refund_processed':
				return {
					...base,
					amount: rupees(facts.refundedINR ?? order.balance?.refundedINR ?? 0),
					method_line: 'the way you paid',
				};
			case 'payment_receipt': {
				const payment = facts.payment;
				return {
					name: order.buyer?.name ?? order.addresses?.billing.fullName ?? '',
					amount: noticeMoney(payment?.amountINR ?? 0, 'INR'),
					method_line: payment
						? [METHOD_WORDS[payment.method], payment.reference ? `ref ${payment.reference}` : '']
								.filter(Boolean)
								.join(' · ')
						: '',
					received_on: payment?.receivedOn
						? DAY.format(new Date(`${payment.receivedOn}T12:00:00+05:30`))
						: DAY.format(new Date()),
					for_line: `Order ${order.orderNumber}`,
					has_balance: false,
					balance_line: '',
				};
			}
			case 'payment_not_completed':
				return { order_number: number, retry_url: this.shopUrl(order, 'checkout') };
			default:
				return base;
		}
	}

	/**
	 * bz06: a receipt on a business's customer account, emailed to its accounts contact (or the
	 * first contact with an email) with the orders it paid and the balance left on the account.
	 */
	async sendBusinessReceipt(
		business: Business,
		receipt: { id: string; documentNumber: string | null },
		input: Pick<BusinessReceiptWrite, 'method' | 'amountINR' | 'reference' | 'receivedOn'>,
		orderNumbers: readonly string[],
		balanceINR: number,
	): Promise<void> {
		const contact =
			business.contacts.find((row) => row.isAccounts && row.email) ??
			business.contacts.find((row) => !!row.email);
		if (!contact?.email) return;
		const words: Readonly<Record<BusinessReceiptWrite['method'], string>> = {
			upi: 'UPI',
			bankTransfer: 'Bank transfer',
			cash: 'Cash',
			cheque: 'Cheque',
		};
		try {
			await this.notifications.send({
				channel: 'email',
				category: 'transactional',
				templateKey: 'payment_receipt',
				destination: contact.email,
				variables: {
					name: business.tradeName || business.legalName,
					amount: noticeMoney(input.amountINR, 'INR'),
					method_line: `${words[input.method]} · ref ${input.reference}`,
					received_on: DAY.format(new Date(`${input.receivedOn}T12:00:00+05:30`)),
					for_line: orderNumbers.length
						? orderNumbers.map((number) => `Order ${number}`).join(', ')
						: 'Your account with us',
					has_balance: true,
					balance_line: `Balance on your account: ${noticeMoney(Math.max(0, balanceINR), 'INR')}.`,
				},
				idempotencyKey: `receipt:${receipt.id}:email`,
			});
		} catch (error) {
			this.logger.warn(
				`payment_receipt for ${receipt.documentNumber ?? receipt.id} not sent: ${
					error instanceof Error ? error.message : 'unknown'
				}`,
			);
		}
	}

	/**
	 * The order's rows as the emails list them. A set's line shows its price from its pieces; its pieces (numbered,
	 * "Included"), their free items and its extras follow beneath it, marked "↳", as on the order pages (bundle
	 * builder brief E05, approved 2026-11-22). A product's free items follow it at "Free".
	 */
	private items(order: Order, keep: (line: Order['lines'][number]) => boolean = () => true): NotificationListRow[] {
		const byId = new Map(order.lines.map((line) => [line.lineId ?? '', line]));
		const childrenOf = (line: Order['lines'][number]) =>
			order.lines.filter((row) => row.parentLineId && row.parentLineId === line.lineId);
		return order.lines.filter(keep).map((line) => {
			const options = Object.values(line.attributes ?? {}).join(' · ');
			if (line.role === 'bundle') {
				const total = childrenOf(line).reduce((sum, row) => sum + row.lineTotalPaid, 0);
				return {
					image: line.imageUrl ?? '',
					name: line.title.en,
					options: 'Set',
					quantity: String(line.quantity),
					price: noticeMoney(total / line.quantity, order.currency),
					total: noticeMoney(total, order.currency),
					note: '',
				};
			}
			const parent = line.parentLineId ? byId.get(line.parentLineId) : undefined;
			if (parent) {
				const depth = parent.parentLineId ? 2 : 1;
				const number =
					line.role === 'piece'
						? `${
								childrenOf(parent)
									.filter((row) => row.role === 'piece')
									.indexOf(line) + 1
							}. `
						: '';
				return {
					image: line.imageUrl ?? '',
					name: `${'  '.repeat(depth - 1)}↳ ${number}${line.title.en}`,
					options,
					quantity: String(line.quantity),
					price:
						line.role === 'free'
							? 'Free'
							: line.role === 'extra'
								? `+${noticeMoney(line.unitPricePaid, order.currency)}`
								: 'Included',
					total: line.role === 'extra' ? noticeMoney(line.lineTotalPaid, order.currency) : '',
					note: line.madeToOrder ? 'Made to order' : '',
				};
			}
			return {
				image: line.imageUrl ?? '',
				name: line.title.en,
				options,
				quantity: String(line.quantity),
				price: noticeMoney(line.unitPricePaid, order.currency),
				total: noticeMoney(line.lineTotalPaid, order.currency),
				note: line.madeToOrder ? 'Made to order' : '',
			};
		});
	}

	/** How it was or will be paid, as order_confirmed says it. */
	private paymentLine(order: Order): string {
		const total = noticeMoney(order.totalPaid, order.currency);
		switch (order.paymentStatus) {
			case 'paid':
				return `Paid ${total}`;
			case 'due_on_delivery':
				return `Cash on delivery: ${noticeMoney(order.totalINR, 'INR')}`;
			case 'on_account':
				return order.onAccountDueOn
					? `On account, due by ${DAY.format(new Date(`${order.onAccountDueOn}T12:00:00+05:30`))}`
					: 'On account';
			default:
				return `${total} due`;
		}
	}

	private orderUrl(order: Order): string {
		return this.shopUrl(order, `account/order/details/${encodeURIComponent(order.orderNumber)}`);
	}

	/** A shop page in the language the order was placed in (emails are in English; links keep the shopper's). */
	private shopUrl(order: Order, path: string): string {
		const origin = this.config.media.shopOrigin?.replace(/\/$/, '') ?? '';
		return `${origin}/${order.locale ?? 'en'}/${path}`;
	}
}
