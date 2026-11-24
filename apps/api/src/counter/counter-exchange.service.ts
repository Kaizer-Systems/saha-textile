import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Inject,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import type {
	CounterBill,
	CounterExchange,
	CounterExchangeWrite,
	CounterPaymentWrite,
	Order,
} from '@saha-textile/contracts';
import {
	istDay,
	type AdminOrderRepository,
	type TaxInvoiceRepository,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import { ADMIN_ORDER_REPOSITORY, TAX_INVOICE_REPOSITORY, TRANSACTION_MANAGER } from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';
import { LocationsService } from '../locations/locations.service';
import { ReturnsService } from '../returns/returns.service';
import { ADDRESS_NEEDED_FROM_INR, CounterSalesService } from './counter-sales.service';

const round2 = (value: number) => Math.round(value * 100) / 100;
const refuse = (code: string) => new BadRequestException(accountsRefusal(code));

/** A buyer's mobile as typed at the counter, or as a number with its country code. */
export function phoneOf(mobile: string | { countryCallingCode: string; number: string } | null | undefined): string {
	if (!mobile) return '';
	return typeof mobile === 'string' ? mobile : `+${mobile.countryCallingCode} ${mobile.number}`;
}

/** The buyer of the first bill carries over; the address only when the first bill needed one. */
function buyerOf(order: Order) {
	const buyer = order.buyer;
	const typed = !!buyer?.gstin || order.totalINR >= ADDRESS_NEEDED_FROM_INR;
	return {
		phone: phoneOf(buyer?.mobile),
		name: buyer?.name && buyer.name !== 'Counter sale' ? buyer.name : '',
		address: typed ? (order.addresses?.billing?.line1 ?? '') : '',
		gstin: buyer?.gstin ?? '',
	};
}

/**
 * Exchange at the counter (accounts brief P3). What comes back is returned, checked and credited on a credit note
 * against the bill; what goes out instead is a new counter sale. The credit note is paid back in cash from the store's
 * till and the new sale is paid with that cash first, so the till's sheet shows the two lines that net to the
 * difference; a difference the buyer pays may be cash, UPI or card. All of it in one transaction.
 */
@Injectable()
export class CounterExchangeService {
	constructor(
		private readonly returns: ReturnsService,
		private readonly sales: CounterSalesService,
		private readonly reach: LocationsService,
		@Inject(ADMIN_ORDER_REPOSITORY)
		private readonly orders: Pick<AdminOrderRepository, 'findById' | 'findByNumber'>,
		@Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManagerPort,
		@Inject(TAX_INVOICE_REPOSITORY) private readonly invoices: Pick<TaxInvoiceRepository, 'list'>,
	) {}

	/** A counter bill found by its order number or its tax invoice number, as printed on the roll. */
	async find(number: string, principal: AuthenticatedPrincipal | undefined): Promise<{ orderId: string }> {
		const typed = number.trim().toUpperCase();
		let orderId = (await this.orders.findByNumber(typed))?.id ?? null;
		if (!orderId) {
			const { items } = await this.invoices.list({
				from: '2000-01-01',
				to: '2999-12-31',
				search: typed,
				page: 1,
				pageSize: 5,
			});
			orderId = items.find((i) => i.number === typed)?.orderId ?? null;
		}
		return { orderId: (await this.counterOrder(orderId ?? '', principal)).id };
	}

	private async counterOrder(orderId: string, principal: AuthenticatedPrincipal | undefined): Promise<Order> {
		const order = await this.orders.findById(orderId);
		if (order?.channel !== 'counter') throw new NotFoundException(accountsRefusal('counter_sale_not_found'));
		const scope = await this.reach.scope(principal);
		if (!scope.all && !scope.ids.includes(order.shipsFromLocationId ?? ''))
			throw new ForbiddenException(accountsRefusal('location_out_of_scope'));
		return order;
	}

	/** The bill as the exchange page reads it: what can still come back, at what was paid. */
	async bill(orderId: string, principal: AuthenticatedPrincipal | undefined, now = new Date()): Promise<CounterBill> {
		const order = await this.counterOrder(orderId, principal);
		const view = await this.returns.view(orderId, istDay(now));
		const buyer = buyerOf(order);
		return {
			orderId: order.id,
			orderNumber: order.orderNumber,
			locationId: order.shipsFromLocationId as string,
			buyerName: buyer.name,
			buyerPhone: buyer.phone,
			invoiceNumber: view.invoiceNumber,
			deliveredOn: view.deliveredOn,
			windowOpen: view.windowOpen,
			lines: view.returnable,
		};
	}

	async exchange(
		orderId: string,
		write: CounterExchangeWrite,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<CounterExchange> {
		const order = await this.counterOrder(orderId, principal);
		const locationId = order.shipsFromLocationId as string;
		const actorId = principal?.userId ?? null;
		return this.tx.withTransaction(async () => {
			const till = await this.sales.openTill(locationId);
			const entry = await this.returns.start(
				orderId,
				{
					lines: write.back.map((b) => ({ lineId: b.lineId, quantity: b.quantity })),
					reason: write.reason,
					how: 'customer_sends',
					refundTo: 'original_payment',
					note: 'Exchange at the counter',
				},
				actorId,
				now,
			);
			await this.returns.step(entry.id, { to: 'received' }, actorId, now);
			await this.returns.check(
				entry.id,
				{
					lines: write.back.map((b) => ({
						lineId: b.lineId,
						outcome: b.goes === 'stock' ? ('restock' as const) : ('damaged' as const),
						note: '',
					})),
				},
				actorId,
				now,
			);
			const draft = await this.returns.fromReturn(entry.id, actorId, now);
			const note = await this.returns.issue(draft.id, draft.version, actorId, now);
			const backINR = note.totalINR;
			// Within the rupee a credit note's round-off may move it.
			if (Math.abs(backINR - write.expectedBackINR) > 1)
				throw new ConflictException(accountsRefusal('counter_price_changed'));
			const outINR = write.out.length ? write.expectedOutINR : 0;
			const differenceINR = round2(outINR - backINR);
			if (differenceINR < 0 && write.settle !== 'cash') throw refuse('counter_exchange_refund_in_cash');
			// The credit note is paid back in cash from the till; the new sale takes that cash first.
			await this.returns.refund(
				note.id,
				{ how: 'by_hand', method: 'cash', ledgerId: till, reference: `CASH ${note.number}` },
				actorId,
				now,
			);
			let sale = null;
			if (write.out.length) {
				const fromCredit = Math.min(backINR, outINR);
				const owed = round2(outINR - fromCredit);
				const payments: [CounterPaymentWrite, ...CounterPaymentWrite[]] =
					write.settle === 'cash' || owed === 0
						? [{ method: 'cash', amountINR: outINR, reference: '' }]
						: [
								{ method: 'cash', amountINR: fromCredit, reference: '' },
								{ method: write.settle, amountINR: owed, reference: write.reference },
							];
				sale = await this.sales.sell(
					{
						locationId,
						lines: write.out,
						buyer: buyerOf(order),
						payments,
						cashHandedINR: payments[0].amountINR,
						print: 'roll80',
						expectedTotalINR: write.expectedOutINR,
					},
					principal,
					now,
					note.id,
				);
			}
			return {
				creditNoteId: note.id,
				creditNoteNumber: note.number as string,
				backINR,
				outINR,
				differenceINR,
				sale,
			};
		});
	}
}
