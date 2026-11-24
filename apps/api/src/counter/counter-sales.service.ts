import { randomUUID } from 'node:crypto';

import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type {
	AdminCartLine,
	CounterSale,
	CounterSaleWrite,
	Order,
	OrderAddress,
	OrderLine,
	OrderPayment,
} from '@saha-textile/contracts';
import {
	istDay,
	orderBalance,
	rolesOf,
	type AdminOrderRepository,
	type CashRepository,
	type CustomerRepository,
	type LocationRepository,
	type OrderPaymentRepository,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';

import { AccountsTemplatesService } from '../accounts-templates/accounts-templates.service';
import { adminLineConfig } from '../admin-orders/admin-line-snapshot';
import { AdminCartService } from '../admin-orders/admin-cart.service';
import { historyEntry, metaOf } from '../admin-orders/admin-orders.service';
import { OrderStock } from '../admin-orders/order-stock';
import type { AuthenticatedPrincipal } from '../auth/session.guard';
import { CashService } from '../cash/cash.service';
import {
	ADMIN_ORDER_REPOSITORY,
	CASH_REPOSITORY,
	CUSTOMER_REPOSITORY,
	LOCATION_REPOSITORY,
	ORDER_PAYMENT_REPOSITORY,
	TRANSACTION_MANAGER,
} from '../infra/tokens';
import { InvoicesService } from '../invoicing/invoices.service';
import { accountsRefusal } from '../ledger/accounts-refusal';
import { BooksPostingService } from '../ledger/books-posting';
import { LedgerService } from '../ledger/ledger.service';
import { DocumentNumbersService } from '../orders-setup/document-numbers.service';
import { childLines, setLine, type TreeLine } from '../orders/order-tree';

const refuse = (code: string) => new BadRequestException(accountsRefusal(code));
const round2 = (value: number) => Math.round(value * 100) / 100;

/** CGST rule 46: a buyer's address is needed at ₹50,000 or more, or when the buyer has a GSTIN. */
export const ADDRESS_NEEDED_FROM_INR = 50_000;

/** A priced cart line as the order tree reads it (as Create order does). */
function treeLine(line: AdminCartLine): TreeLine {
	return {
		id: line.lineId,
		productId: line.productId,
		variationId: line.variationId,
		quantity: line.quantity,
		soldBy: line.soldBy,
		unitPriceINR: line.unitPriceINR,
		mrpINR: line.mrpINR,
		setHeading: line.setHeading,
		children: line.children,
	};
}

/** The order lines of a priced counter cart, in ₹ (a counter sells in rupees only), held so they can be sold now. */
export function counterLines(lines: readonly AdminCartLine[], at: string, actorId: string | null): OrderLine[] {
	return lines.flatMap((line) => {
		const own = {
			lineId: line.lineId,
			productId: line.productId,
			variationId: line.variationId,
			title: { en: line.title },
			sku: line.sku,
			quantity: line.quantity,
			...adminLineConfig(line),
			imageAssetId: null,
			imageUrl: line.imageUrl,
			unitPriceINR: line.unitPriceINR,
			unitPricePaid: line.unitPriceINR,
			lineTotalINR: line.lineTotalINR,
			lineTotalPaid: line.lineTotalINR,
			pricing: {
				regularUnitINR: line.unitPriceINR,
				mrpUnitINR: line.mrpINR !== null && line.mrpINR > line.unitPriceINR ? line.mrpINR : null,
				saleUnitINR: null,
				saleEventId: null,
				zoneRule: null,
				discounted: false,
				addOnsZonePriced: line.addOnsZonePriced,
			},
			couponINR: 0,
			categoryIds: [],
			held: false,
			addedAt: at,
			addedBy: actorId,
			role: 'product',
			parentLineId: null,
			set: null,
		} as OrderLine;
		const tree = treeLine(line);
		const children = childLines(tree, own, (amount: number) => amount, 0, at).map((row) => ({
			...row,
			addedBy: actorId,
		}));
		return [...setLine(own, tree), ...children];
	});
}

/** The address on a counter bill: the buyer's as typed, else the store's city and State (P1). */
export function counterAddress(
	name: string,
	typed: string,
	store: { address: string; city: string; stateCode: string; pin: string },
): OrderAddress {
	return {
		fullName: name || 'Counter sale',
		line1: typed || store.city || store.address || 'Counter',
		city: store.city || 'Counter',
		gstStateCode: store.stateCode,
		postalCode: store.pin,
		country: 'IN',
		savedAddressId: null,
	} as OrderAddress;
}

/**
 * Counter mode (accounts brief P1, P2): a store sells over the counter. The sale is priced as Create order prices,
 * handed over at once (status delivered), its stock leaves the store at once, its tax invoice is issued now, and each
 * payment lands where it was taken: cash in the store's day-sheet box (its sheet must be open), UPI and card in the
 * clearing ledger. All of it in one transaction; the cash line arrives on the sheet by itself.
 */
@Injectable()
export class CounterSalesService {
	constructor(
		private readonly cart: AdminCartService,
		private readonly stock: OrderStock,
		private readonly invoices: InvoicesService,
		private readonly books: BooksPostingService,
		private readonly ledger: LedgerService,
		private readonly numbers: DocumentNumbersService,
		private readonly templates: AccountsTemplatesService,
		private readonly cash: CashService,
		@Inject(ADMIN_ORDER_REPOSITORY) private readonly orders: Pick<AdminOrderRepository, 'create'>,
		@Inject(ORDER_PAYMENT_REPOSITORY) private readonly payments: Pick<OrderPaymentRepository, 'save'>,
		@Inject(CUSTOMER_REPOSITORY) private readonly customers: Pick<CustomerRepository, 'findByPhone'>,
		@Inject(LOCATION_REPOSITORY) private readonly locations: Pick<LocationRepository, 'list'>,
		@Inject(CASH_REPOSITORY) private readonly cashRepo: Pick<CashRepository, 'boxes' | 'openSheet'>,
		@Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManagerPort,
	) {}

	async sell(
		write: CounterSaleWrite,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<CounterSale> {
		const access = await this.cash.access(principal);
		if (!access.all && !access.locationIds.includes(write.locationId))
			throw new ForbiddenException(accountsRefusal('location_out_of_scope'));
		const store = (await this.locations.list()).find((l) => l.id === write.locationId);
		if (!store?.active) throw refuse('location_unknown');
		const priced = await this.cart.price(
			{ buyer: null, currency: 'INR', lines: write.lines.map((l) => ({ ...l, addons: [] })) },
			now,
		);
		const blocked = priced.lines.find((line) => line.problem && line.problem !== 'limited');
		if (blocked) throw refuse(`counter_line_problem:${blocked.problem}:${blocked.sku}`);
		const totalINR = round2(priced.subtotalINR);
		if (Math.abs(totalINR - write.expectedTotalINR) > 0.005)
			throw new ConflictException(accountsRefusal('counter_price_changed'));
		const paidINR = round2(write.payments.reduce((sum, p) => sum + p.amountINR, 0));
		if (Math.abs(paidINR - totalINR) > 0.005) throw refuse('counter_payments_dont_add_up');
		if ((write.buyer.gstin || totalINR >= ADDRESS_NEEDED_FROM_INR) && !write.buyer.address)
			throw refuse('counter_address_needed');
		const cashINR = round2(
			write.payments.filter((p) => p.method === 'cash').reduce((sum, p) => sum + p.amountINR, 0),
		);
		const cashLimit = await this.templates.limitOn('cash_receipt_one_person', istDay(now));
		if (cashLimit !== null && cashINR >= cashLimit) throw refuse('cash_receipt_over_limit');
		if (cashINR > 0 && write.cashHandedINR < cashINR) throw refuse('cash_handed_short');
		const tillLedger = cashINR > 0 ? await this.openTill(write.locationId) : null;
		const chart = await this.ledger.chart();
		const clearing = chart.ledgers.find((l) => l.active && rolesOf(l).includes('upi_card_clearing'))?.id ?? null;
		if (write.payments.some((p) => p.method !== 'cash') && !clearing)
			throw refuse('voucher_problem:role_not_mapped:upi_card_clearing');
		const customer = write.buyer.phone ? await this.customers.findByPhone(write.buyer.phone) : null;
		const at = now.toISOString();
		const actorId = access.userId;
		const lines = counterLines(priced.lines, at, actorId);
		const address = counterAddress(write.buyer.name, write.buyer.address, store);
		const base: Omit<Order, 'id' | 'orderNumber'> = {
			userId: customer?.id ?? null,
			currency: 'INR',
			lines,
			subtotalINR: totalINR,
			subtotalPaid: totalINR,
			shipping: {
				value: 0,
				currency: 'INR',
				chargeINR: 0,
				zone: 'domestic',
				deliveryCountry: 'IN',
				trace: ['counter'],
				ruleSets: [],
				pending: false,
				pieces: [],
			},
			promotionsApplied: [],
			totalINR,
			totalPaid: totalINR,
			status: 'delivered',
			statusTimeline: [{ status: 'delivered', at }],
			channel: 'counter',
			createdBy: actorId,
			buyer: {
				kind: 'person',
				customerId: customer?.id ?? null,
				businessId: null,
				name: write.buyer.name || customer?.displayName || 'Counter sale',
				email: customer?.email ?? null,
				mobile: write.buyer.phone || null,
				gstin: write.buyer.gstin || null,
			},
			addresses: {
				billing: address,
				delivery: address,
				billingSameAsDelivery: true,
				addressInIndia: null,
				invoice: { source: 'none', address: null, needed: false, addedBy: null, confirmedHow: null },
			},
			currencyRecord: {
				code: 'INR',
				rateFromINR: 1,
				inrPerUnit: 1,
				source: 'home',
				rateSetAt: null,
				markupPercent: 0,
				pricedAt: at,
			},
			zone: null,
			coupons: [],
			balance: orderBalance({
				lineTotalsINR: lines.map((line) => line.lineTotalINR),
				couponINR: 0,
				shippingINR: 0,
				payments: [],
			}),
			paymentStatus: 'paid',
			placedWith: 'manual',
			openedAt: null,
			closedAt: null,
			eInvoice: null,
			eWayBill: null,
			packTicks: [],
			history: [
				historyEntry({ id: actorId, name: null }, at, 'created', {
					comment: null,
					detail: { counter: 'sold' },
				}),
			],
			revision: 0,
			createdAt: at,
			updatedAt: at,
			shipsFromLocationId: write.locationId,
		} as unknown as Omit<Order, 'id' | 'orderNumber'>;
		return this.tx.withTransaction(async (context) => {
			const orderNumber = await this.numbers.orderNumber(context, now);
			let order = { ...base, id: `ord_${randomUUID()}`, orderNumber } as Order;
			await this.stock.reserve(order, order.lines, actorId, context, at);
			order = { ...order, lines: order.lines.map((line) => ({ ...line, held: line.role !== 'bundle' })) };
			await this.stock.sell(order, order.lines, actorId, context, at);
			const saved = await this.orders.create(order, `counter:${order.id}`, context, metaOf(order));
			const invoice = await this.invoices.issueAtCounter(saved, actorId, at, context);
			const receiptNumbers: string[] = [];
			for (const pay of write.payments) {
				const receiptNumber = await this.numbers.issue('receipt', context, now);
				receiptNumbers.push(receiptNumber);
				const payment = {
					id: `pay_${randomUUID()}`,
					orderId: saved.id,
					method: pay.method,
					state: 'received',
					amountINR: pay.amountINR,
					currency: 'INR',
					amount: pay.amountINR,
					reference: pay.reference || null,
					gateway: null,
					paypal: null,
					collector: null,
					collectedBy: null,
					receivedOn: istDay(now),
					receiptNumber,
					ledgerId: pay.method === 'cash' ? tillLedger : clearing,
					note: null,
					proofMediaId: null,
					recordedBy: actorId,
					recordedAt: at,
				} as OrderPayment;
				await this.payments.save(payment, context);
				await this.books.paymentReceived(payment, saved, context, actorId, { keepCustomerPayment: false });
			}
			return {
				orderId: saved.id,
				orderNumber: saved.orderNumber,
				invoiceId: invoice.id,
				invoiceNumber: invoice.number,
				totalINR,
				changeINR: cashINR > 0 ? round2(write.cashHandedINR - cashINR) : 0,
				receiptNumbers,
				print: write.print,
			};
		});
	}

	/** The store's day-sheet box with its sheet open: where counter cash lands. */
	private async openTill(locationId: string): Promise<string> {
		const boxes = (await this.cashRepo.boxes()).filter(
			(b) => b.active && b.locationId === locationId && b.kind === 'day_sheet',
		);
		for (const box of boxes) if (await this.cashRepo.openSheet(box.id)) return box.ledgerId;
		throw new ConflictException(accountsRefusal('cash_sheet_not_open'));
	}
}
