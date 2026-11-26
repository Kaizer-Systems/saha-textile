import { randomUUID } from 'node:crypto';

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
	type InvoiceCheck,
	type Order,
	type OrderLine,
	TaxInvoice,
	type TaxInvoiceAccounting,
} from '@saha-textile/contracts';
import {
	buildInvoiceLines,
	type CompanyRepository,
	defaultStockLocation,
	gstStateName,
	type InvoiceLineInput,
	invoicePosting,
	istDay,
	termsOn,
	type LocationRepository,
	type ProductRepository,
	type ShopDetailsRepository,
	type TaxInvoiceRepository,
	type TransactionContext,
	type TransactionManagerPort,
	rolesOf,
} from '@saha-textile/core-domain';

import {
	COMPANY_REPOSITORY,
	LOCATION_REPOSITORY,
	PRODUCT_REPOSITORY,
	SHOP_DETAILS_REPOSITORY,
	TAX_INVOICE_REPOSITORY,
	TRANSACTION_MANAGER,
} from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';
import { BooksPostingService } from '../ledger/books-posting';
import { LedgerService } from '../ledger/ledger.service';
import { DocumentNumbersService } from '../orders-setup/document-numbers.service';

export interface DispatchInput {
	order: Order;
	shipmentId: string;
	/** The lines in this parcel. */
	lineIds: readonly string[];
	actorId: string | null;
	at: string;
}

/**
 * Tax invoices issued when goods leave (accounts brief D1, D3; owner-approved 2026-11-23). With Settings ›
 * Features › Tax invoices at dispatch on, Shipped issues the parcel's invoice in its own transaction: numbered per
 * GSTIN, HSN and GST on every line at today's rates (marked "rates wait for the CA"), and posted to the books.
 */
@Injectable()
export class InvoicesService {
	constructor(
		@Inject(TAX_INVOICE_REPOSITORY) private readonly invoices: TaxInvoiceRepository,
		@Inject(COMPANY_REPOSITORY) private readonly company: CompanyRepository,
		@Inject(LOCATION_REPOSITORY) private readonly locations: Pick<LocationRepository, 'list'>,
		@Inject(SHOP_DETAILS_REPOSITORY) private readonly shop: Pick<ShopDetailsRepository, 'get'>,
		@Inject(PRODUCT_REPOSITORY) private readonly products: Pick<ProductRepository, 'findById'>,
		private readonly numbers: DocumentNumbersService,
		private readonly ledger: LedgerService,
		@Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManagerPort,
		private readonly books: BooksPostingService,
	) {}

	async enabled(): Promise<boolean> {
		return (await this.company.getFeatures())?.on.tax_invoices === true;
	}

	listForOrder(orderId: string): Promise<TaxInvoice[]> {
		return this.invoices.listForOrder(orderId);
	}

	async get(id: string): Promise<TaxInvoice> {
		const invoice = await this.invoices.get(id);
		if (!invoice) throw new NotFoundException('invoice_not_found');
		return invoice;
	}

	/** Q5, the Accounting tab: the invoice's posted lines by name, and the checks it passed when issued. */
	async accounting(id: string): Promise<TaxInvoiceAccounting> {
		const invoice = await this.get(id);
		const [voucher, chart, allLocations, earlier] = await Promise.all([
			invoice.voucherId ? this.ledger.voucher(invoice.voucherId).catch(() => null) : null,
			this.ledger.chart(),
			this.locations.list(),
			this.previousInSeries(invoice),
		]);
		const ledgerOf = (ledgerId: string) => chart.ledgers.find((l) => l.id === ledgerId);
		const lines = (voucher?.lines ?? []).map((line) => ({
			ledgerId: line.ledgerId,
			ledgerName: ledgerOf(line.ledgerId)?.name ?? line.ledgerId,
			locationName: allLocations.find((l) => l.id === line.locationId)?.name ?? line.locationId,
			debitPaise: line.debitPaise,
			creditPaise: line.creditPaise,
		}));
		const costPaise = (voucher?.lines ?? [])
			.filter((line) => {
				const ledger = ledgerOf(line.ledgerId);
				return !!ledger && rolesOf(ledger).includes('cost_of_goods_sold');
			})
			.reduce((sum, line) => sum + line.debitPaise, 0);
		const state = (code: string) => (code === '96' ? 'Outside India' : (gstStateName(code) ?? code));
		const checks: InvoiceCheck[] = [
			{ key: 'period_open', ok: !!voucher, params: { month: invoice.date.slice(0, 7) } },
			{ key: 'number_in_series', ok: earlier !== false, params: earlier ? { previous: earlier } : {} },
			{
				key: 'place_of_supply',
				ok: true,
				params: {
					from: state(invoice.seller.stateCode),
					to: state(invoice.placeOfSupply),
					tax: invoice.interState ? 'IGST' : 'CGST + SGST',
				},
			},
			{ key: 'stock_at_cost', ok: costPaise > 0, params: { cost: (costPaise / 100).toFixed(2) } },
			{ key: 'rates', ok: !invoice.ratesPendingCa, params: {} },
			{ key: 'cancel', ok: false, params: { shipped: invoice.shipmentId ? 'yes' : 'no' } },
		];
		return {
			voucherId: voucher?.id ?? null,
			voucherNumber: voucher?.number ?? null,
			lines,
			totalPaise: voucher?.totalPaise ?? 0,
			checks,
		};
	}

	/**
	 * The number before this one in its GSTIN's series: its text when it exists, '' for the first of a series,
	 * false when it is missing (a gap). Numbers end in their counter ("TI/26-27/000145").
	 */
	private async previousInSeries(invoice: TaxInvoice): Promise<string | false> {
		const digits = /\d+$/.exec(invoice.number)?.[0] ?? '';
		const n = Number(digits);
		if (n <= 1) return '';
		const previous = `${invoice.number.slice(0, -digits.length)}${String(n - 1).padStart(digits.length, '0')}`;
		const found = await this.invoices.list({
			from: '2000-01-01',
			to: '2999-12-31',
			search: previous,
			page: 1,
			pageSize: 5,
		});
		return found.items.some((i) => i.number === previous && i.gstin === invoice.gstin) ? previous : false;
	}

	/**
	 * The parcel's invoice, in the Shipped transaction; null while the switch is off. A repeat returns the first.
	 * An invoice issued before dispatch for the order's e-way bill or e-invoice is tied to the parcel instead of a
	 * second one, and a line is never invoiced twice.
	 */
	async issueAtDispatch(input: DispatchInput, context: TransactionContext): Promise<TaxInvoice | null> {
		if (!(await this.enabled())) return null;
		const existing = await this.invoices.findByShipment(input.shipmentId, context);
		if (existing) return existing;
		const issued = (await this.invoices.listForOrder(input.order.id)).filter((i) => i.status === 'issued');
		const pending = issued.find((i) => !i.shipmentId) ?? null;
		if (pending) await this.invoices.linkShipment(pending.id, input.shipmentId, context);
		const invoiced = new Set(issued.flatMap((i) => i.lines.map((l) => l.lineId)));
		const lineIds = input.lineIds.filter((lineId) => !invoiced.has(lineId));
		if (!lineIds.length) return pending;
		return this.issue(input.order, lineIds, pending ? null : input.shipmentId, input.actorId, input.at, context);
	}

	/**
	 * Generate e-way bill or e-invoice on a packed order (EI5B): the goods are about to leave, and the portal needs
	 * the tax invoice's number, so the invoice is issued now and Shipped ties it to the parcel. Null while the
	 * switch is off or the order isn't packed yet; an invoice already waiting is returned as it is.
	 */
	async issueBeforeDispatch(order: Order, actorId: string | null, at = new Date().toISOString()) {
		if (!(await this.enabled()) || order.status !== 'packed') return null;
		const issued = (await this.invoices.listForOrder(order.id)).filter((i) => i.status === 'issued');
		const waiting = issued.find((i) => !i.shipmentId);
		if (waiting) return waiting;
		const invoiced = new Set(issued.flatMap((i) => i.lines.map((l) => l.lineId)));
		const lineIds = order.lines.flatMap((line) =>
			line.lineId && line.role !== 'bundle' && !invoiced.has(line.lineId) ? [line.lineId] : [],
		);
		if (!lineIds.length) return null;
		return this.tx.withTransaction((context) => this.issue(order, lineIds, null, actorId, at, context));
	}

	/**
	 * A counter sale (accounts brief P2): the goods leave at once, so every line is invoiced now, in the sale's own
	 * transaction. Refused while the tax invoices switch is off: a counter sale can't go without its invoice.
	 */
	async issueAtCounter(
		order: Order,
		actorId: string | null,
		at: string,
		context: TransactionContext,
	): Promise<TaxInvoice> {
		if (!(await this.enabled())) throw new BadRequestException(accountsRefusal('tax_invoices_off'));
		const lineIds = order.lines.flatMap((line) => (line.lineId && line.role !== 'bundle' ? [line.lineId] : []));
		return this.issue(order, lineIds, null, actorId, at, context);
	}

	/**
	 * What a counter sale's invoice will say before it is made (P1): its lines and tax, sold in the store's State, and
	 * the lines it can't take yet, by SKU. A store whose GSTIN is under composition issues a bill of supply: no tax.
	 */
	async counterPreview(
		lines: readonly OrderLine[],
		locationId: string | null = null,
		day = istDay(new Date()),
	): Promise<{
		totals: { taxableINR: number; cgstINR: number; sgstINR: number };
		problems: { sku: string; problem: string }[];
	}> {
		const inputs = await this.inputsOf(lines.flatMap((line) => (line.role === 'bundle' ? [] : [line])));
		const built = buildInvoiceLines(inputs, {
			interState: false,
			shippingINR: 0,
			composition: await this.underComposition(locationId, day),
		});
		const skuOf = new Map(inputs.map((input) => [input.lineId, input.sku]));
		return {
			totals: {
				taxableINR: built.totals.taxableINR,
				cgstINR: built.totals.cgstINR,
				sgstINR: built.totals.sgstINR,
			},
			problems: built.problems.map((p) => ({ sku: skuOf.get(p.lineId) as string, problem: p.problem })),
		};
	}

	/** Whether a location's GSTIN is under composition on a day (G2); false without a location or a GSTIN. */
	private async underComposition(locationId: string | null, day: string): Promise<boolean> {
		if (!locationId) return false;
		const location = (await this.locations.list()).find((l) => l.id === locationId);
		const registration = location?.gstRegistrationId
			? await this.company.getRegistration(location.gstRegistrationId)
			: null;
		return !!registration && termsOn(registration, day)?.kind === 'composition';
	}

	/** An invoice's line inputs: the HSN snapshot on the line, else the product's own. */
	private async inputsOf(lines: readonly OrderLine[]): Promise<InvoiceLineInput[]> {
		const inputs: InvoiceLineInput[] = [];
		for (const line of lines) {
			// The product says whether it is sold by the metre (its quantities kept in tenths) and gives the HSN a line lacks.
			const product = await this.products.findById(line.productId).catch(() => null);
			const hsn = line.tax?.hsn || product?.hsnCode || null;
			inputs.push({
				lineId: line.lineId as string,
				sku: line.sku,
				title: line.title['en'] ?? Object.values(line.title)[0] ?? line.sku,
				hsn,
				quantity: line.quantity,
				unit: product?.soldBy === 'metre' ? 'MTR' : 'PCS',
				lineTotalINR: line.lineTotalINR,
			});
		}
		return inputs;
	}

	/** The order's invoice waiting for its parcel or, failing that, its latest one (e-documents cite it). */
	async currentFor(orderId: string): Promise<TaxInvoice | null> {
		const issued = (await this.invoices.listForOrder(orderId)).filter((i) => i.status === 'issued');
		return issued.find((i) => !i.shipmentId) ?? issued.at(-1) ?? null;
	}

	private async issue(
		order: Order,
		lineIds: readonly string[],
		shipmentId: string | null,
		actorId: string | null,
		at: string,
		context: TransactionContext,
	): Promise<TaxInvoice> {
		const shipped = order.lines.flatMap((line) =>
			line.lineId && lineIds.includes(line.lineId) && line.role !== 'bundle'
				? [{ ...line, lineId: line.lineId }]
				: [],
		);
		const [allLocations, earlier, shop] = await Promise.all([
			this.locations.list(),
			this.invoices.listForOrder(order.id).then((all) => all.filter((i) => i.status === 'issued')),
			this.shop.get(),
		]);
		const locationId = order.shipsFromLocationId ?? defaultStockLocation(allLocations);
		const location = allLocations.find((l) => l.id === locationId);
		if (!location) throw new BadRequestException(accountsRefusal('invoice_problem:no_location'));
		const registration =
			(location.gstRegistrationId ? await this.company.getRegistration(location.gstRegistrationId) : null) ??
			(shop?.gstin ? await this.company.findRegistrationByGstin(shop.gstin) : null);
		if (!registration) throw new BadRequestException(accountsRefusal('invoice_problem:no_gst_registration'));
		const delivery = order.addresses?.delivery;
		const sellerState = registration.stateCode;
		const abroad = !!delivery?.country && !['IN', 'India'].includes(delivery.country);
		const placeOfSupply = abroad ? '96' : (delivery?.gstStateCode ?? sellerState);
		const interState = placeOfSupply !== sellerState;
		const date = istDay(at);
		// G2: under composition the GSTIN issues bills of supply, and only inside its State.
		const composition = termsOn(registration, date)?.kind === 'composition';
		if (composition && interState)
			throw new BadRequestException(accountsRefusal('invoice_problem:composition_inter_state'));
		const inputs = await this.inputsOf(shipped);
		// The delivery charge goes on the order's first invoice.
		const shippingINR = earlier.length ? 0 : (order.shipping?.chargeINR ?? 0);
		const built = buildInvoiceLines(inputs, { interState, shippingINR, composition });
		const problem = built.problems[0];
		if (problem) {
			const sku = inputs.find((l) => l.lineId === problem.lineId)?.sku;
			throw new BadRequestException(accountsRefusal(`invoice_problem:${problem.problem}${sku ? `:${sku}` : ''}`));
		}
		const id = `ti_${randomUUID()}`;
		const number = await this.numbers.issue('taxInvoice', context, new Date(at), registration.id);
		const costINR = shipped.reduce((sum, line) => sum + (line.unitCostINR ?? 0) * line.quantity, 0);
		const voucher = await this.ledger.post(
			{
				date,
				narration: `Tax invoice ${number} · order ${order.orderNumber}`,
				lines: invoicePosting({
					totals: built.totals,
					advanceINR: await this.books.advanceHeldINR(order.id),
					costINR,
				}).map((row) => ({ ledger: { role: row.role }, locationId: location.id, ...row })),
				source: { type: 'taxInvoice', id, number },
				idempotencyKey: `taxInvoice:${id}`,
			},
			context,
			actorId,
		);
		const invoice = TaxInvoice.parse({
			id,
			number,
			date,
			gstRegistrationId: registration.id,
			gstin: registration.gstin,
			locationId: location.id,
			orderId: order.id,
			orderNumber: order.orderNumber,
			shipmentId,
			seller: {
				name:
					shop?.tradeName ||
					shop?.legalName ||
					registration.tradeName ||
					registration.legalName ||
					registration.gstin,
				gstin: registration.gstin,
				address: [location.address, location.city, location.pin].filter(Boolean).join(', '),
				stateCode: sellerState,
			},
			buyer: {
				name: order.buyer?.name ?? delivery?.fullName ?? 'Customer',
				gstin: order.buyer?.gstin ?? null,
				address: [delivery?.line1, delivery?.city, delivery?.postalCode].filter(Boolean).join(', '),
				stateCode: placeOfSupply,
			},
			placeOfSupply,
			interState,
			lines: built.lines,
			...built.totals,
			ratesPendingCa: true,
			billOfSupply: composition,
			voucherId: voucher.id,
			createdBy: actorId,
			createdAt: at,
		});
		await this.invoices.insert(invoice, context);
		return invoice;
	}
}
