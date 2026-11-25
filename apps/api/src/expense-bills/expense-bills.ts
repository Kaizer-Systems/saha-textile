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
	ExpenseBillStatus,
	ExpenseBillWrite,
	type ChartOfAccounts,
	type ExpenseBill,
	type ExpenseBillForm,
} from '@saha-textile/contracts';
import {
	expenseBillPosting,
	expenseBillTotals,
	istDay,
	termsOn,
	type CompanyRepository,
	type ExpenseBillRepository,
	type LocationRepository,
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
	SUPPLIER_REPOSITORY,
	TRANSACTION_MANAGER,
} from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';
import { LedgerModule } from '../ledger/ledger.module';
import { LedgerService } from '../ledger/ledger.service';
import { API_TAGS } from '../openapi-tags';
import { DocumentNumbersService } from '../orders-setup/document-numbers.service';
import { OrdersSetupModule } from '../orders-setup/orders-setup.module';

const refuse = (code: string) => new BadRequestException(accountsRefusal(code));
const ExpenseBillEdit = ExpenseBillWrite.extend({ version: z.number().int().nonnegative() });
type ExpenseBillEdit = z.infer<typeof ExpenseBillEdit>;
const ExpenseBillCancel = z.object({ reason: z.string().trim().min(3).max(300) });
/** The ledgers a bill's line can be booked to: active expense ledgers open to postings (not control ledgers). */
export const expenseLedgers = (chart: ChartOfAccounts) =>
	chart.ledgers.filter((l) => l.active && l.nature === 'expense' && l.handPosting);
const ExpenseBillQuery = z.object({ supplierId: z.string().optional(), status: ExpenseBillStatus.optional() });

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
		const location = (await this.locations.list()).find((l) => l.id === write.locationId);
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
		return { interState, ...expenseBillTotals(write.lines, interState) };
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
			return this.saved({ ...bill, status: 'cancelled', updatedAt: now.toISOString() }, bill.version, context);
		});
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
