import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CounterPaymentMethod, CounterSummary, CounterSummaryQuery, Order } from '@saha-textile/contracts';
import type {
	AdminOrderRepository,
	CashRepository,
	CreditNoteRepository,
	LocationRepository,
	OrderPaymentRepository,
	TaxInvoiceRepository,
} from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import { CashService } from '../cash/cash.service';
import {
	ADMIN_ORDER_REPOSITORY,
	CASH_REPOSITORY,
	CREDIT_NOTE_REPOSITORY,
	LOCATION_REPOSITORY,
	ORDER_PAYMENT_REPOSITORY,
	TAX_INVOICE_REPOSITORY,
} from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';

const round2 = (value: number) => Math.round(value * 100) / 100;
const METHODS: readonly CounterPaymentMethod[] = ['cash', 'upi', 'card'];
const PAGE = 100;

/**
 * The counter summary (accounts brief P4): a store's day at the counter, bills by how they were paid, credit notes for
 * what came back, the new items of exchanges, and the day's sheet. The cashier's copy leaves out cash (and the net,
 * which would give it away), as the blind count does.
 */
@Injectable()
export class CounterSummaryService {
	constructor(
		private readonly cash: CashService,
		@Inject(ADMIN_ORDER_REPOSITORY) private readonly orders: Pick<AdminOrderRepository, 'list' | 'findById'>,
		@Inject(ORDER_PAYMENT_REPOSITORY) private readonly payments: Pick<OrderPaymentRepository, 'listByOrder'>,
		@Inject(TAX_INVOICE_REPOSITORY) private readonly invoices: Pick<TaxInvoiceRepository, 'listForOrder'>,
		@Inject(CREDIT_NOTE_REPOSITORY) private readonly notes: Pick<CreditNoteRepository, 'list'>,
		@Inject(LOCATION_REPOSITORY) private readonly locations: Pick<LocationRepository, 'list'>,
		@Inject(CASH_REPOSITORY) private readonly cashRepo: Pick<CashRepository, 'boxes' | 'sheetOn'>,
	) {}

	/** The day's counter bills at a store, every page of them. */
	private async counterOrders(date: string, locationId: string): Promise<Order[]> {
		const found: Order[] = [];
		for (let page = 1; ; page++) {
			const { orders, total } = await this.orders.list({
				channel: 'counter',
				filter: 'all',
				from: date,
				to: date,
				page,
				pageSize: PAGE,
			});
			found.push(...orders);
			if (!orders.length || page * PAGE >= total) break;
		}
		return found.filter((o) => o.shipsFromLocationId === locationId);
	}

	/** Credit notes issued that day at the store against counter bills. */
	private async counterNotes(date: string, locationId: string) {
		const found = [];
		for (let page = 1; ; page++) {
			const { items, total } = await this.notes.list({
				from: date,
				to: date,
				search: '',
				status: 'issued',
				page,
				pageSize: PAGE,
			});
			found.push(...items);
			if (!items.length || page * PAGE >= total) break;
		}
		const mine = [];
		for (const note of found)
			if (note.locationId === locationId && (await this.orders.findById(note.orderId))?.channel === 'counter')
				mine.push(note);
		return mine;
	}

	async summary(query: CounterSummaryQuery, principal: AuthenticatedPrincipal | undefined): Promise<CounterSummary> {
		const access = await this.cash.access(principal);
		if (!access.all && !access.locationIds.includes(query.locationId))
			throw new ForbiddenException(accountsRefusal('location_out_of_scope'));
		const store = (await this.locations.list()).find((l) => l.id === query.locationId);
		if (!store) throw new NotFoundException(accountsRefusal('location_unknown'));
		const orders = await this.counterOrders(query.date, query.locationId);
		const by = new Map(METHODS.map((m) => [m, { bills: new Set<string>(), amountINR: 0 }]));
		const billNumbers: string[] = [];
		const times: string[] = [];
		let discountsINR = 0;
		const exchangeNew = { bills: 0, amountINR: 0 };
		for (const order of orders) {
			for (const payment of await this.payments.listByOrder(order.id)) {
				const row = by.get(payment.method as CounterPaymentMethod);
				if (!row || payment.state !== 'received') continue;
				row.bills.add(order.id);
				row.amountINR = round2(row.amountINR + payment.amountINR);
			}
			for (const invoice of await this.invoices.listForOrder(order.id))
				if (invoice.status === 'issued') billNumbers.push(invoice.number);
			if (order.createdAt) times.push(order.createdAt);
			discountsINR = round2(discountsINR + order.lines.reduce((sum, line) => sum + line.couponINR, 0));
			if (order.history[0]?.detail['counter'] === 'exchange') {
				exchangeNew.bills += 1;
				exchangeNew.amountINR = round2(exchangeNew.amountINR + order.totalINR);
			}
		}
		const notes = await this.counterNotes(query.date, query.locationId);
		const returns = { notes: notes.length, amountINR: round2(notes.reduce((sum, n) => sum + n.totalINR, 0)) };
		const sold = round2([...by.values()].reduce((sum, row) => sum + row.amountINR, 0));
		const tills = (await this.cashRepo.boxes()).filter(
			(b) => b.active && b.kind === 'day_sheet' && b.locationId === query.locationId,
		);
		let sheetStatus: string | null = null;
		for (const box of tills) sheetStatus ??= (await this.cashRepo.sheetOn(box.id, query.date))?.status ?? null;
		times.sort();
		const cash = access.manager;
		return {
			date: query.date,
			locationId: query.locationId,
			locationName: store.name,
			byMethod: METHODS.map((method) => {
				const row = by.get(method) as { bills: Set<string>; amountINR: number };
				return { method, bills: row.bills.size, amountINR: method === 'cash' && !cash ? null : row.amountINR };
			}),
			returns,
			exchangeNew,
			netSalesINR: cash ? round2(sold - returns.amountINR) : null,
			billNumbers: billNumbers.sort(),
			firstAt: times[0] ?? null,
			lastAt: times.at(-1) ?? null,
			discountsINR,
			sheetStatus,
			cash,
		};
	}
}
