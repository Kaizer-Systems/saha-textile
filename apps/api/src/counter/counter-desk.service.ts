import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CounterHere, CounterQuote, CounterQuoteWrite, CounterScan, DocumentPaper } from '@saha-textile/contracts';
import {
	gstStateName,
	type AdminOrderRepository,
	type CashRepository,
	type LocationRepository,
	type StockReadRepository,
	istDay,
} from '@saha-textile/core-domain';

import { AdminCartService } from '../admin-orders/admin-cart.service';
import type { AuthenticatedPrincipal } from '../auth/session.guard';
import { DocumentFormatsService } from '../documents/document-formats.service';
import { previewDocument } from '../documents/document-previews';
import { taxInvoiceData } from '../documents/tax-invoice-print';
import { ADMIN_ORDER_REPOSITORY, CASH_REPOSITORY, LOCATION_REPOSITORY, STOCK_READ_REPOSITORY } from '../infra/tokens';
import { InvoicesService } from '../invoicing/invoices.service';
import { accountsRefusal } from '../ledger/accounts-refusal';
import { LocationsService } from '../locations/locations.service';
import { counterLines } from './counter-sales.service';

const round2 = (value: number) => Math.round(value * 100) / 100;

/** "Kolkata, West Bengal": what a counter bill without the buyer's address says (P1). */
export function placeOf(location: { city: string; stateCode: string }): string {
	return [location.city, gstStateName(location.stateCode)].filter(Boolean).join(', ');
}

/**
 * The counter's desk (accounts brief P1): the stores a person sells at, what a scanned SKU is, and the items priced
 * with the tax their invoice will show, before anything is sold.
 */
@Injectable()
export class CounterDeskService {
	constructor(
		private readonly cart: AdminCartService,
		private readonly invoices: InvoicesService,
		private readonly reach: LocationsService,
		@Inject(LOCATION_REPOSITORY) private readonly locations: Pick<LocationRepository, 'list'>,
		@Inject(CASH_REPOSITORY) private readonly cashRepo: Pick<CashRepository, 'boxes' | 'openSheet'>,
		@Inject(STOCK_READ_REPOSITORY) private readonly stock: Pick<StockReadRepository, 'bySku'>,
		@Inject(ADMIN_ORDER_REPOSITORY) private readonly orders: Pick<AdminOrderRepository, 'findById'>,
		private readonly formats: DocumentFormatsService,
	) {}

	/** Stores in the person's reach with a day-sheet box: counter mode is offered only there. */
	async here(principal: AuthenticatedPrincipal | undefined): Promise<CounterHere> {
		const scope = await this.reach.scope(principal);
		const [all, boxes] = await Promise.all([this.locations.list(), this.cashRepo.boxes()]);
		const stores: CounterHere['stores'] = [];
		for (const location of all) {
			if (!location.active || !(scope.all || scope.ids.includes(location.id))) continue;
			const tills = boxes.filter((b) => b.active && b.kind === 'day_sheet' && b.locationId === location.id);
			if (!tills.length) continue;
			let sheetOpen = false;
			for (const box of tills) if (await this.cashRepo.openSheet(box.id)) sheetOpen = true;
			stores.push({ locationId: location.id, name: location.name, place: placeOf(location), sheetOpen });
		}
		const current = stores.some((s) => s.locationId === scope.current) ? scope.current : null;
		return { current, stores };
	}

	/** A scanned code is a SKU, exactly; a set is sold from its card, never scanned. */
	async scan(code: string): Promise<CounterScan> {
		const fact = (await this.stock.bySku([code])).get(code);
		if (!fact || fact.productType === 'bundle')
			throw new NotFoundException(accountsRefusal('counter_code_unknown'));
		const name = fact.title['en'] ?? Object.values(fact.title)[0] ?? fact.sku;
		return {
			productId: fact.productId,
			variationId: fact.productType === 'variable' ? fact.variantId : null,
			sku: fact.sku,
			title: [name, fact.optionsLabel].filter(Boolean).join(' · '),
			soldBy: fact.soldBy,
		};
	}

	/** The items as the sale will price them, with the tax its invoice will show. */
	async quote(
		write: CounterQuoteWrite,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<CounterQuote> {
		const scope = await this.reach.scope(principal);
		if (!scope.all && !scope.ids.includes(write.locationId))
			throw new ForbiddenException(accountsRefusal('location_out_of_scope'));
		if (!write.lines.length) return { lines: [], taxableINR: 0, cgstINR: 0, sgstINR: 0, totalINR: 0, problems: [] };
		const priced = await this.cart.price(
			{ buyer: null, currency: 'INR', lines: write.lines.map((l) => ({ ...l, addons: [] })) },
			now,
		);
		const preview = await this.invoices.counterPreview(
			counterLines(priced.lines, now.toISOString(), null),
			write.locationId,
			istDay(now),
		);
		return {
			lines: priced.lines,
			...preview.totals,
			totalINR: round2(priced.subtotalINR),
			problems: preview.problems,
		};
	}

	/**
	 * A counter sale's tax invoice, printed for the buyer (P2): on its format's paper (A4 by default), or the 80 mm
	 * roll. Behind the counter's own permission, so a cashier prints what they sold.
	 */
	async print(
		orderId: string,
		paper: DocumentPaper | null,
		principal: AuthenticatedPrincipal | undefined,
	): Promise<{ bytes: Uint8Array; fileName: string }> {
		const order = await this.orders.findById(orderId);
		if (order?.channel !== 'counter') throw new NotFoundException(accountsRefusal('counter_sale_not_found'));
		const scope = await this.reach.scope(principal);
		if (!scope.all && !scope.ids.includes(order.shipsFromLocationId ?? ''))
			throw new ForbiddenException(accountsRefusal('location_out_of_scope'));
		const invoice = (await this.invoices.listForOrder(orderId)).find((i) => i.status === 'issued');
		if (!invoice) throw new NotFoundException(accountsRefusal('counter_sale_not_found'));
		const seller = await this.formats.seller(previewDocument('taxInvoice').seller);
		const bytes = await this.formats.renderActiveCopies(
			'taxInvoice',
			[taxInvoiceData(invoice, seller, 'original', null)],
			paper,
		);
		return { bytes, fileName: `${invoice.number.replace(/\//g, '-')}.pdf` };
	}
}
