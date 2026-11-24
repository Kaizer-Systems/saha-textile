import { randomUUID } from 'node:crypto';

import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Inject,
	Injectable,
	NotFoundException,
	Optional,
	ServiceUnavailableException,
} from '@nestjs/common';
import {
	CreditNote,
	type CreditNoteCancel,
	type CreditNoteCancelChecks,
	type CreditNoteDraftWrite,
	type CreditNoteLine,
	type CreditNoteRefundWrite,
	DebitNote,
	type DebitNoteWrite,
	GST_RETURN_LOCKS,
	InventoryCostLayer,
	LedgerEntry,
	type Order,
	type OrderLine,
	OrderReturn,
	type OrderDocumentRow,
	type OrderReturnsView,
	type PriceAdjustmentWrite,
	type ReturnCheck,
	ReturnSettings,
	type ReturnStart,
	type ReturnStep,
	type TaxInvoice,
} from '@saha-textile/contracts';
import {
	type AdminOrderRepository,
	type AuditLogRepository,
	type CreditNoteRepository,
	creditLinesFor,
	creditNoteCancelAllowed,
	creditNoteDeadline,
	creditNotePosting,
	creditNoteProblems,
	type DebitNoteRepository,
	debitNotePosting,
	deliveryShareLine,
	gatewayRefundReference,
	inputTaxReversalPosting,
	type LedgerRepository,
	type GstReturnRepository,
	type InventoryCostLayerRepository,
	type OrderPaymentRepository,
	type PaymentGatewayPort,
	istDay,
	ledgerClass,
	noteTotals,
	oppositePosting,
	type OrderReturnRepository,
	type PeriodLockRepository,
	periodStateOf,
	priceAdjustmentLines,
	type ProductVariantRepository,
	type RefundVoucherRepository,
	restockCost,
	returnWindow,
	writeOffInputTax,
	type ShipmentRepository,
	type SiteSettingsRepository,
	type StockHoldRepository,
	type StockMovementPort,
	type TaxInvoiceRepository,
	type TransactionContext,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';

import { accountsRefusal } from '../ledger/accounts-refusal';
import type { AuthenticatedPrincipal } from '../auth/session.guard';
import {
	ADMIN_ORDER_REPOSITORY,
	AUDIT_LOG_REPOSITORY,
	CREDIT_NOTE_REPOSITORY,
	DEBIT_NOTE_REPOSITORY,
	GST_RETURN_REPOSITORY,
	INVENTORY_COST_LAYER_REPOSITORY,
	INR_PAYMENT_GATEWAY,
	LEDGER_REPOSITORY,
	ORDER_PAYMENT_REPOSITORY,
	ORDER_RETURN_REPOSITORY,
	PERIOD_LOCK_REPOSITORY,
	PRODUCT_VARIANT_REPOSITORY,
	REFUND_VOUCHER_REPOSITORY,
	SHIPMENT_REPOSITORY,
	SITE_SETTINGS_REPOSITORY,
	STOCK_HOLD_REPOSITORY,
	STOCK_MOVEMENT,
	TAX_INVOICE_REPOSITORY,
	TRANSACTION_MANAGER,
} from '../infra/tokens';
import { REASON_WORDS } from '../documents/credit-note-print';
import { LedgerService } from '../ledger/ledger.service';
import { DocumentNumbersService } from '../orders-setup/document-numbers.service';

/** A goods line that put pieces back in stock (or into held) when its note was issued. */
const backInStock = (line: CreditNoteLine): boolean =>
	!line.delivery && (line.outcome === 'restock' || line.outcome === 'damaged');

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** B1 Documents card: one row; a document simply in force (issued) carries no status. */
const row = (
	kind: OrderDocumentRow['kind'],
	id: string,
	number: string | null,
	date: string | null,
	amountINR: number | null,
	status: string | null,
): OrderDocumentRow => ({
	kind,
	id,
	number,
	date,
	amountINR,
	status: status === 'issued' ? null : status,
	creditNoteId: null,
});

/** Notes still in force against an invoice: issued, not cancelled and not undone by a debit note. */
const inForce = (note: CreditNote): boolean => note.status === 'issued' && !note.debitNoteId;

/**
 * Returns, credit notes and debit notes (accounts brief B1–B11, D4; owner-approved 2026-11-23). A return moves
 * nothing until its credit note is issued; Issue does it all in one transaction: the number, stock back at its own
 * cost (held when damaged), the posting, and the return's step. A note is undone by Cancel while its month is open,
 * or by a debit note in the current month once it isn't.
 */
@Injectable()
export class ReturnsService {
	constructor(
		@Inject(ADMIN_ORDER_REPOSITORY) private readonly orders: Pick<AdminOrderRepository, 'findById'>,
		@Inject(SHIPMENT_REPOSITORY) private readonly shipments: Pick<ShipmentRepository, 'listByOrder'>,
		@Inject(TAX_INVOICE_REPOSITORY)
		private readonly invoices: Pick<TaxInvoiceRepository, 'listForOrder' | 'get' | 'findByShipment'>,
		@Inject(ORDER_RETURN_REPOSITORY) private readonly returns: OrderReturnRepository,
		@Inject(CREDIT_NOTE_REPOSITORY) private readonly notes: CreditNoteRepository,
		@Inject(DEBIT_NOTE_REPOSITORY) private readonly debits: DebitNoteRepository,
		@Inject(STOCK_MOVEMENT) private readonly stock: Pick<StockMovementPort, 'move' | 'consumeLayer'>,
		@Inject(INVENTORY_COST_LAYER_REPOSITORY)
		private readonly layers: Pick<InventoryCostLayerRepository, 'createLayer'>,
		@Inject(STOCK_HOLD_REPOSITORY) private readonly holds: Pick<StockHoldRepository, 'save' | 'findById'>,
		@Inject(PRODUCT_VARIANT_REPOSITORY) private readonly variants: Pick<ProductVariantRepository, 'listForProduct'>,
		@Inject(SITE_SETTINGS_REPOSITORY) private readonly settings: Pick<SiteSettingsRepository, 'get'>,
		@Inject(PERIOD_LOCK_REPOSITORY) private readonly periods: Pick<PeriodLockRepository, 'list'>,
		@Inject(GST_RETURN_REPOSITORY) private readonly filings: Pick<GstReturnRepository, 'list'>,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: Pick<AuditLogRepository, 'append'>,
		@Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManagerPort,
		private readonly numbers: DocumentNumbersService,
		private readonly ledger: LedgerService,
		@Inject(ORDER_PAYMENT_REPOSITORY) private readonly payments: Pick<OrderPaymentRepository, 'listByOrder'>,
		@Inject(LEDGER_REPOSITORY) private readonly accounts: Pick<LedgerRepository, 'append'>,
		@Inject(REFUND_VOUCHER_REPOSITORY) private readonly refunds: Pick<RefundVoucherRepository, 'listForOrder'>,
		@Optional()
		@Inject(INR_PAYMENT_GATEWAY)
		private readonly gateway: Pick<PaymentGatewayPort, 'refundPayment'> | null = null,
	) {}

	async returnSettings(): Promise<ReturnSettings> {
		return ReturnSettings.parse((await this.settings.get('accounts.returns')) ?? {});
	}

	private async order(id: string): Promise<Order> {
		const order = await this.orders.findById(id);
		if (!order) throw new NotFoundException('order_not_found');
		return order;
	}

	/** B1: what can still come back, the window and the deadline, and every return and note of the order. */
	async view(orderId: string, today = istDay(new Date())): Promise<OrderReturnsView> {
		const order = await this.order(orderId);
		const [allInvoices, shipments, returns, creditNotes, debitNotes, settings, payments, refunds] =
			await Promise.all([
				this.invoices.listForOrder(orderId),
				this.shipments.listByOrder(orderId),
				this.returns.listForOrder(orderId),
				this.notes.listForOrder(orderId),
				this.debits.listForOrder(orderId),
				this.returnSettings(),
				this.payments.listByOrder(orderId),
				this.refunds.listForOrder(orderId),
			]);
		const invoices = allInvoices.filter((i) => i.status === 'issued');
		const invoice = invoices[0] ?? null;
		const deliveredOn =
			shipments
				.map((s) => s.deliveredOn)
				.filter((d): d is string => !!d)
				.sort()
				.at(-1) ?? null;
		const window = returnWindow(deliveredOn, settings.windowDays, today);
		const asked = this.piecesAsked(returns);
		return {
			invoiceId: invoice?.id ?? null,
			invoiceNumber: invoice?.number ?? null,
			deliveredOn,
			windowEnds: window.ends,
			windowOpen: window.open,
			deadline: invoice ? creditNoteDeadline(invoice.date) : null,
			returnable: invoices.flatMap((inv) =>
				inv.lines.map((line) => {
					const orderLine = order.lines.find((l) => l.lineId === line.lineId);
					return {
						lineId: line.lineId,
						sku: line.sku,
						title: line.title,
						bought: line.quantity,
						returnedBefore: asked.get(line.lineId) ?? 0,
						unit: line.unit,
						returnable: orderLine?.returnable !== false,
						categoryName: null,
						unitPriceINR: line.unitPriceINR,
					};
				}),
			),
			parcels: shipments.map((s) => ({
				shipmentId: s.id,
				number: s.number,
				courier: [s.courierName, s.trackingNumber].filter(Boolean).join(' · '),
				delivered: !!s.deliveredOn,
			})),
			returns,
			creditNotes,
			debitNotes,
			documents: [
				...allInvoices.map((i) => row('taxInvoice', i.id, i.number, i.date, i.totalINR, i.status)),
				...payments
					.filter((p) => !!p.receiptNumber)
					.map((p) => row('receipt', p.id, p.receiptNumber, p.receivedOn, p.amountINR, null)),
				...shipments.map((s) => row('packingSlip', s.id, s.number, s.shippedOn, null, null)),
				...returns.map((r) =>
					row(
						'return',
						r.id,
						r.number,
						istDay(new Date(r.createdAt)),
						round2(r.lines.reduce((sum, l) => sum + l.unitPriceINR * l.quantity, 0)),
						r.status,
					),
				),
				...creditNotes.map((n) => row('creditNote', n.id, n.number, n.date, n.totalINR, n.status)),
				...debitNotes.map((d) => ({
					...row('debitNote', d.id, d.number, d.date, d.totalINR, null),
					creditNoteId: d.creditNoteId,
				})),
				...refunds.map((r) =>
					row(
						'refundVoucher',
						r.id,
						r.number,
						r.date,
						r.amountINR,
						r.status === 'refunded' ? null : r.status,
					),
				),
			],
		};
	}

	/** Pieces already asked back, per order line, across returns not cancelled. */
	private piecesAsked(returns: readonly OrderReturn[]): Map<string, number> {
		const asked = new Map<string, number>();
		for (const entry of returns.filter((r) => r.status !== 'cancelled'))
			for (const line of entry.lines) asked.set(line.lineId, (asked.get(line.lineId) ?? 0) + line.quantity);
		return asked;
	}

	/** B2: a return is asked for; nothing changes in stock or the books yet. */
	async start(orderId: string, write: ReturnStart, actorId: string | null, now = new Date()): Promise<OrderReturn> {
		const view = await this.view(orderId, istDay(now));
		if (!view.windowOpen) throw new BadRequestException(accountsRefusal('return_window_closed'));
		const picked = write.lines.filter((l) => l.quantity > 0);
		if (!picked.length) throw new BadRequestException(accountsRefusal('return_nothing_picked'));
		const invoices = (await this.invoices.listForOrder(orderId)).filter((i) => i.status === 'issued');
		const invoiceOf = (lineId: string) => invoices.find((inv) => inv.lines.some((l) => l.lineId === lineId));
		const invoice = invoiceOf(picked[0]!.lineId);
		const lines = [];
		for (const pick of picked) {
			const row = view.returnable.find((r) => r.lineId === pick.lineId);
			if (!row || invoiceOf(pick.lineId) !== invoice)
				throw new BadRequestException(accountsRefusal('return_line_unknown'));
			if (!row.returnable) throw new BadRequestException(accountsRefusal(`return_not_returnable:${row.sku}`));
			if (pick.quantity > row.bought - row.returnedBefore)
				throw new BadRequestException(accountsRefusal(`return_too_many:${row.sku}`));
			lines.push({
				lineId: row.lineId,
				sku: row.sku,
				title: row.title,
				quantity: pick.quantity,
				unit: row.unit,
				unitPriceINR: row.unitPriceINR,
			});
		}
		const order = await this.order(orderId);
		const at = now.toISOString();
		const entry = OrderReturn.parse({
			id: `ret_${randomUUID()}`,
			number: await this.numbers.childNumber('return', order.orderNumber, view.returns.length + 1),
			orderId,
			orderNumber: order.orderNumber,
			invoiceId: invoice!.id,
			invoiceNumber: invoice!.number,
			status: 'asked',
			timeline: [{ status: 'asked', at, by: actorId }],
			lines,
			reason: write.reason,
			how: write.how,
			refundTo: write.refundTo,
			note: write.note,
			createdAt: at,
			createdBy: actorId,
			updatedAt: at,
		});
		await this.returns.insert(entry);
		await this.log(actorId, 'returns.start', 'orderReturn', entry.id, { number: entry.number, orderId });
		return entry;
	}

	async getReturn(id: string): Promise<OrderReturn> {
		const entry = await this.returns.get(id);
		if (!entry) throw new NotFoundException('return_not_found');
		return entry;
	}

	/** Pickup booked, then Received; a parcel the customer sends goes straight to Received. */
	async step(id: string, write: ReturnStep, actorId: string | null, now = new Date()): Promise<OrderReturn> {
		const entry = await this.getReturn(id);
		const allowed = write.to === 'pickup_booked' ? ['asked'] : ['asked', 'pickup_booked'];
		if (!allowed.includes(entry.status)) throw new ConflictException(accountsRefusal('return_step_refused'));
		return this.saveReturn(entry, { status: write.to }, actorId, now);
	}

	/** B3: each piece back to stock, damaged and kept, or written off. */
	async check(id: string, write: ReturnCheck, actorId: string | null, now = new Date()): Promise<OrderReturn> {
		const entry = await this.getReturn(id);
		if (entry.status !== 'received' && entry.status !== 'checked')
			throw new ConflictException(accountsRefusal('return_not_received'));
		const lines = entry.lines.map((line) => {
			const checked = write.lines.find((l) => l.lineId === line.lineId);
			return checked ? { ...line, outcome: checked.outcome, note: checked.note } : line;
		});
		if (lines.some((l) => !l.outcome)) throw new BadRequestException(accountsRefusal('return_check_incomplete'));
		return this.saveReturn(entry, { status: 'checked', lines }, actorId, now);
	}

	private async saveReturn(
		entry: OrderReturn,
		change: Partial<OrderReturn>,
		actorId: string | null,
		now: Date,
		context?: TransactionContext,
	): Promise<OrderReturn> {
		const at = now.toISOString();
		const status = change.status ?? entry.status;
		const next = OrderReturn.parse({
			...entry,
			...change,
			timeline: status === entry.status ? entry.timeline : [...entry.timeline, { status, at, by: actorId }],
			updatedAt: at,
		});
		await this.returns.save(next, entry.updatedAt, context);
		if (status !== entry.status)
			await this.log(
				actorId,
				'returns.step',
				'orderReturn',
				entry.id,
				{ from: entry.status, to: status },
				context,
			);
		return next;
	}

	/** Pieces and money already given back on an invoice by notes in force. */
	private async credited(invoiceId: string, skip: string | null, context?: TransactionContext) {
		const notes = (await this.notes.listForInvoice(invoiceId, context)).filter((n) => inForce(n) && n.id !== skip);
		const pieces = new Map<string, number>();
		for (const note of notes.filter((n) => n.kind !== 'price_adjustment'))
			for (const line of note.lines.filter((l) => !l.delivery))
				pieces.set(line.lineId, (pieces.get(line.lineId) ?? 0) + line.quantity);
		return { pieces, money: notes.reduce((sum, n) => sum + Math.round(n.totalINR * 100), 0) / 100 };
	}

	private async invoice(id: string): Promise<TaxInvoice> {
		const invoice = await this.invoices.get(id);
		if (!invoice) throw new NotFoundException('invoice_not_found');
		return invoice;
	}

	/** A draft from its invoice (B4): goods or price lines, the ₹0 delivery share, totals and the s.34 deadline. */
	private draft(
		invoice: TaxInvoice,
		input: Pick<CreditNote, 'kind' | 'reason' | 'refundTo' | 'returnId' | 'shipmentId'>,
		lines: CreditNoteLine[],
		actorId: string | null,
		now: Date,
	): CreditNote {
		const all = input.kind === 'price_adjustment' ? lines : [...lines, deliveryShareLine(invoice)];
		return CreditNote.parse({
			id: `cn_${randomUUID()}`,
			status: 'draft',
			...input,
			date: istDay(now),
			invoiceId: invoice.id,
			invoiceNumber: invoice.number,
			invoiceDate: invoice.date,
			gstRegistrationId: invoice.gstRegistrationId,
			gstin: invoice.gstin,
			locationId: invoice.locationId,
			orderId: invoice.orderId,
			orderNumber: invoice.orderNumber,
			buyer: invoice.buyer,
			placeOfSupply: invoice.placeOfSupply,
			interState: invoice.interState,
			lines: all,
			...noteTotals(all),
			deadline: creditNoteDeadline(invoice.date),
			ratesPendingCa: invoice.ratesPendingCa,
			createdAt: now.toISOString(),
			createdBy: actorId,
		});
	}

	private refuseIfProblems(
		note: CreditNote,
		invoice: TaxInvoice,
		credited: { pieces: Map<string, number>; money: number },
		today: string,
	) {
		const [problem] = creditNoteProblems({
			lines: note.lines,
			invoice,
			creditedINR: credited.money,
			creditedPieces: credited.pieces,
			kind: note.kind,
			deadline: note.deadline,
			today,
		});
		if (problem) throw new BadRequestException(accountsRefusal(`credit_note_problem:${problem}`));
	}

	/** Make the credit note (B3 → B4): a draft from the checked return, at the pieces' own cost. */
	async fromReturn(returnId: string, actorId: string | null, now = new Date()): Promise<CreditNote> {
		const entry = await this.getReturn(returnId);
		if (entry.status !== 'checked') throw new ConflictException(accountsRefusal('return_not_checked'));
		if (entry.creditNoteId) return this.creditNote(entry.creditNoteId);
		const [invoice, order] = await Promise.all([this.invoice(entry.invoiceId), this.order(entry.orderId)]);
		const credited = await this.credited(invoice.id, null);
		const cost = (lineId: string) => order.lines.find((l) => l.lineId === lineId)?.unitCostINR ?? null;
		const lines = creditLinesFor(
			invoice.lines,
			entry.lines.map((l) => ({
				lineId: l.lineId,
				quantity: l.quantity,
				outcome: l.outcome,
				unitCostINR: cost(l.lineId),
				note: l.note,
			})),
			credited.pieces,
		);
		const note = this.draft(
			invoice,
			{
				kind: 'goods_returned',
				reason: REASON_WORDS[entry.reason],
				refundTo: entry.refundTo,
				returnId: entry.id,
				shipmentId: null,
			},
			lines,
			actorId,
			now,
		);
		this.refuseIfProblems(note, invoice, credited, istDay(now));
		await this.notes.insert(note);
		await this.saveReturn(entry, { creditNoteId: note.id }, actorId, now);
		await this.log(actorId, 'creditNote.draft', 'creditNote', note.id, { from: entry.number });
		return note;
	}

	/** B10: a price agreed lower after the sale; no goods move. */
	async priceAdjustment(
		orderId: string,
		write: PriceAdjustmentWrite,
		actorId: string | null,
		now = new Date(),
	): Promise<CreditNote> {
		const invoices = (await this.invoices.listForOrder(orderId)).filter((i) => i.status === 'issued');
		const invoice = invoices.find((inv) =>
			inv.lines.some((l) => write.lines.some((w) => w.lineId === l.lineId && w.lowerByINR > 0)),
		);
		if (!invoice) throw new BadRequestException(accountsRefusal('credit_note_problem:nothing_to_credit'));
		const lines = priceAdjustmentLines(invoice.lines, write.lines, invoice.interState);
		const note = this.draft(
			invoice,
			{
				kind: 'price_adjustment',
				reason: write.reason,
				refundTo: write.refundTo,
				returnId: null,
				shipmentId: null,
			},
			lines,
			actorId,
			now,
		);
		this.refuseIfProblems(note, invoice, await this.credited(invoice.id, null), istDay(now));
		await this.notes.insert(note);
		await this.log(actorId, 'creditNote.draft', 'creditNote', note.id, { kind: 'price_adjustment' });
		return note;
	}

	/** B11: a parcel the courier brought back: its invoice's pieces, back to stock. */
	async undelivered(
		orderId: string,
		shipmentId: string,
		actorId: string | null,
		now = new Date(),
	): Promise<CreditNote> {
		const invoice = await this.invoices.findByShipment(shipmentId);
		if (!invoice || invoice.orderId !== orderId || invoice.status !== 'issued')
			throw new NotFoundException('invoice_not_found');
		const existing = (await this.notes.listForInvoice(invoice.id)).find(
			(n) => n.shipmentId === shipmentId && n.status !== 'cancelled',
		);
		if (existing) return existing;
		const [order, credited] = await Promise.all([this.order(orderId), this.credited(invoice.id, null)]);
		const lines = creditLinesFor(
			invoice.lines,
			invoice.lines.map((l) => ({
				lineId: l.lineId,
				quantity: l.quantity - (credited.pieces.get(l.lineId) ?? 0),
				outcome: 'restock' as const,
				unitCostINR: order.lines.find((o) => o.lineId === l.lineId)?.unitCostINR ?? null,
			})),
			credited.pieces,
		);
		const note = this.draft(
			invoice,
			{
				kind: 'undelivered',
				reason: 'Parcel came back undelivered',
				refundTo: 'original_payment',
				returnId: null,
				shipmentId,
			},
			lines,
			actorId,
			now,
		);
		this.refuseIfProblems(note, invoice, credited, istDay(now));
		await this.notes.insert(note);
		await this.log(actorId, 'creditNote.draft', 'creditNote', note.id, { kind: 'undelivered', shipmentId });
		return note;
	}

	async creditNote(id: string): Promise<CreditNote> {
		const note = await this.notes.get(id);
		if (!note) throw new NotFoundException('credit_note_not_found');
		return note;
	}

	async debitNoteById(id: string): Promise<DebitNote> {
		const note = await this.debits.get(id);
		if (!note) throw new NotFoundException('debit_note_not_found');
		return note;
	}

	listCreditNotes(query: Parameters<CreditNoteRepository['list']>[0]) {
		return this.notes.list(query);
	}

	/** B4 Save draft: fewer pieces on a goods line (0 takes it off), or a new reason. */
	async saveDraft(id: string, write: CreditNoteDraftWrite, actorId: string | null): Promise<CreditNote> {
		const note = await this.creditNote(id);
		if (note.status !== 'draft') throw new ConflictException(accountsRefusal('credit_note_not_draft'));
		const invoice = await this.invoice(note.invoiceId);
		const credited = await this.credited(invoice.id, note.id);
		let lines = note.lines;
		if (note.kind !== 'price_adjustment' && write.lines.length) {
			const goods = note.lines
				.filter((l) => !l.delivery)
				.map((l) => ({
					...l,
					quantity: Math.min(
						l.quantity,
						write.lines.find((w) => w.lineId === l.lineId)?.quantity ?? l.quantity,
					),
				}));
			lines = [
				...creditLinesFor(
					invoice.lines,
					goods.map((l) => ({
						lineId: l.lineId,
						quantity: l.quantity,
						outcome: l.outcome,
						unitCostINR: l.unitCostINR,
						note: l.note,
					})),
					credited.pieces,
				),
				deliveryShareLine(invoice),
			];
		}
		const next = CreditNote.parse({ ...note, lines, ...noteTotals(lines), reason: write.reason ?? note.reason });
		this.refuseIfProblems(next, invoice, credited, next.date);
		const saved = await this.notes.save(next, write.version).catch((error: Error) => {
			throw new ConflictException(accountsRefusal(error.message));
		});
		const diffs = [
			...note.lines
				.filter((l) => !l.delivery)
				.flatMap((l) => {
					const after = lines.find((x) => x.lineId === l.lineId && !x.delivery)?.quantity ?? 0;
					return after === l.quantity ? [] : [{ field: `quantity:${l.title}`, before: l.quantity, after }];
				}),
			...(next.reason === note.reason ? [] : [{ field: 'reason', before: note.reason, after: next.reason }]),
		];
		await this.log(actorId, 'creditNote.save', 'creditNote', id, { lines: lines.length }, undefined, diffs);
		return saved;
	}

	async deleteDraft(id: string, actorId: string | null): Promise<void> {
		const note = await this.creditNote(id);
		await this.notes.deleteDraft(id).catch((error: Error) => {
			throw new ConflictException(accountsRefusal(error.message));
		});
		if (note.returnId) {
			const entry = await this.getReturn(note.returnId);
			await this.saveReturn(entry, { creditNoteId: null }, actorId, new Date());
		}
		await this.log(actorId, 'creditNote.delete', 'creditNote', id, {});
	}

	/** The variant a line holds stock on (its option, or the product's base variant). */
	private async variantIdOf(line: OrderLine): Promise<string> {
		if (line.variationId) return line.variationId;
		const rows = await this.variants.listForProduct(line.productId, 'admin');
		const base = rows.find((row) => row.isBaseVariant) ?? rows[0];
		if (!base) throw new ConflictException(accountsRefusal(`variant_missing:${line.sku}`));
		return base.id;
	}

	/** Puts a returned line's pieces back at the invoice's location: a cost layer at their own cost, held when damaged. */
	private async putBack(
		note: CreditNote,
		number: string,
		line: CreditNoteLine,
		order: Order,
		actorId: string | null,
		at: string,
		context: TransactionContext,
	): Promise<CreditNoteLine> {
		const orderLine = order.lines.find((l) => l.lineId === line.lineId);
		if (!orderLine) throw new ConflictException(accountsRefusal(`order_line_missing:${line.sku}`));
		const variantId = await this.variantIdOf(orderLine);
		const damaged = line.outcome === 'damaged';
		await this.stock.move(
			{
				variantId,
				productId: orderLine.productId,
				quantityDelta: line.quantity,
				heldDelta: damaged ? line.quantity : 0,
				source: 'return_restocked',
				reasonCode: line.outcome,
				note: `Credit note ${number}`,
				referenceType: 'creditNote',
				referenceId: note.id,
				referenceNumber: number,
				actorUserId: actorId,
				approverUserId: null,
				at,
				locationId: note.locationId,
			},
			context,
		);
		const layer = await this.layers.createLayer(
			InventoryCostLayer.parse({
				id: `lay_${randomUUID()}`,
				variantId,
				sourceType: 'return_restock',
				sourceNumber: number,
				unitCostINR: line.unitCostINR ?? 0,
				quantityReceived: line.quantity,
				quantityRemaining: line.quantity,
				receivedAt: at,
				createdAt: at,
				locationId: note.locationId,
			}),
			context,
		);
		let holdId: string | null = null;
		if (damaged) {
			holdId = `hold_${randomUUID()}`;
			await this.holds.save(
				{
					id: holdId,
					variantId,
					productId: orderLine.productId,
					quantity: line.quantity,
					reason: 'damaged',
					note: `Returned damaged · ${number}`,
					since: at,
					byId: actorId,
					status: 'open',
					closedAt: null,
					closedBy: null,
					entryId: null,
				},
				context,
			);
		}
		return { ...line, layerId: layer.id, holdId };
	}

	/** Takes back out what a note put back (Cancel, or a debit note): the pieces, their layer and any hold. */
	private async takeOut(
		note: CreditNote,
		number: string,
		why: string,
		order: Order,
		actorId: string | null,
		at: string,
		context: TransactionContext,
	): Promise<void> {
		for (const line of note.lines.filter(backInStock)) {
			const orderLine = order.lines.find((l) => l.lineId === line.lineId);
			if (!orderLine) throw new ConflictException(accountsRefusal(`order_line_missing:${line.sku}`));
			const damaged = line.outcome === 'damaged';
			await this.stock.move(
				{
					variantId: await this.variantIdOf(orderLine),
					productId: orderLine.productId,
					quantityDelta: -line.quantity,
					heldDelta: damaged ? -line.quantity : 0,
					source: 'return_restocked',
					reasonCode: 'undone',
					note: why,
					referenceType: 'creditNote',
					referenceId: note.id,
					referenceNumber: number,
					actorUserId: actorId,
					approverUserId: null,
					at,
					locationId: note.locationId,
				},
				context,
			);
			if (line.layerId) await this.stock.consumeLayer(line.layerId, line.quantity, context);
			const hold = line.holdId ? await this.holds.findById(line.holdId, context) : null;
			if (hold) await this.holds.save({ ...hold, status: 'released', closedAt: at, closedBy: actorId }, context);
		}
	}

	private posting(rows: { role: string; debitPaise?: number; creditPaise?: number }[], locationId: string) {
		return rows.map((row) => ({ ledger: { role: row.role }, locationId, ...row }));
	}

	/** B4 Issue: the number, stock, the posting and the return's step in one transaction. */
	async issue(id: string, version: number, actorId: string | null, now = new Date()): Promise<CreditNote> {
		const at = now.toISOString();
		const date = istDay(now);
		const issued = await this.tx.withTransaction(async (context) => {
			const note = await this.notes.get(id, context);
			if (!note) throw new NotFoundException('credit_note_not_found');
			if (note.status !== 'draft') throw new ConflictException(accountsRefusal('credit_note_not_draft'));
			if (note.version !== version) throw new ConflictException(accountsRefusal('credit_note_changed'));
			const invoice = await this.invoice(note.invoiceId);
			this.refuseIfProblems(note, invoice, await this.credited(invoice.id, note.id, context), date);
			const number = await this.numbers.issue('creditNote', context, now, note.gstRegistrationId);
			const order = await this.order(note.orderId);
			const lines: CreditNoteLine[] = [];
			for (const line of note.lines)
				lines.push(
					backInStock(line) ? await this.putBack(note, number, line, order, actorId, at, context) : line,
				);
			const totals = noteTotals(lines);
			const voucher = await this.ledger.post(
				{
					date,
					narration: `Credit note ${number} · invoice ${note.invoiceNumber}`,
					lines: this.posting(
						creditNotePosting({ totals, restockCostINR: restockCost(lines) }),
						note.locationId,
					),
					source: { type: 'creditNote', id: note.id, number },
					idempotencyKey: `creditNote:${note.id}`,
				},
				context,
				actorId,
			);
			const refundStatus = note.refundTo === 'customer_account' ? 'kept' : 'due';
			const source = { type: 'creditNoteInputTax', id: note.id, number };
			await this.inputTax(lines, note.locationId, date, source, false, actorId, context);
			await this.account(order, { id: note.id, number }, 'creditNote', -totals.totalINR, actorId, at, context);
			const next = await this.notes.save(
				CreditNote.parse({
					...note,
					number,
					date,
					status: 'issued',
					lines,
					voucherId: voucher.id,
					refund: { status: refundStatus },
					issuedAt: at,
					issuedBy: actorId,
				}),
				note.version,
				context,
			);
			if (note.returnId) {
				const entry = await this.returns.get(note.returnId, context);
				if (entry) await this.saveReturn(entry, { status: 'credit_note' }, actorId, now, context);
			}
			await this.log(
				actorId,
				'creditNote.issue',
				'creditNote',
				id,
				{ number, totalINR: next.totalINR },
				context,
				[{ field: 'number', after: number }],
			);
			await this.log(
				null,
				'creditNote.posted',
				'creditNote',
				id,
				{
					stock: lines.filter(backInStock).map((l) => ({ sku: l.sku, quantity: l.quantity })),
					outputTaxINR: round2(totals.cgstINR + totals.sgstINR + totals.igstINR),
					inputTaxINR: writeOffInputTax(lines),
					refund: refundStatus,
					totalINR: totals.totalINR,
				},
				context,
			);
			return next;
		});
		return issued;
	}

	/** B8's checks for this person. */
	async cancelChecks(id: string, principal: AuthenticatedPrincipal | undefined): Promise<CreditNoteCancelChecks> {
		const note = await this.creditNote(id);
		const month = note.date.slice(0, 7);
		const [locks, filings, superAdmin] = await Promise.all([
			this.periods.list(),
			this.filings.list(),
			this.ledger.isSuperAdmin(principal),
		]);
		const checks = {
			monthFiled: filings.some(
				(f) =>
					f.gstRegistrationId === note.gstRegistrationId &&
					f.month === month &&
					GST_RETURN_LOCKS[f.returnType].includes('sales'),
			),
			booksClosed: periodStateOf(locks, month, 'sales') !== 'open',
			refundPaid: note.refund?.status === 'paid',
			superAdmin,
		};
		return { ...checks, allowed: creditNoteCancelAllowed(checks), month };
	}

	/** B8: a super admin cancels an issued note while its month is open; everything it did is undone. */
	async cancel(id: string, write: CreditNoteCancel, principal: AuthenticatedPrincipal | undefined, now = new Date()) {
		const checks = await this.cancelChecks(id, principal);
		const failed = (['superAdmin', 'monthFiled', 'booksClosed', 'refundPaid'] as const).filter((key) =>
			key === 'superAdmin' ? !checks.superAdmin : checks[key],
		);
		if (failed.length)
			await this.log(principal?.userId ?? null, 'creditNote.cancel_refused', 'creditNote', id, {
				why: failed,
			});
		if (!checks.superAdmin || !principal)
			throw new ForbiddenException(accountsRefusal('credit_note_cancel_super_admin'));
		if (!checks.allowed) throw new ConflictException(accountsRefusal('credit_note_cancel_refused'));
		const actorId = principal.userId;
		const at = now.toISOString();
		return this.tx.withTransaction(async (context) => {
			const note = await this.notes.get(id, context);
			if (!note || note.status !== 'issued' || note.debitNoteId)
				throw new ConflictException(accountsRefusal('credit_note_not_cancellable'));
			const order = await this.order(note.orderId);
			await this.takeOut(
				note,
				`${note.number} cancelled`,
				`Credit note ${note.number} cancelled: ${write.reason}`,
				order,
				actorId,
				at,
				context,
			);
			await this.ledger.post(
				{
					date: note.date,
					narration: `Credit note ${note.number} cancelled: ${write.reason}`,
					lines: this.posting(
						debitNotePosting({ totals: note, restockCostINR: restockCost(note.lines) }),
						note.locationId,
					),
					source: { type: 'creditNoteCancel', id: note.id, number: note.number },
					idempotencyKey: `creditNoteCancel:${note.id}`,
				},
				context,
				actorId,
			);
			const source = { type: 'creditNoteInputTaxCancel', id: note.id, number: note.number };
			await this.inputTax(note.lines, note.locationId, note.date, source, true, actorId, context);
			await this.account(order, note, 'reversal', note.totalINR, actorId, at, context);
			const next = await this.notes.save(
				CreditNote.parse({
					...note,
					status: 'cancelled',
					cancellation: { at, by: actorId, reason: write.reason },
				}),
				note.version,
				context,
			);
			if (note.returnId) {
				const entry = await this.returns.get(note.returnId, context);
				if (entry)
					await this.saveReturn(entry, { status: 'checked', creditNoteId: null }, actorId, now, context);
			}
			await this.log(actorId, 'creditNote.cancel', 'creditNote', id, { reason: write.reason }, context);
			return next;
		});
	}

	/** B5, B9: a debit note undoes an issued note in the current month: the opposite posting, pieces out again. */
	async debitNote(id: string, write: DebitNoteWrite, actorId: string | null, now = new Date()): Promise<DebitNote> {
		const at = now.toISOString();
		const date = istDay(now);
		return this.tx.withTransaction(async (context) => {
			const note = await this.notes.get(id, context);
			if (!note || note.status !== 'issued' || note.debitNoteId || !note.number)
				throw new ConflictException(accountsRefusal('credit_note_not_undoable'));
			const number = await this.numbers.issue('debitNote', context, now, note.gstRegistrationId);
			const order = await this.order(note.orderId);
			await this.takeOut(note, number, `${number} undoes ${note.number}`, order, actorId, at, context);
			const debitId = `dn_${randomUUID()}`;
			const voucher = await this.ledger.post(
				{
					date,
					narration: `Debit note ${number} · undoes ${note.number}`,
					lines: this.posting(
						debitNotePosting({ totals: note, restockCostINR: restockCost(note.lines) }),
						note.locationId,
					),
					source: { type: 'debitNote', id: debitId, number },
					idempotencyKey: `debitNote:${debitId}`,
				},
				context,
				actorId,
			);
			const debit = DebitNote.parse({
				id: debitId,
				number,
				date,
				gstRegistrationId: note.gstRegistrationId,
				gstin: note.gstin,
				locationId: note.locationId,
				orderId: note.orderId,
				orderNumber: note.orderNumber,
				invoiceId: note.invoiceId,
				invoiceNumber: note.invoiceNumber,
				creditNoteId: note.id,
				creditNoteNumber: note.number,
				buyer: note.buyer,
				placeOfSupply: note.placeOfSupply,
				interState: note.interState,
				reason: write.reason,
				lines: note.lines,
				taxableINR: note.taxableINR,
				cgstINR: note.cgstINR,
				sgstINR: note.sgstINR,
				igstINR: note.igstINR,
				roundOffINR: note.roundOffINR,
				totalINR: note.totalINR,
				voucherId: voucher.id,
				createdAt: at,
				createdBy: actorId,
			});
			const source = { type: 'debitNoteInputTax', id: debitId, number };
			await this.inputTax(note.lines, note.locationId, date, source, true, actorId, context);
			await this.account(order, note, 'debitNote', note.totalINR, actorId, at, context);
			await this.debits.insert(debit, context);
			await this.notes.save(CreditNote.parse({ ...note, debitNoteId: debit.id }), note.version, context);
			await this.log(
				actorId,
				'debitNote.issue',
				'creditNote',
				note.id,
				{ number, debitNoteId: debit.id, reason: write.reason },
				context,
			);
			return debit;
		});
	}

	/**
	 * B5 Refund now: back through the order's gateway payment (our own reference, so a retry never refunds twice), or
	 * recorded as paid by hand from a cash or bank ledger. Posts the customer's credit against where the money went.
	 */
	async refund(
		id: string,
		write: CreditNoteRefundWrite,
		actorId: string | null,
		now = new Date(),
	): Promise<CreditNote> {
		const note = await this.creditNote(id);
		if (note.status !== 'issued' || note.debitNoteId || note.refund?.status !== 'due')
			throw new ConflictException(accountsRefusal('credit_note_refund_not_due'));
		let ledger: { role: string } | { id: string };
		let reference: string;
		if (write.how === 'gateway') {
			const paid = (await this.payments.listByOrder(note.orderId)).find(
				(p) => p.method === 'gateway' && p.gateway?.reference && p.state !== 'failed' && p.state !== 'void',
			);
			if (!paid?.gateway?.reference)
				throw new BadRequestException(accountsRefusal('credit_note_refund_no_gateway_payment'));
			if (!this.gateway) throw new ServiceUnavailableException('credit_note_refund_gateway_unavailable');
			reference = gatewayRefundReference('CN', note.id);
			const result = await this.gateway.refundPayment({
				gatewayReference: paid.gateway.reference,
				refundReference: reference,
				amountMinor: Math.round(note.totalINR * 100),
				currency: 'INR',
			});
			if (result.outcome === 'refused')
				throw new ConflictException(
					accountsRefusal(`credit_note_refund_refused:${result.refusalCode ?? 'gateway'}`),
				);
			ledger = { role: 'gateway_clearing' };
		} else {
			const chart = await this.ledger.chart();
			const from = chart.ledgers.find((l) => l.id === write.ledgerId);
			const cashOrBank = from ? ledgerClass(from, chart.groups) !== 'other' : false;
			if (!cashOrBank) throw new BadRequestException(accountsRefusal('credit_note_refund_needs_cash_or_bank'));
			reference = write.reference;
			ledger = { id: write.ledgerId };
		}
		const at = now.toISOString();
		return this.tx.withTransaction(async (context) => {
			const voucher = await this.ledger.post(
				{
					date: istDay(now),
					narration: `Refund for credit note ${note.number} · ${reference}`,
					lines: [
						{
							ledger: { role: 'debtors_control' },
							locationId: note.locationId,
							debitPaise: Math.round(note.totalINR * 100),
						},
						{ ledger, locationId: note.locationId, creditPaise: Math.round(note.totalINR * 100) },
					],
					source: { type: 'creditNoteRefund', id: note.id, number: note.number },
					idempotencyKey: `creditNoteRefund:${note.id}`,
				},
				context,
				actorId,
			);
			const order = await this.order(note.orderId);
			await this.account(order, note, 'refund', note.totalINR, actorId, at, context);
			const next = await this.notes.save(
				CreditNote.parse({
					...note,
					refund: {
						status: 'paid',
						paidAt: at,
						paidBy: actorId,
						method: write.how === 'gateway' ? 'gateway' : write.method,
						reference,
						voucherId: voucher.id,
					},
				}),
				note.version,
				context,
			);
			if (note.returnId) {
				const entry = await this.returns.get(note.returnId, context);
				if (entry) await this.saveReturn(entry, { status: 'refunded' }, actorId, now, context);
			}
			await this.log(actorId, 'creditNote.refund', 'creditNote', id, { how: write.how, reference }, context);
			return next;
		});
	}

	/**
	 * A business buyer's own account (receivable side; positive is owed to us): the credit note takes the total off,
	 * a refund, a debit note or a cancel puts it back. Shoppers without a business account have none.
	 */
	private async account(
		order: Order,
		note: Pick<CreditNote, 'id' | 'number'>,
		kind: 'creditNote' | 'refund' | 'debitNote' | 'reversal',
		amountINR: number,
		actorId: string | null,
		at: string,
		context: TransactionContext,
	): Promise<void> {
		const businessId = order.buyer?.businessId;
		if (!businessId) return;
		await this.accounts.append(
			LedgerEntry.parse({
				id: `led_${randomUUID()}`,
				businessId,
				side: 'receivable',
				kind,
				amountINR,
				documentType: 'creditNote',
				documentId: note.id,
				documentNumber: note.number,
				at,
				by: actorId ?? 'system',
			}),
			context,
		);
	}

	/**
	 * D9 (s.17(5)(h)): written-off pieces take back their input tax in a voucher of its own; Cancel and debit notes
	 * post its opposite. Nothing is posted when no piece was written off.
	 */
	private async inputTax(
		lines: readonly CreditNoteLine[],
		locationId: string,
		date: string,
		source: { type: string; id: string; number: string | null },
		undo: boolean,
		actorId: string | null,
		context: TransactionContext,
	): Promise<void> {
		const rows = inputTaxReversalPosting(writeOffInputTax(lines));
		if (!rows.length) return;
		await this.ledger.post(
			{
				date,
				narration: `${undo ? 'Input tax restored' : 'Input tax reversed, s.17(5)(h)'}: written-off pieces · ${source.number}`,
				lines: this.posting(undo ? oppositePosting(rows) : rows, locationId),
				source,
				idempotencyKey: `${source.type}:${source.id}`,
			},
			context,
			actorId,
		);
	}

	/** B3 "Print return note": the return and its invoice's buyer. */
	async returnNote(id: string): Promise<{ entry: OrderReturn; invoice: TaxInvoice }> {
		const entry = await this.getReturn(id);
		return { entry, invoice: await this.invoice(entry.invoiceId) };
	}

	/** Q11: every print is in the document's log. */
	async printed(entityType: 'creditNote' | 'orderReturn', id: string, actorId: string | null): Promise<void> {
		await this.log(actorId, `${entityType}.print`, entityType, id, { format: 'pdf' });
	}

	private async log(
		actor: string | null,
		action: string,
		entityType: string,
		entityId: string,
		metadata: Record<string, unknown>,
		context?: TransactionContext,
		diffs: { field: string; before?: unknown; after?: unknown }[] = [],
	): Promise<void> {
		await this.audit.append(
			{
				id: `aud_${randomUUID()}`,
				actorUserId: actor,
				targetUserId: null,
				audience: 'admin',
				action,
				entityType,
				entityId,
				severity: 'info',
				// The books' edit log is kept 8 years (owner, 2026-11-23).
				retentionTier: 'books',
				diffs,
				metadata,
				requestId: null,
				ipHash: null,
				userAgentHash: null,
				createdAt: new Date().toISOString(),
			},
			context,
		);
	}
}
