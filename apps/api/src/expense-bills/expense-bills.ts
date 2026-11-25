import { randomUUID } from 'node:crypto';

import {
	BadRequestException,
	Body,
	ConflictException,
	Controller,
	Get,
	Header,
	Inject,
	Injectable,
	Module,
	NotFoundException,
	Param,
	Post,
	Put,
	Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	ExpenseBillPayWrite,
	ExpenseBillStatus,
	ExpenseBillWrite,
	IsoDate,
	PaymentVoucher,
	type ChartOfAccounts,
	type ExpenseBill,
	type ExpenseBillForm,
} from '@saha-textile/contracts';
import {
	appropriationLedgerIds,
	expenseBillPosting,
	addDays,
	expenseBillTotals,
	istDay,
	ledgerClass,
	supplierPaymentPosting,
	termsOn,
	type CompanyRepository,
	type ExpenseBillRepository,
	type LocationRepository,
	type PaymentVoucherRepository,
	type SupplierRepository,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';
import { z } from 'zod';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
	COMPANY_REPOSITORY,
	EXPENSE_BILL_REPOSITORY,
	LOCATION_REPOSITORY,
	PAYMENT_VOUCHER_REPOSITORY,
	SUPPLIER_REPOSITORY,
	TRANSACTION_MANAGER,
} from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';
import { EditLogService } from '../ledger/edit-log';
import { LedgerModule } from '../ledger/ledger.module';
import { LedgerService } from '../ledger/ledger.service';
import { API_TAGS } from '../openapi-tags';
import { DocumentNumbersService } from '../orders-setup/document-numbers.service';
import { OrdersSetupModule } from '../orders-setup/orders-setup.module';

const refuse = (code: string) => new BadRequestException(accountsRefusal(code));
const ExpenseBillEdit = ExpenseBillWrite.extend({ version: z.number().int().nonnegative() });
type ExpenseBillEdit = z.infer<typeof ExpenseBillEdit>;
const ExpenseBillCancel = z.object({ reason: z.string().trim().min(3).max(300) });
/**
 * The ledgers a bill's line can be booked to: active expense ledgers open to postings (not control ledgers), leaving out
 * a firm's appropriation ledgers (interest, remuneration and share of profit to partners), which share the profit
 * instead of making it.
 */
export const expenseLedgers = (chart: ChartOfAccounts) => {
	const shared = appropriationLedgerIds(chart);
	return chart.ledgers.filter((l) => l.active && l.nature === 'expense' && l.handPosting && !shared.has(l.id));
};
const ExpenseBillQuery = z.object({
	supplierId: z.string().optional(),
	status: ExpenseBillStatus.optional(),
	from: IsoDate.optional(),
	to: IsoDate.optional(),
});

/**
 * Purchases › Expense bills (brief 25 EB1, EB2; approved 2026-11-25): a registered supplier's bill for something that
 * isn't stock, saved as a draft, posted once with its EB number (the expense, claimable input tax at the billed
 * location, the supplier owed), cancelled by reversing that voucher. Tax is CGST and SGST when the supplier's GSTIN is
 * in the billed location's State, IGST otherwise; a supplier without a GSTIN can't charge GST.
 */
@Injectable()
export class ExpenseBillsService {
	constructor(
		@Inject(EXPENSE_BILL_REPOSITORY) private readonly bills: ExpenseBillRepository,
		@Inject(SUPPLIER_REPOSITORY) private readonly suppliers: Pick<SupplierRepository, 'findById'>,
		@Inject(LOCATION_REPOSITORY) private readonly locations: Pick<LocationRepository, 'list'>,
		@Inject(COMPANY_REPOSITORY) private readonly company: Pick<CompanyRepository, 'listRegistrations'>,
		@Inject(LedgerService) private readonly ledger: Pick<LedgerService, 'post' | 'voucherByKey' | 'chart'>,
		@Inject(DocumentNumbersService) private readonly numbers: Pick<DocumentNumbersService, 'issue'>,
		@Inject(TRANSACTION_MANAGER) private readonly transactions: TransactionManagerPort,
		@Inject(PAYMENT_VOUCHER_REPOSITORY)
		private readonly vouchers: Pick<PaymentVoucherRepository, 'insert' | 'forDocument'>,
		@Inject(EditLogService) private readonly log: Pick<EditLogService, 'append'>,
	) {}

	list(query: z.infer<typeof ExpenseBillQuery>): Promise<ExpenseBill[]> {
		return this.bills.list(query);
	}

	async get(id: string): Promise<ExpenseBill> {
		const bill = await this.bills.get(id);
		if (!bill) throw new NotFoundException(accountsRefusal('expense_bill_not_found'));
		return bill;
	}

	/** EB1's choices: active locations with the GSTIN they bill under, and the expense ledgers by name. */
	async form(): Promise<ExpenseBillForm> {
		const [locations, registrations, chart] = await Promise.all([
			this.locations.list(),
			this.company.listRegistrations(),
			this.ledger.chart(),
		]);
		const today = istDay(new Date());
		return {
			locations: locations
				.filter((l) => l.active)
				.map((l) => {
					const registration = registrations.find((r) => r.id === l.gstRegistrationId) ?? null;
					return {
						id: l.id,
						name: l.name,
						stateCode: l.stateCode,
						gstin: registration?.gstin ?? null,
						composition: registration ? termsOn(registration, today)?.kind === 'composition' : false,
					};
				}),
			ledgers: expenseLedgers(chart)
				.map((l) => ({ id: l.id, name: l.name }))
				.sort((a, b) => a.name.localeCompare(b.name)),
		};
	}

	/**
	 * The bill's figures from its lines, after the checks: a known supplier and location; every line on an expense
	 * ledger; no GST from a supplier without a GSTIN (reverse charge is a self-invoice); credit claimed only at a
	 * location billing under a GSTIN that isn't on composition.
	 */
	private async worked(write: ExpenseBillWrite) {
		const supplier = await this.suppliers.findById(write.supplierId);
		if (!supplier) throw refuse('supplier_unknown');
		// Only an active location can be billed to, as the form offers.
		const location = (await this.locations.list()).find((l) => l.id === write.locationId && l.active);
		if (!location) throw refuse('location_unknown');
		const ledgers = new Set(expenseLedgers(await this.ledger.chart()).map((l) => l.id));
		if (write.lines.some((l) => !ledgers.has(l.expenseLedgerId))) throw refuse('expense_bill_not_an_expense');
		if (!supplier.gstin && write.lines.some((l) => l.gstRatePct > 0)) throw refuse('use_self_invoice');
		if (write.lines.some((l) => l.credit === 'claim' && l.gstRatePct > 0)) {
			const registration = (await this.company.listRegistrations()).find(
				(r) => r.id === location.gstRegistrationId,
			);
			if (!registration) throw refuse('expense_bill_no_gstin');
			if (termsOn(registration, write.billDate)?.kind === 'composition')
				throw refuse('expense_bill_composition_no_credit');
		}
		const interState = !!supplier.gstin && supplier.gstin.slice(0, 2) !== location.stateCode;
		return {
			supplierName: supplier.shortName || supplier.legalName,
			supplierGstin: supplier.gstin ?? null,
			dueOn: addDays(write.billDate, supplier.paymentTermsDays),
			interState,
			...expenseBillTotals(write.lines, interState),
		};
	}

	async create(write: ExpenseBillWrite, now = new Date()): Promise<ExpenseBill> {
		const figures = await this.worked(write);
		const at = now.toISOString();
		return this.bills.save(
			{
				...write,
				...figures,
				id: `eb_${randomUUID()}`,
				number: null,
				status: 'draft',
				voucherId: null,
				postedAt: null,
				postedBy: null,
				paidINR: 0,
				paymentVouchers: [],
				cancelledAt: null,
				cancelReason: null,
				createdAt: at,
				updatedAt: at,
				version: 0,
			},
			null,
		);
	}

	private async saved(bill: ExpenseBill, version: number, context?: Parameters<ExpenseBillRepository['save']>[2]) {
		try {
			return await this.bills.save(bill, version, context);
		} catch (error) {
			if (error instanceof Error && error.message === 'expense_bill_changed')
				throw new ConflictException(accountsRefusal('expense_bill_changed'));
			throw error;
		}
	}

	async update(id: string, edit: ExpenseBillEdit, now = new Date()): Promise<ExpenseBill> {
		const bill = await this.get(id);
		if (bill.status !== 'draft') throw refuse('expense_bill_not_draft');
		const { version, ...write } = edit;
		return this.saved({ ...bill, ...write, ...(await this.worked(write)), updatedAt: now.toISOString() }, version);
	}

	/** EB1 Post: its number, then one voucher dated the bill's day (refused in a locked month). */
	async post(id: string, principal: AuthenticatedPrincipal | undefined, now = new Date()): Promise<ExpenseBill> {
		const bill = await this.get(id);
		if (bill.status !== 'draft') throw refuse('expense_bill_not_draft');
		const by = principal?.userId ?? null;
		return this.transactions.withTransaction(async (context) => {
			const number = await this.numbers.issue('expenseBill', context, new Date(`${bill.billDate}T06:30:00Z`));
			const voucher = await this.ledger.post(
				{
					kind: 'document',
					date: bill.billDate,
					narration: `Expense bill ${number} (${bill.billNumber})`,
					source: { type: 'expenseBill', id: bill.id, number },
					idempotencyKey: `expenseBill:${bill.id}`,
					lines: expenseBillPosting(bill),
				},
				context,
				by,
			);
			return this.saved(
				{
					...bill,
					number,
					status: 'posted',
					voucherId: voucher.id,
					postedAt: now.toISOString(),
					postedBy: by,
					updatedAt: now.toISOString(),
				},
				bill.version,
				context,
			);
		});
	}

	/**
	 * Cancel: a draft simply; a posted bill by posting the opposite of its voucher, dated the day it is cancelled (as a
	 * voided purchase entry is), in the same transaction. The number is kept and never reused.
	 */
	async cancel(id: string, reason: string, principal: AuthenticatedPrincipal | undefined, now = new Date()) {
		const bill = await this.get(id);
		if (bill.status === 'cancelled') throw refuse('expense_bill_cancelled');
		if (bill.paidINR > 0.005) throw refuse('expense_bill_paid');
		const by = principal?.userId ?? null;
		return this.transactions.withTransaction(async (context) => {
			const original = await this.ledger.voucherByKey(`expenseBill:${bill.id}`, context);
			if (original)
				await this.ledger.post(
					{
						kind: 'document',
						date: istDay(now),
						narration: `Cancelled expense bill ${bill.number ?? bill.billNumber}: ${reason}`,
						source: { type: 'expenseBill', id: bill.id, number: bill.number },
						idempotencyKey: `expenseBill:${bill.id}:cancel`,
						lines: original.lines.map((line) => ({
							ledger: { id: line.ledgerId },
							locationId: line.locationId,
							debitPaise: line.creditPaise,
							creditPaise: line.debitPaise,
						})),
					},
					context,
					by,
				);
			const at = now.toISOString();
			return this.saved(
				{ ...bill, status: 'cancelled', cancelledAt: at, cancelReason: reason, updatedAt: at },
				bill.version,
				context,
			);
		});
	}

	/** The payment vouchers that paid a bill, newest last. */
	paymentVouchers(id: string): Promise<PaymentVoucher[]> {
		return this.vouchers.forDocument('expenseBill', id);
	}

	/** Where the money left from: cash, the one bank, or the bank picked when there are several. */
	private async paidFrom(write: Pick<ExpenseBillPayWrite, 'mode' | 'paidFromLedgerId'>) {
		if (write.mode === 'cash') return { role: 'cash' };
		const chart = await this.ledger.chart();
		const banks = chart.ledgers.filter((l) => l.active && ledgerClass(l, chart.groups) === 'bank');
		if (write.paidFromLedgerId) {
			if (!banks.some((l) => l.id === write.paidFromLedgerId)) throw refuse('payment_needs_a_bank_ledger');
			return { id: write.paidFromLedgerId };
		}
		const [only, other] = banks;
		if (!only) throw refuse('payment_needs_a_bank_ledger');
		if (other) throw refuse('payment_choose_bank_ledger');
		return { id: only.id };
	}

	/**
	 * Pay a posted bill, in part or in full, "with the payment voucher purchase bills already use" (EB1): the voucher
	 * (PV) is issued and the supplier debited against the bank or cash, all or nothing, as a self-invoice is paid.
	 */
	async pay(id: string, write: ExpenseBillPayWrite, principal: AuthenticatedPrincipal | undefined, now = new Date()) {
		const bill = await this.get(id);
		if (bill.status !== 'posted') throw new ConflictException(accountsRefusal('expense_bill_not_posted'));
		if (write.version !== bill.version) throw new ConflictException(accountsRefusal('expense_bill_changed'));
		if (write.amountINR > bill.totalINR - bill.paidINR + 0.005) throw refuse('overpayment');
		if (write.paidOn > istDay(now)) throw refuse('paid_in_future');
		if (write.paidOn < bill.billDate) throw refuse('expense_bill_paid_before_bill');
		const from = await this.paidFrom(write);
		const supplier = await this.suppliers.findById(bill.supplierId);
		const by = principal?.userId ?? null;
		const at = now.toISOString();
		const result = await this.transactions.withTransaction(async (context) => {
			const number = await this.numbers.issue('paymentVoucher', context, now);
			const voucherId = `pv_${randomUUID()}`;
			const posted = await this.ledger.post(
				{
					date: write.paidOn,
					narration: `Payment voucher ${number} · ${bill.supplierName} · ${bill.number ?? bill.billNumber}`,
					lines: supplierPaymentPosting(write.amountINR, from).map((line) => ({
						...line,
						locationId: bill.locationId,
					})),
					source: { type: 'paymentVoucher', id: voucherId, number },
					idempotencyKey: `paymentVoucher:${voucherId}`,
				},
				context,
				by,
			);
			const voucher = PaymentVoucher.parse({
				id: voucherId,
				number,
				date: write.paidOn,
				supplierId: bill.supplierId,
				payeeName: bill.supplierName,
				payeeAddress: supplier
					? [supplier.address.line, [supplier.address.city, supplier.address.pin].filter(Boolean).join(' ')]
							.filter(Boolean)
							.join(', ')
					: '',
				against: {
					kind: 'expenseBill',
					id: bill.id,
					number: bill.number ?? bill.billNumber,
					detail: bill.lines.map((line) => line.what).join(', '),
				},
				amountINR: write.amountINR,
				mode: write.mode,
				reference: write.reference,
				paidFromLedgerId: 'id' in from ? from.id : null,
				reverseChargeTaxINR: null,
				supplierPaymentId: null,
				journalVoucherId: posted.id,
				locationId: bill.locationId,
				createdAt: at,
				createdBy: by,
			});
			await this.vouchers.insert(voucher, context);
			const saved = await this.saved(
				{
					...bill,
					paidINR: Math.round((bill.paidINR + write.amountINR) * 100) / 100,
					paymentVouchers: [...bill.paymentVouchers, { id: voucher.id, number: voucher.number }],
					updatedAt: at,
				},
				bill.version,
				context,
			);
			return { bill: saved, voucher };
		});
		await this.log.append(by, 'paymentVoucher.issue', 'paymentVoucher', result.voucher.id, [], {
			number: result.voucher.number,
			against: result.bill.number ?? result.bill.billNumber,
		});
		return result;
	}
}

@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/expense-bills')
export class ExpenseBillsController {
	constructor(private readonly bills: ExpenseBillsService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'expenseBills', summary: 'Expense bills (brief 25 EB1)' })
	list(@Query(new ZodValidationPipe(ExpenseBillQuery)) query: z.infer<typeof ExpenseBillQuery>) {
		return this.bills.list(query);
	}

	@Get('form')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'expenseBillForm', summary: 'Locations and expense ledgers for the form' })
	form() {
		return this.bills.form();
	}

	@Get(':id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'expenseBill', summary: 'One expense bill' })
	get(@Param('id') id: string) {
		return this.bills.get(id);
	}

	@Post()
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'expenseBillCreate', summary: 'Save a new expense bill as a draft' })
	create(@Body(new ZodValidationPipe(ExpenseBillWrite)) body: ExpenseBillWrite) {
		return this.bills.create(body);
	}

	@Put(':id')
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'expenseBillUpdate', summary: 'Change a draft expense bill' })
	update(@Param('id') id: string, @Body(new ZodValidationPipe(ExpenseBillEdit)) body: ExpenseBillEdit) {
		return this.bills.update(id, body);
	}

	@Post(':id/post')
	@RequirePermissions('accounts.post')
	@ApiOperation({ operationId: 'expenseBillPost', summary: 'Post an expense bill to the books' })
	post(@Param('id') id: string, @Principal() principal?: AuthenticatedPrincipal) {
		return this.bills.post(id, principal);
	}

	@Get(':id/payment-vouchers')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'expenseBillPaymentVouchers', summary: 'The payment vouchers that paid a bill' })
	paymentVouchers(@Param('id') id: string) {
		return this.bills.paymentVouchers(id);
	}

	@Post(':id/pay')
	@RequirePermissions('purchase.payment')
	@ApiOperation({ operationId: 'expenseBillPay', summary: 'Pay an expense bill; its payment voucher is issued' })
	pay(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(ExpenseBillPayWrite)) body: ExpenseBillPayWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.bills.pay(id, body, principal);
	}

	@Post(':id/cancel')
	@RequirePermissions('accounts.post')
	@ApiOperation({ operationId: 'expenseBillCancel', summary: 'Cancel an expense bill (a posted one is reversed)' })
	cancel(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(ExpenseBillCancel)) body: z.infer<typeof ExpenseBillCancel>,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.bills.cancel(id, body.reason, principal);
	}
}

/** Purchases › Expense bills (brief 25 EB). */
@Module({
	imports: [LedgerModule, OrdersSetupModule],
	controllers: [ExpenseBillsController],
	providers: [ExpenseBillsService],
})
export class ExpenseBillsModule {}
