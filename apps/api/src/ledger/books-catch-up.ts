import {
	BadRequestException,
	Controller,
	ForbiddenException,
	Get,
	Header,
	Inject,
	Injectable,
	Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	type BooksCatchUp,
	type BooksCatchUpResult,
	type CatchUpKind,
	OrderListQuery,
	type PaymentMethod,
} from '@saha-textile/contracts';
import {
	istDay,
	type AdminOrderRepository,
	type BusinessRepository,
	type LedgerRepository,
	type OrderPaymentRepository,
	type PurchaseEntryRepository,
	type PurchaseReturnRepository,
	type SupplierPaymentRepository,
	type TransactionContext,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import {
	ADMIN_ORDER_REPOSITORY,
	BUSINESS_REPOSITORY,
	LEDGER_REPOSITORY,
	ORDER_PAYMENT_REPOSITORY,
	PURCHASE_ENTRY_REPOSITORY,
	PURCHASE_RETURN_REPOSITORY,
	SUPPLIER_PAYMENT_REPOSITORY,
	TRANSACTION_MANAGER,
} from '../infra/tokens';
import { API_TAGS } from '../openapi-tags';
import { AccountsTemplatesService } from '../accounts-templates/accounts-templates.service';
import { accountsRefusal } from './accounts-refusal';
import { BooksPostingService, CAME_IN } from './books-posting';
import { LedgerService } from './ledger.service';

/** One document saved before the books took it: its voucher key, and how to post it on its own date. */
interface Waiting {
	kind: CatchUpKind;
	key: string;
	number: string | null;
	date: string;
	post: (context: TransactionContext, by: string | null) => Promise<unknown>;
}

/** Ways of paying that move money (on account and set off post nothing). */
const MOVES_MONEY: ReadonlySet<PaymentMethod> = new Set(['gateway', 'upi', 'bankTransfer', 'cashOnDelivery']);
/** A business receipt's way of paying leads its note ("bankTransfer · NEFT 1 · …"). */
const RECEIPT_METHODS = ['upi', 'bankTransfer', 'cash', 'cheque'] as const;
const PAGE = 100;

const none = (): BooksCatchUpResult['posted'] => ({
	receipts: 0,
	purchaseEntries: 0,
	supplierPayments: 0,
	purchaseReturns: 0,
	returnRefunds: 0,
	businessReceipts: 0,
});

/**
 * "Post them" (Postings and Convert brief AP3, AP-D3): receipts, purchase entries, supplier payments, debit notes,
 * their refunds and business receipts saved before the books took them, each posted on its own date, once (the
 * voucher key makes a second press post nothing new). A document the books can't take, such as one in a locked month,
 * is skipped and listed with why; nothing is unlocked. Super admin only.
 */
@Injectable()
export class BooksCatchUpService {
	constructor(
		private readonly ledger: LedgerService,
		private readonly books: BooksPostingService,
		@Inject(ADMIN_ORDER_REPOSITORY) private readonly orders: Pick<AdminOrderRepository, 'list'>,
		@Inject(ORDER_PAYMENT_REPOSITORY) private readonly payments: Pick<OrderPaymentRepository, 'listByOrder'>,
		@Inject(PURCHASE_ENTRY_REPOSITORY) private readonly entries: Pick<PurchaseEntryRepository, 'list'>,
		@Inject(SUPPLIER_PAYMENT_REPOSITORY)
		private readonly supplierPayments: Pick<SupplierPaymentRepository, 'forEntry'>,
		@Inject(PURCHASE_RETURN_REPOSITORY) private readonly returns: Pick<PurchaseReturnRepository, 'forEntry'>,
		@Inject(BUSINESS_REPOSITORY) private readonly businesses: Pick<BusinessRepository, 'list'>,
		@Inject(LEDGER_REPOSITORY) private readonly accounts: Pick<LedgerRepository, 'list'>,
		@Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManagerPort,
		private readonly templates: AccountsTemplatesService,
	) {}

	/** Every row of a paged list. */
	private async all<T>(page: (n: number) => Promise<{ items: T[]; total: number }>): Promise<T[]> {
		const rows: T[] = [];
		for (let n = 1; ; n += 1) {
			const { items, total } = await page(n);
			rows.push(...items);
			if (!items.length || rows.length >= total) return rows;
		}
	}

	private async receipts(): Promise<Waiting[]> {
		const orders = await this.all(async (page) => {
			const { orders, total } = await this.orders.list(OrderListQuery.parse({ page, pageSize: PAGE }));
			return { items: orders, total };
		});
		const waiting: Waiting[] = [];
		for (const order of orders)
			for (const payment of await this.payments.listByOrder(order.id))
				if (CAME_IN.has(payment.state) && MOVES_MONEY.has(payment.method))
					waiting.push({
						kind: 'receipts',
						key: `receipt:${payment.id}`,
						number: payment.receiptNumber ?? order.orderNumber,
						date: payment.receivedOn ?? istDay(payment.recordedAt),
						post: (context, by) =>
							this.books.paymentReceived(payment, order, context, by, { keepCustomerPayment: false }),
					});
		return waiting;
	}

	private async purchases(): Promise<Waiting[]> {
		const today = istDay(new Date());
		const entries = await this.all((page) => this.entries.list({ filter: 'all', page, pageSize: PAGE, today }));
		const waiting: Waiting[] = [];
		// A voided entry and its stock net to nothing; its payments were reversed before it could be voided.
		for (const entry of entries.filter((row) => row.status === 'posted')) {
			waiting.push({
				kind: 'purchaseEntries',
				key: `purchaseEntry:${entry.id}`,
				number: entry.number,
				date: istDay(entry.postedAt ?? entry.updatedAt),
				post: (context, by) => this.books.purchaseEntryPosted(entry, context, by),
			});
			for (const payment of await this.supplierPayments.forEntry(entry.id))
				if (!payment.reversedAt)
					waiting.push({
						kind: 'supplierPayments',
						key: `supplierPayment:${payment.id}`,
						number: entry.number,
						date: payment.paidOn,
						post: (context, by) => this.books.supplierPaid(payment, entry, context, by),
					});
			for (const doc of await this.returns.forEntry(entry.id)) {
				if (doc.status === 'draft') continue;
				waiting.push({
					kind: 'purchaseReturns',
					key: `purchaseReturn:${doc.id}`,
					number: doc.number,
					date: istDay(doc.sentAt ?? doc.updatedAt),
					post: (context, by) => this.books.purchaseReturnSent(doc, entry.itcClaimable, context, by),
				});
				for (const settlement of doc.settlements.filter((row) => row.how === 'refund'))
					waiting.push({
						kind: 'returnRefunds',
						key: `purchaseReturn:${doc.id}:refund:${settlement.id}`,
						number: doc.number,
						date: settlement.date,
						post: (context, by) => this.books.purchaseReturnSettled(doc, settlement, context, by),
					});
			}
		}
		return waiting;
	}

	private async businessReceipts(): Promise<Waiting[]> {
		const businesses = await this.all((page) => this.businesses.list({ role: 'all', page, pageSize: PAGE }));
		const waiting: Waiting[] = [];
		for (const business of businesses) {
			const rows = await this.all(async (page) => {
				const { rows, total } = await this.accounts.list(business.id, 'receivable', { page, pageSize: PAGE });
				return { items: rows, total };
			});
			for (const row of rows.filter((entry) => entry.kind === 'receipt')) {
				const method = RECEIPT_METHODS.find((name) => (row.note ?? '').split(' · ')[0] === name) ?? null;
				const receivedOn = istDay(row.at);
				waiting.push({
					kind: 'businessReceipts',
					key: `businessReceipt:${row.documentId}`,
					number: row.documentNumber,
					date: receivedOn,
					post: (context, by) => {
						if (!method) throw new Error('receipt_method_unknown');
						return this.books.businessReceipt(
							{ id: row.documentId, number: row.documentNumber, businessName: business.legalName },
							{ method, amountINR: -row.amountINR, receivedOn },
							context,
							by,
						);
					},
				});
			}
		}
		return waiting;
	}

	/** Every document with no voucher yet, oldest first. */
	private async waiting(): Promise<Waiting[]> {
		const found = [...(await this.receipts()), ...(await this.purchases()), ...(await this.businessReceipts())];
		const posted = await Promise.all(found.map((row) => this.ledger.voucherByKey(row.key)));
		return found.filter((_row, index) => !posted[index]).sort((a, b) => a.date.localeCompare(b.date));
	}

	private async superAdmin(principal: AuthenticatedPrincipal | undefined): Promise<void> {
		if (!(await this.ledger.isSuperAdmin(principal)))
			throw new ForbiddenException(accountsRefusal('catch_up_super_admin_only'));
		// Before the books are set up nothing posts; Post them runs once they are.
		if (!(await this.templates.booksSetUp())) throw new BadRequestException(accountsRefusal('books_not_set_up'));
	}

	async summary(principal: AuthenticatedPrincipal | undefined): Promise<BooksCatchUp> {
		await this.superAdmin(principal);
		const waiting = none();
		for (const row of await this.waiting()) waiting[row.kind] += 1;
		return { waiting };
	}

	async run(principal: AuthenticatedPrincipal | undefined): Promise<BooksCatchUpResult> {
		await this.superAdmin(principal);
		const by = principal?.userId ?? null;
		const result: BooksCatchUpResult = { posted: none(), skipped: [] };
		for (const row of await this.waiting()) {
			try {
				await this.tx.withTransaction((context) => row.post(context, by));
				result.posted[row.kind] += 1;
			} catch (error) {
				result.skipped.push({
					kind: row.kind,
					number: row.number,
					date: row.date,
					reason: (error as Error).message,
				});
			}
		}
		return result;
	}
}

@ApiTags(API_TAGS.stock)
@Audience('admin')
@Controller('admin/accounts/catch-up')
export class BooksCatchUpController {
	constructor(private readonly catchUp: BooksCatchUpService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.lock')
	@ApiOperation({ operationId: 'booksCatchUp', summary: 'Documents saved before the books took them' })
	summary(@Principal() principal?: AuthenticatedPrincipal) {
		return this.catchUp.summary(principal);
	}

	@Post()
	@RequirePermissions('accounts.lock')
	@ApiOperation({ operationId: 'runBooksCatchUp', summary: 'Post them, each on its own date, once' })
	run(@Principal() principal?: AuthenticatedPrincipal) {
		return this.catchUp.run(principal);
	}
}
