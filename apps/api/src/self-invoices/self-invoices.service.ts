import { randomUUID } from 'node:crypto';

import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
	PaymentVoucher,
	SelfInvoice,
	type PaymentVoucherCancel,
	type PaymentVoucherListQuery,
	type SelfInvoiceCancel,
	type SelfInvoiceForm,
	type SelfInvoiceListQuery,
	type SelfInvoicePayWrite,
	type SelfInvoiceWrite,
	type SupplierPaymentWrite,
} from '@saha-textile/contracts';
import {
	addDays,
	type CompanyRepository,
	type ExpenseBillRepository,
	type GstReturnRepository,
	istDay,
	ledgerClass,
	type LocationRepository,
	oppositePosting,
	type PaymentVoucherRepository,
	paymentVoucherCancelProblems,
	type PeriodLockRepository,
	periodStateOf,
	selfInvoiceCancelProblems,
	selfInvoiceDeadline,
	selfInvoicePosting,
	selfInvoiceProblems,
	type SelfInvoiceRepository,
	selfInvoiceTax,
	type SupplierRepository,
	supplierPaymentPosting,
	type TransactionContext,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';

import { accountsRefusal } from '../ledger/accounts-refusal';
import { AccountsTemplatesService } from '../accounts-templates/accounts-templates.service';
import type { AuthenticatedPrincipal } from '../auth/session.guard';
import {
	COMPANY_REPOSITORY,
	EXPENSE_BILL_REPOSITORY,
	GST_RETURN_REPOSITORY,
	LOCATION_REPOSITORY,
	PAYMENT_VOUCHER_REPOSITORY,
	PERIOD_LOCK_REPOSITORY,
	SELF_INVOICE_REPOSITORY,
	SUPPLIER_REPOSITORY,
	TRANSACTION_MANAGER,
} from '../infra/tokens';
import { EditLogService } from '../ledger/edit-log';
import { LedgerService } from '../ledger/ledger.service';
import { LocationsService } from '../locations/locations.service';
import { DocumentNumbersService } from '../orders-setup/document-numbers.service';
import { PurchaseEntriesService } from '../purchasing/purchase-entries.service';

const actorOf = (principal: AuthenticatedPrincipal | undefined): string | null => principal?.userId ?? null;
const addressOf = (supplier: { address: { line: string; city: string; pin: string } }) =>
	[supplier.address.line, [supplier.address.city, supplier.address.pin].filter(Boolean).join(' ')]
		.filter(Boolean)
		.join(', ');

/**
 * Reverse charge (accounts brief D, Rules 47A and 52; on roles and the RS-RCM rule set, accounts templates AT-D8).
 * A self-invoice is a draft until issued: issuing numbers it (SI/) and posts the expense and input tax against the
 * supplier and the reverse-charge tax payable. Paying the supplier issues a payment voucher (PV/) and posts it. Every
 * payment to a supplier gets a voucher (decision D5): a purchase entry's payment is recorded by the purchases page's
 * own step, unchanged, and then given its voucher.
 */
@Injectable()
export class SelfInvoicesService {
	constructor(
		@Inject(SELF_INVOICE_REPOSITORY) private readonly invoices: SelfInvoiceRepository,
		@Inject(PAYMENT_VOUCHER_REPOSITORY) private readonly vouchers: PaymentVoucherRepository,
		@Inject(SUPPLIER_REPOSITORY) private readonly suppliers: Pick<SupplierRepository, 'findById' | 'list'>,
		@Inject(COMPANY_REPOSITORY) private readonly company: Pick<CompanyRepository, 'getRegistration'>,
		@Inject(LOCATION_REPOSITORY) private readonly locationRepo: Pick<LocationRepository, 'list'>,
		@Inject(GST_RETURN_REPOSITORY) private readonly filings: Pick<GstReturnRepository, 'list'>,
		@Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManagerPort,
		private readonly numbers: DocumentNumbersService,
		private readonly ledger: LedgerService,
		private readonly locations: LocationsService,
		private readonly templates: AccountsTemplatesService,
		private readonly log: EditLogService,
		private readonly purchases: PurchaseEntriesService,
		@Inject(PERIOD_LOCK_REPOSITORY) private readonly periods: Pick<PeriodLockRepository, 'list'>,
		@Inject(EXPENSE_BILL_REPOSITORY) private readonly expenseBills: Pick<ExpenseBillRepository, 'get' | 'save'>,
	) {}

	async get(id: string): Promise<SelfInvoice> {
		const invoice = await this.invoices.get(id);
		if (!invoice) throw new NotFoundException('self_invoice_not_found');
		return invoice;
	}

	async paymentVoucher(id: string): Promise<PaymentVoucher> {
		const voucher = await this.vouchers.get(id);
		if (!voucher) throw new NotFoundException('payment_voucher_not_found');
		return voucher;
	}

	/** A7: self-invoices by the day received; "Due soon" are drafts still inside the 30 days. */
	list(query: SelfInvoiceListQuery, now = new Date()) {
		return this.invoices.list({ ...query, dueSoonFrom: addDays(istDay(now), -30) });
	}

	/** A6: every payment to a supplier. */
	listPaymentVouchers(query: PaymentVoucherListQuery) {
		return this.vouchers.list(query);
	}

	paymentVouchersFor(kind: PaymentVoucher['against']['kind'], id: string): Promise<PaymentVoucher[]> {
		return this.vouchers.forDocument(kind, id);
	}

	/**
	 * Where a self-invoice is made: the person's current location, else the first of theirs with a GSTIN, and its GST
	 * registration. Reverse charge falls on a registered buyer, so a location without a GSTIN can't make one.
	 */
	private async where(principal: AuthenticatedPrincipal | undefined) {
		const scope = await this.locations.scope(principal);
		const locations = await this.locationRepo.list();
		const mine = (scope.current ? [scope.current] : scope.ids).flatMap((id) =>
			locations.filter((l) => l.id === id),
		);
		const location = mine.find((l) => l.gstRegistrationId) ?? mine[0];
		if (!location) throw new ConflictException(accountsRefusal('self_invoice_needs_a_location'));
		const registration = location.gstRegistrationId
			? await this.company.getRegistration(location.gstRegistrationId)
			: null;
		if (!registration) throw new ConflictException(accountsRefusal('self_invoice_needs_a_gstin'));
		return { locationId: location.id, gstRegistrationId: registration.id, state: registration.gstin.slice(0, 2) };
	}

	/** D2's choices: suppliers without a GSTIN, and the reverse-charge list for the day received. */
	async form(receivedOn: string, principal: AuthenticatedPrincipal | undefined): Promise<SelfInvoiceForm> {
		const [{ state }, page, choices] = await Promise.all([
			this.where(principal),
			this.suppliers.list({ filter: 'all', page: 1, pageSize: 500 }, new Map()),
			this.templates.rcmChoices(receivedOn),
		]);
		return {
			suppliers: page.items
				.filter((s) => s.active && !s.gstin)
				.map((s) => ({ id: s.id, name: s.legalName, stateCode: s.stateCode })),
			choices,
			placeOfSupply: state,
		};
	}

	/** A draft from the form: checked, with the rule copied and the tax worked out. */
	private async build(
		write: SelfInvoiceWrite,
		base: SelfInvoice | null,
		principal: AuthenticatedPrincipal | undefined,
		now: Date,
	): Promise<SelfInvoice> {
		const supplier = await this.suppliers.findById(write.supplierId);
		if (!supplier) throw new NotFoundException('supplier_not_found');
		const where = await this.where(principal);
		const choice = (await this.templates.rcmChoices(write.receivedOn)).find((c) => c.key === write.ruleKey) ?? null;
		const [problem] = selfInvoiceProblems({
			supplierGstin: supplier.gstin,
			choice,
			receivedOn: write.receivedOn,
			today: istDay(now),
		});
		if (problem || !choice) throw new BadRequestException(accountsRefusal(String(problem)));
		const interState = supplier.stateCode !== where.state;
		const at = now.toISOString();
		const actor = actorOf(principal);
		return SelfInvoice.parse({
			id: base?.id ?? `si_${randomUUID()}`,
			number: null,
			status: 'draft',
			supplierId: supplier.id,
			supplierName: supplier.legalName,
			supplierAddress: addressOf(supplier),
			supplierStateCode: supplier.stateCode,
			rule: choice,
			forMonth: write.forMonth,
			receivedOn: write.receivedOn,
			date: null,
			locationId: where.locationId,
			gstRegistrationId: where.gstRegistrationId,
			placeOfSupply: where.state,
			interState,
			taxableINR: write.taxableINR,
			...selfInvoiceTax(write.taxableINR, choice.ratePercent, interState),
			paidINR: 0,
			paymentVouchers: [],
			late: false,
			journalVoucherId: null,
			cancelReason: null,
			version: base?.version ?? 0,
			createdAt: base?.createdAt ?? at,
			createdBy: base?.createdBy ?? actor,
			updatedAt: at,
			updatedBy: actor,
			issuedAt: null,
			issuedBy: null,
			cancelledAt: null,
			cancelledBy: null,
		});
	}

	async create(write: SelfInvoiceWrite, principal: AuthenticatedPrincipal | undefined, now = new Date()) {
		const draft = await this.build(write, null, principal, now);
		await this.invoices.insert(draft);
		await this.log.append(actorOf(principal), 'selfInvoice.create', 'selfInvoice', draft.id, [], {
			supplier: draft.supplierName,
			what: draft.rule.name,
		});
		return draft;
	}

	private async draft(id: string, version: number | null): Promise<SelfInvoice> {
		const invoice = await this.get(id);
		if (invoice.status !== 'draft') throw new ConflictException(accountsRefusal('self_invoice_not_draft'));
		if (version !== null && version !== invoice.version)
			throw new ConflictException(accountsRefusal('self_invoice_changed'));
		return invoice;
	}

	private async saveOrConflict(
		invoice: SelfInvoice,
		expected: number,
		context?: TransactionContext,
	): Promise<SelfInvoice> {
		return this.invoices.save(invoice, expected, context).catch((error: Error) => {
			throw new ConflictException(accountsRefusal(error.message));
		});
	}

	async save(id: string, write: SelfInvoiceWrite, principal: AuthenticatedPrincipal | undefined, now = new Date()) {
		const before = await this.draft(id, write.version);
		const next = await this.build(write, before, principal, now);
		const saved = await this.saveOrConflict(next, before.version);
		const fields: [string, (invoice: SelfInvoice) => unknown][] = [
			['supplier', (invoice) => invoice.supplierName],
			['what', (invoice) => invoice.rule.name],
			['forMonth', (invoice) => invoice.forMonth],
			['receivedOn', (invoice) => invoice.receivedOn],
			['taxable', (invoice) => invoice.taxableINR],
		];
		await this.log.append(
			actorOf(principal),
			'selfInvoice.save',
			'selfInvoice',
			id,
			fields
				.filter(([, read]) => read(before) !== read(saved))
				.map(([field, read]) => ({ field, before: read(before), after: read(saved) })),
		);
		return saved;
	}

	async remove(id: string, principal: AuthenticatedPrincipal | undefined): Promise<void> {
		await this.draft(id, null);
		if (!(await this.invoices.removeDraft(id)))
			throw new ConflictException(accountsRefusal('self_invoice_not_draft'));
		await this.log.append(actorOf(principal), 'selfInvoice.delete', 'selfInvoice', id, []);
	}

	/** D2 Issue: the SI number, the posting (through roles) and the 30-day flag, all or nothing. */
	async issue(id: string, version: number, principal: AuthenticatedPrincipal | undefined, now = new Date()) {
		const draft = await this.draft(id, version);
		const actor = actorOf(principal);
		const date = istDay(now);
		const issued = await this.tx.withTransaction(async (context) => {
			const number = await this.numbers.issue('selfInvoice', context, now);
			const posted = await this.ledger.post(
				{
					date,
					narration: `Self-invoice ${number} · ${draft.supplierName} · ${draft.rule.name}`,
					lines: selfInvoicePosting(draft).map((row) => ({
						ledger: { role: row.role },
						locationId: draft.locationId,
						debitPaise: row.debitPaise,
						creditPaise: row.creditPaise,
					})),
					source: { type: 'selfInvoice', id, number },
					idempotencyKey: `selfInvoice:${id}`,
				},
				context,
				actor,
			);
			const next: SelfInvoice = {
				...draft,
				number,
				status: 'issued',
				date,
				late: date > selfInvoiceDeadline(draft.receivedOn),
				journalVoucherId: posted.id,
				updatedAt: now.toISOString(),
				updatedBy: actor,
				issuedAt: now.toISOString(),
				issuedBy: actor,
			};
			return this.saveOrConflict(next, draft.version, context);
		});
		await this.log.append(actor, 'selfInvoice.issue', 'selfInvoice', id, [], {
			number: issued.number,
			late: issued.late,
		});
		return issued;
	}

	/** Paid from: the cash ledger for cash; otherwise the bank ledger chosen, or the only one the books have. */
	private async paidFrom(write: Pick<SelfInvoicePayWrite, 'mode' | 'paidFromLedgerId'>) {
		if (write.mode === 'cash') return { role: 'cash' };
		const chart = await this.ledger.chart();
		const banks = chart.ledgers.filter((l) => l.active && ledgerClass(l, chart.groups) === 'bank');
		if (write.paidFromLedgerId) {
			if (!banks.some((l) => l.id === write.paidFromLedgerId))
				throw new BadRequestException(accountsRefusal('payment_needs_a_bank_ledger'));
			return { id: write.paidFromLedgerId };
		}
		const [only, other] = banks;
		if (!only) throw new BadRequestException(accountsRefusal('payment_needs_a_bank_ledger'));
		if (other) throw new BadRequestException(accountsRefusal('payment_choose_bank_ledger'));
		return { id: only.id };
	}

	/** D3: pay the supplier; the payment voucher (PV/) is issued with it and both post, all or nothing. */
	async pay(id: string, write: SelfInvoicePayWrite, principal: AuthenticatedPrincipal | undefined, now = new Date()) {
		const invoice = await this.get(id);
		if (invoice.status !== 'issued') throw new ConflictException(accountsRefusal('self_invoice_not_issued'));
		if (write.version !== invoice.version) throw new ConflictException(accountsRefusal('self_invoice_changed'));
		if (write.amountINR > invoice.taxableINR - invoice.paidINR + 0.005)
			throw new BadRequestException(accountsRefusal('overpayment'));
		if (write.paidOn > istDay(now)) throw new BadRequestException(accountsRefusal('paid_in_future'));
		if (write.paidOn < (invoice.date as string))
			throw new BadRequestException(accountsRefusal('paid_before_self_invoice'));
		const from = await this.paidFrom(write);
		const actor = actorOf(principal);
		const at = now.toISOString();
		const result = await this.tx.withTransaction(async (context) => {
			const number = await this.numbers.issue('paymentVoucher', context, now);
			const voucherId = `pv_${randomUUID()}`;
			const posted = await this.ledger.post(
				{
					date: write.paidOn,
					narration: `Payment voucher ${number} · ${invoice.supplierName} · ${invoice.number}`,
					lines: supplierPaymentPosting(write.amountINR, from).map((line) => ({
						...line,
						locationId: invoice.locationId,
					})),
					source: { type: 'paymentVoucher', id: voucherId, number },
					idempotencyKey: `paymentVoucher:${voucherId}`,
				},
				context,
				actor,
			);
			const voucher = PaymentVoucher.parse({
				id: voucherId,
				number,
				date: write.paidOn,
				supplierId: invoice.supplierId,
				payeeName: invoice.supplierName,
				payeeAddress: invoice.supplierAddress,
				against: { kind: 'selfInvoice', id: invoice.id, number: invoice.number, detail: invoice.rule.name },
				amountINR: write.amountINR,
				mode: write.mode,
				reference: write.reference,
				paidFromLedgerId: 'id' in from ? from.id : null,
				reverseChargeTaxINR: invoice.taxINR,
				supplierPaymentId: null,
				journalVoucherId: posted.id,
				locationId: invoice.locationId,
				createdAt: at,
				createdBy: actor,
			});
			await this.vouchers.insert(voucher, context);
			const paidINR = Math.round((invoice.paidINR + write.amountINR) * 100) / 100;
			const saved = await this.saveOrConflict(
				{
					...invoice,
					paidINR,
					paymentVouchers: [...invoice.paymentVouchers, { id: voucher.id, number: voucher.number }],
					updatedAt: at,
					updatedBy: actor,
				},
				invoice.version,
				context,
			);
			return { invoice: saved, voucher };
		});
		await this.log.append(actor, 'selfInvoice.pay', 'selfInvoice', id, [
			{ field: 'paidINR', before: invoice.paidINR, after: result.invoice.paidINR },
		]);
		await this.log.append(actor, 'paymentVoucher.issue', 'paymentVoucher', result.voucher.id, [], {
			number: result.voucher.number,
			against: invoice.number,
		});
		return result;
	}

	/** Who may cancel, and why not (super admin, issued, unpaid, month not filed). */
	async cancelProblems(invoice: SelfInvoice, principal: AuthenticatedPrincipal | undefined): Promise<string[]> {
		const month = (invoice.date ?? invoice.receivedOn).slice(0, 7);
		const [superAdmin, filings] = await Promise.all([this.ledger.isSuperAdmin(principal), this.filings.list()]);
		const monthFiled = filings.some((f) => f.gstRegistrationId === invoice.gstRegistrationId && f.month === month);
		return selfInvoiceCancelProblems(invoice, { superAdmin, monthFiled });
	}

	/** A super admin cancels an unpaid issued self-invoice while its month isn't filed; its posting is reversed. */
	async cancel(
		id: string,
		write: SelfInvoiceCancel,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	) {
		const invoice = await this.get(id);
		if (write.version !== invoice.version) throw new ConflictException(accountsRefusal('self_invoice_changed'));
		const [problem] = await this.cancelProblems(invoice, principal);
		const actor = actorOf(principal);
		if (problem) {
			await this.log.append(actor, 'selfInvoice.cancel_refused', 'selfInvoice', id, [], { why: problem });
			throw new ConflictException(accountsRefusal(problem));
		}
		const at = now.toISOString();
		const cancelled = await this.tx.withTransaction(async (context) => {
			await this.ledger.post(
				{
					date: istDay(now),
					narration: `Cancelled self-invoice ${invoice.number} · ${write.reason}`,
					lines: oppositePosting(selfInvoicePosting(invoice)).map((row) => ({
						ledger: { role: row.role },
						locationId: invoice.locationId,
						debitPaise: row.debitPaise,
						creditPaise: row.creditPaise,
					})),
					source: { type: 'selfInvoice', id, number: invoice.number },
					idempotencyKey: `selfInvoice:${id}:cancel`,
				},
				context,
				actor,
			);
			return this.saveOrConflict(
				{
					...invoice,
					status: 'cancelled',
					cancelReason: write.reason,
					updatedAt: at,
					updatedBy: actor,
					cancelledAt: at,
					cancelledBy: actor,
				},
				invoice.version,
				context,
			);
		});
		await this.log.append(
			actor,
			'selfInvoice.cancel',
			'selfInvoice',
			id,
			[{ field: 'status', before: 'issued', after: 'cancelled' }],
			{ reason: write.reason },
		);
		return cancelled;
	}

	/**
	 * D4 (decision D5): a purchase entry's payment, recorded by the purchases page's own step unchanged, then given its
	 * payment voucher. Purchase bills don't post to the books, so neither does this voucher.
	 */
	async payPurchaseEntry(
		entryId: string,
		write: SupplierPaymentWrite,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	) {
		const actor = actorOf(principal);
		const before = new Set((await this.purchases.paymentsFor(entryId)).map((p) => p.id));
		const entry = await this.purchases.recordPayment(entryId, write, actor);
		const payment = (await this.purchases.paymentsFor(entryId)).find((p) => !before.has(p.id));
		if (!payment) throw new ConflictException(accountsRefusal('payment_not_recorded'));
		const supplier = await this.suppliers.findById(entry.supplierId);
		const voucher = await this.tx.withTransaction(async (context) => {
			const made = PaymentVoucher.parse({
				id: `pv_${randomUUID()}`,
				number: await this.numbers.issue('paymentVoucher', context, now),
				date: payment.paidOn,
				supplierId: entry.supplierId,
				payeeName: entry.supplierName,
				payeeAddress: supplier ? addressOf(supplier) : '',
				against: { kind: 'purchaseEntry', id: entry.id, number: entry.number },
				amountINR: payment.amountINR,
				mode: payment.mode,
				reference: payment.reference,
				paidFromLedgerId: null,
				reverseChargeTaxINR: null,
				supplierPaymentId: payment.id,
				journalVoucherId: null,
				locationId: null,
				createdAt: now.toISOString(),
				createdBy: actor,
			});
			await this.vouchers.insert(made, context);
			return made;
		});
		await this.log.append(actor, 'paymentVoucher.issue', 'paymentVoucher', voucher.id, [], {
			number: voucher.number,
			against: entry.number,
		});
		return { entry, voucher };
	}

	/**
	 * Cancel a payment voucher (brief table: while its month is open for its cash or bank part; the bill is owed again;
	 * a reversing voucher). A self-invoice's payment is reversed in the books here; a purchase entry's goes through the
	 * purchases page's own reversal, unchanged.
	 */
	async cancelPaymentVoucher(
		id: string,
		write: PaymentVoucherCancel,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<PaymentVoucher> {
		const voucher = await this.paymentVoucher(id);
		const [superAdmin, locks] = await Promise.all([this.ledger.isSuperAdmin(principal), this.periods.list()]);
		const part = voucher.mode === 'cash' ? 'cash' : 'bank';
		const monthLocked = periodStateOf(locks, voucher.date.slice(0, 7), part) !== 'open';
		const [problem] = paymentVoucherCancelProblems(voucher, { superAdmin, monthLocked });
		const actor = actorOf(principal);
		if (problem) {
			await this.log.append(actor, 'paymentVoucher.cancel_refused', 'paymentVoucher', id, [], { why: problem });
			throw new ConflictException(accountsRefusal(problem));
		}
		const at = now.toISOString();
		const cancelled: PaymentVoucher = {
			...voucher,
			status: 'cancelled',
			cancelledAt: at,
			cancelledBy: actor,
			cancelReason: write.reason,
		};
		const done =
			voucher.against.kind === 'purchaseEntry'
				? await this.purchases
						.reversePayment(voucher.against.id, voucher.supplierPaymentId as string, write.reason, actor)
						.then(() => this.vouchers.cancel(cancelled))
						.then(() => cancelled)
				: await this.tx.withTransaction(async (context) => {
						const invoice =
							voucher.against.kind === 'selfInvoice' ? await this.get(voucher.against.id) : null;
						const paidFrom = voucher.paidFromLedgerId ? { id: voucher.paidFromLedgerId } : { role: 'cash' };
						const posted = await this.ledger.post(
							{
								date: istDay(now),
								narration: `Cancelled payment voucher ${voucher.number} · ${write.reason}`,
								lines: supplierPaymentPosting(voucher.amountINR, paidFrom).map((line) => ({
									ledger: line.ledger,
									locationId: voucher.locationId as string,
									debitPaise: line.creditPaise,
									creditPaise: line.debitPaise,
								})),
								source: { type: 'paymentVoucher', id, number: voucher.number },
								idempotencyKey: `paymentVoucher:${id}:cancel`,
							},
							context,
							actor,
						);
						const next = { ...cancelled, reversalVoucherId: posted.id };
						await this.vouchers.cancel(next, context);
						if (!invoice) {
							await this.unpayExpenseBill(voucher, at, context);
							return next;
						}
						await this.saveOrConflict(
							{
								...invoice,
								paidINR: Math.round((invoice.paidINR - voucher.amountINR) * 100) / 100,
								paymentVouchers: invoice.paymentVouchers.filter((pv) => pv.id !== id),
								updatedAt: at,
								updatedBy: actor,
							},
							invoice.version,
							context,
						);
						return next;
					});
		await this.log.append(
			actor,
			'paymentVoucher.cancel',
			'paymentVoucher',
			id,
			[{ field: 'status', before: 'paid', after: 'cancelled' }],
			{ reason: write.reason },
		);
		return done;
	}

	/** Brief 25 EB: an expense bill's payment voucher cancelled, so the bill is owed that much again. */
	private async unpayExpenseBill(voucher: PaymentVoucher, at: string, context: TransactionContext): Promise<void> {
		const bill = await this.expenseBills.get(voucher.against.id);
		if (!bill) throw new NotFoundException(accountsRefusal('expense_bill_not_found'));
		try {
			await this.expenseBills.save(
				{
					...bill,
					paidINR: Math.round((bill.paidINR - voucher.amountINR) * 100) / 100,
					paymentVouchers: bill.paymentVouchers.filter((pv) => pv.id !== voucher.id),
					updatedAt: at,
				},
				bill.version,
				context,
			);
		} catch (error) {
			if (error instanceof Error && error.message === 'expense_bill_changed')
				throw new ConflictException(accountsRefusal('expense_bill_changed'));
			throw error;
		}
	}

	/** Q11: every print is in the document's log. */
	async printed(type: 'selfInvoice' | 'paymentVoucher', id: string, actorId: string | null): Promise<void> {
		await this.log.append(actorId, `${type}.print`, type, id, [], { format: 'pdf' });
	}
}
