import { randomUUID } from 'node:crypto';

import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Inject,
	Injectable,
	NotFoundException,
	Optional,
} from '@nestjs/common';
import {
	AccountGroup,
	type AccountGroupWrite,
	type AccountStatement,
	type AccountStatementQuery,
	type BookPart,
	type ChartOfAccounts,
	type DocumentLock,
	GST_RETURN_LOCKS,
	GstReturnFiling,
	type GstReturnFilingWrite,
	type JournalLine,
	JournalVoucher,
	type JournalVoucherWrite,
	Ledger,
	type LedgerWrite,
	type PeriodLock,
	type PeriodCheck,
	type PeriodLockWrite,
	type VoucherAttachment,
	type VoucherDetail,
	VoucherDraft,
	type VoucherDraftWrite,
	type VoucherKind,
	type VoucherReverse,
} from '@saha-textile/contracts';
import {
	type AdjustmentRequestRepository,
	type AdminUserRepository,
	type AdminUserRoleAssignmentRepository,
	type AuditLogRepository,
	type CashRepository,
	type TransferRepository,
	type CompanyRepository,
	type DocumentLockRepository,
	fiscalYearOf,
	type GeneralLedgerRepository,
	type GstReturnRepository,
	istDay,
	ledgerStatement,
	type LocationRepository,
	type MediaAssetRepository,
	type PeriodLockRepository,
	reversalLines,
	type RoleRepository,
	StaleRevisionError,
	type StockCountRepository,
	type StoragePort,
	SUPER_ADMIN_ROLE_KEY,
	type TransactionContext,
	type TransactionManagerPort,
	voucherProblems,
	voucherTotals,
	resolveRole,
} from '@saha-textile/core-domain';

import { accountsRefusal } from './accounts-refusal';
import { addChartItems } from './chart-additions';
import { AccountsTemplatesService } from '../accounts-templates/accounts-templates.service';
import type { AuthenticatedPrincipal } from '../auth/session.guard';
import {
	ADJUSTMENT_REQUEST_REPOSITORY,
	ADMIN_USER_REPOSITORY,
	ADMIN_USER_ROLE_ASSIGNMENT_REPOSITORY,
	AUDIT_LOG_REPOSITORY,
	CASH_REPOSITORY,
	TRANSFER_REPOSITORY,
	COMPANY_REPOSITORY,
	DOCUMENT_LOCK_REPOSITORY,
	GENERAL_LEDGER_REPOSITORY,
	GST_RETURN_REPOSITORY,
	LOCATION_REPOSITORY,
	MEDIA_ASSET_REPOSITORY,
	PERIOD_LOCK_REPOSITORY,
	ROLE_REPOSITORY,
	STOCK_COUNT_REPOSITORY,
	STORAGE_PORT,
	TRANSACTION_MANAGER,
} from '../infra/tokens';
import { LocationsService } from '../locations/locations.service';
import { DocumentNumbersService } from '../orders-setup/document-numbers.service';

/** A line a document posts: its ledger by system key or id; the GST registration comes from the location. */
export interface PostingLine {
	/** A role the company's books map to a ledger (accounts templates T1), or a ledger by id. */
	ledger: { role: string } | { id: string };
	locationId: string;
	debitPaise?: number;
	creditPaise?: number;
	narration?: string;
}

export interface PostingRequest {
	kind?: VoucherKind;
	date: string;
	narration: string;
	lines: readonly PostingLine[];
	source: { type: string; id: string; number?: string | null };
	idempotencyKey: string;
}

/** A page that stops reporting in for this long lets its lock go (D10: report-ins every 20 seconds). */
const LOCK_IDLE_MS = 2 * 60_000;

/**
 * The general ledger (accounts brief Q, T, D10; owner-approved 2026-11-23). Every voucher is checked by the core
 * rules, numbered from the journal series and written with its lines in one transaction; the same idempotency
 * key returns the first voucher. Each line carries its location and that location's GST registration.
 */
@Injectable()
export class LedgerService {
	private seeding: Promise<void> | null = null;
	/** Others told of every voucher, in its own transaction (cash sheets write their lines, accounts brief O3). */
	private readonly listeners: ((voucher: JournalVoucher, context: TransactionContext) => Promise<void>)[] = [];

	constructor(
		@Inject(GENERAL_LEDGER_REPOSITORY) private readonly books: GeneralLedgerRepository,
		@Inject(PERIOD_LOCK_REPOSITORY) private readonly periods: PeriodLockRepository,
		@Inject(DOCUMENT_LOCK_REPOSITORY) private readonly documentLocks: DocumentLockRepository,
		@Inject(COMPANY_REPOSITORY) private readonly company: CompanyRepository,
		@Inject(LOCATION_REPOSITORY) private readonly locationRepo: LocationRepository,
		@Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManagerPort,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
		@Inject(ROLE_REPOSITORY) private readonly roles: Pick<RoleRepository, 'findByKey'>,
		@Inject(ADMIN_USER_ROLE_ASSIGNMENT_REPOSITORY)
		private readonly assignments: Pick<AdminUserRoleAssignmentRepository, 'findActive'>,
		@Inject(ADMIN_USER_REPOSITORY) private readonly admins: Pick<AdminUserRepository, 'findById'>,
		@Inject(MEDIA_ASSET_REPOSITORY) private readonly media: Pick<MediaAssetRepository, 'findManyByIds'>,
		@Inject(STORAGE_PORT) private readonly storage: Pick<StoragePort, 'getUrl'>,
		@Inject(STOCK_COUNT_REPOSITORY) private readonly counts: Pick<StockCountRepository, 'list'>,
		@Inject(ADJUSTMENT_REQUEST_REPOSITORY)
		private readonly approvals: Pick<AdjustmentRequestRepository, 'pendingCount'>,
		@Inject(GST_RETURN_REPOSITORY) private readonly gstReturns: GstReturnRepository,
		private readonly numbers: DocumentNumbersService,
		private readonly locations: LocationsService,
		private readonly templates: AccountsTemplatesService,
		/** Cash sheets a month lock waits for (T2, accounts brief O); last so older callers keep working. */
		@Optional() @Inject(CASH_REPOSITORY) private readonly cash: Pick<CashRepository, 'unfinishedIn'> | null = null,
		/** Transfers still on the way a month lock waits for (T2, accounts brief N). */
		@Optional()
		@Inject(TRANSFER_REPOSITORY)
		private readonly transfers: Pick<TransferRepository, 'inTransitFrom'> | null = null,
	) {}

	/** The name others see on a lock: display name, else e-mail, else username. */
	private async nameOf(userId: string): Promise<string> {
		const user = await this.admins.findById(userId).catch(() => null);
		return user?.displayName || user?.email || user?.username || userId;
	}

	/** A super admin holds the active Administrator role (never the coarse session role). */
	async isSuperAdmin(principal: AuthenticatedPrincipal | undefined): Promise<boolean> {
		if (!principal) return false;
		const role = await this.roles.findByKey(SUPER_ADMIN_ROLE_KEY);
		return !!role && !!(await this.assignments.findActive(principal.userId, role.id));
	}

	/**
	 * First read: the chart is seeded from the accounts templates the company's kind unlocks (the shared chart and its
	 * own, accounts templates T2), so documents can post. The books count as set up only once a person sets them up
	 * (AT1, T3): a chart read on a fresh database never chooses the kind for the company.
	 */
	private ensureChart(): Promise<void> {
		this.seeding ??= (async () => {
			const { chart } = await this.templates.startingChart();
			const now = new Date().toISOString();
			const groupId = (key: string) => `grp_${key}`;
			// mergeCharts has checked every ledger's group is in the chart; a broken one fails Ledger.parse loudly.
			const natureOf = new Map(chart.groups.map((group) => [group.key, group.nature]));
			await this.books.seedChart({
				groups: chart.groups.map((group, index) =>
					AccountGroup.parse({
						id: groupId(group.key),
						systemKey: group.key,
						name: group.name,
						parentId: group.parentKey ? groupId(group.parentKey) : null,
						nature: group.nature,
						tradingAccount: group.tradingAccount,
						roles: group.roles,
						order: index,
						createdAt: now,
						updatedAt: now,
					}),
				),
				ledgers: chart.ledgers.map((ledger) =>
					Ledger.parse({
						id: `led_${ledger.key}`,
						systemKey: ledger.key,
						name: ledger.name,
						groupId: groupId(ledger.groupKey),
						nature: natureOf.get(ledger.groupKey),
						handPosting: ledger.handPosting,
						roles: ledger.roles,
						createdAt: now,
						updatedAt: now,
					}),
				),
			});
		})().catch((error: unknown) => {
			this.seeding = null;
			throw error;
		});
		return this.seeding;
	}

	/** AT1 "Save and set up the books": installed from the templates the kind unlocks, once (then only Convert). */
	async setUpBooks(by: string | null) {
		if (await this.templates.booksSetUp()) throw new ConflictException(accountsRefusal('books_already_set_up'));
		await this.ensureChart();
		// A chart read before the kind was chosen was seeded from another kind's templates: add what this kind's lack.
		const [{ chart }, books] = await Promise.all([this.templates.startingChart(), this.books.chart()]);
		await addChartItems(this.books, { kind: 'chart', ...chart }, books, new Date().toISOString());
		await this.templates.installUnlocked(by);
		return this.templates.library();
	}

	async chart(): Promise<ChartOfAccounts> {
		await this.ensureChart();
		return this.books.chart();
	}

	async addGroup(write: AccountGroupWrite, by: string | null): Promise<AccountGroup> {
		const chart = await this.chart();
		const parent = chart.groups.find((group) => group.id === write.parentId);
		if (!parent) throw new BadRequestException(accountsRefusal('group_parent_unknown'));
		const now = new Date().toISOString();
		const group = AccountGroup.parse({
			id: `grp_${randomUUID()}`,
			name: write.name,
			parentId: parent.id,
			nature: parent.nature,
			tradingAccount: parent.tradingAccount,
			order: chart.groups.length,
			createdAt: now,
			updatedAt: now,
		});
		await this.books.saveGroup(group);
		await this.log(by, 'accounts.group.create', 'accountGroup', group.id, [{ field: 'name', after: group.name }]);
		return group;
	}

	async addLedger(write: LedgerWrite, by: string | null): Promise<Ledger> {
		const chart = await this.chart();
		const group = chart.groups.find((g) => g.id === write.groupId);
		if (!group) throw new BadRequestException(accountsRefusal('group_unknown'));
		const now = new Date().toISOString();
		const ledger = Ledger.parse({
			id: `led_${randomUUID()}`,
			name: write.name,
			groupId: group.id,
			nature: group.nature,
			active: write.active,
			createdAt: now,
			updatedAt: now,
			updatedBy: by,
		});
		await this.books.saveLedger(ledger, null);
		await this.log(by, 'accounts.ledger.create', 'ledger', ledger.id, [{ field: 'name', after: ledger.name }]);
		return ledger;
	}

	/** Rename, move or switch off a ledger; a system ledger keeps its group, and a used one is never removed. */
	async saveLedger(id: string, write: LedgerWrite, by: string | null): Promise<Ledger> {
		const chart = await this.chart();
		const current = chart.ledgers.find((l) => l.id === id);
		if (!current) throw new NotFoundException('ledger_not_found');
		const group = chart.groups.find((g) => g.id === write.groupId);
		if (!group) throw new BadRequestException(accountsRefusal('group_unknown'));
		if (current.systemKey && write.groupId !== current.groupId)
			throw new BadRequestException(accountsRefusal('system_ledger_group'));
		const next = Ledger.parse({
			...current,
			name: write.name,
			groupId: group.id,
			nature: group.nature,
			active: write.active,
			updatedAt: new Date().toISOString(),
			updatedBy: by,
		});
		try {
			await this.books.saveLedger(next, write.expectedUpdatedAt ?? current.updatedAt);
		} catch (error) {
			if (error instanceof StaleRevisionError) throw new ConflictException(accountsRefusal('ledger_changed'));
			throw error;
		}
		const diffs = (['name', 'groupId', 'active'] as const)
			.filter((field) => current[field] !== next[field])
			.map((field) => ({ field, before: current[field], after: next[field] }));
		await this.log(by, 'accounts.ledger.update', 'ledger', id, diffs);
		return next;
	}

	/** Stamps each line with its location's GST registration (never typed). */
	private async stampLines(
		lines: readonly {
			ledgerId: string;
			locationId: string;
			debitPaise: number;
			creditPaise: number;
			narration: string;
		}[],
	): Promise<JournalLine[]> {
		const known = new Map((await this.locationRepo.list()).map((l) => [l.id, l]));
		return lines.map((line) => ({
			...line,
			gstRegistrationId: known.get(line.locationId)?.gstRegistrationId ?? null,
		}));
	}

	private async insert(
		input: {
			kind: VoucherKind;
			date: string;
			narration: string;
			lines: JournalLine[];
			reverseOn?: string | null;
			attachments?: VoucherAttachment[];
			source?: { type: string; id: string; number?: string | null } | null;
			reversalOfId?: string | null;
			idempotencyKey: string;
		},
		check: { byHand: boolean; mayPostWhenClosed: boolean },
		by: string | null,
		context: TransactionContext,
	): Promise<JournalVoucher> {
		const existing = await this.books.findVoucherByKey(input.idempotencyKey, context);
		if (existing) return existing;
		const [chart, locks, locationList, filings] = await Promise.all([
			this.chart(),
			this.periods.list(),
			this.locationRepo.list(),
			this.gstReturns.list(),
		]);
		const problems = voucherProblems(
			{
				kind: input.kind,
				date: input.date,
				reverseOn: input.reverseOn ?? null,
				lines: input.lines,
				reversal: !!input.reversalOfId,
			},
			{
				ledgers: new Map(chart.ledgers.map((l) => [l.id, l])),
				groups: chart.groups,
				locationIds: new Set(locationList.filter((l) => l.active).map((l) => l.id)),
				locks,
				byHand: check.byHand,
				mayPostWhenClosed: check.mayPostWhenClosed,
				sourceType: input.source?.type,
				filedGst: filings.map((f) => ({
					gstRegistrationId: f.gstRegistrationId,
					month: f.month,
					parts: GST_RETURN_LOCKS[f.returnType],
				})),
			},
		);
		if (problems.length) throw new BadRequestException(accountsRefusal(`voucher_problem:${problems[0]}`));
		const voucher = JournalVoucher.parse({
			id: `jv_${randomUUID()}`,
			number: await this.numbers.issue('journal', context, new Date(`${input.date}T06:30:00.000Z`)),
			kind: input.kind,
			date: input.date,
			narration: input.narration,
			lines: input.lines,
			source: input.source ? { number: null, ...input.source } : null,
			reversalOfId: input.reversalOfId ?? null,
			reverseOn: input.reverseOn ?? null,
			idempotencyKey: input.idempotencyKey,
			attachments: input.attachments ?? [],
			totalPaise: voucherTotals(input.lines).debitPaise,
			createdBy: by,
			createdAt: new Date().toISOString(),
		});
		await this.books.insertVoucher(voucher, context);
		await this.log(
			by,
			input.reversalOfId ? 'accounts.voucher.reverse' : 'accounts.voucher.post',
			'journalVoucher',
			voucher.id,
			[],
			{ number: voucher.number, kind: voucher.kind, totalPaise: voucher.totalPaise },
			context,
		);
		for (const listener of this.listeners) await listener(voucher, context);
		return voucher;
	}

	/** Hears of every voucher posted, inside its transaction: a listener that fails undoes the voucher. */
	onPosted(listener: (voucher: JournalVoucher, context: TransactionContext) => Promise<void>): void {
		this.listeners.push(listener);
	}

	/** The ledger playing a role; a role with no ledger, or several, refuses the posting. */
	private byRole(ledgers: readonly Ledger[], role: string): Ledger {
		try {
			return resolveRole(ledgers, role);
		} catch (error) {
			throw new BadRequestException(accountsRefusal(`voucher_problem:${(error as Error).message}`));
		}
	}

	/** A document's voucher by its idempotency key; null when it never posted (saved before the books took it). */
	voucherByKey(idempotencyKey: string, context?: TransactionContext): Promise<JournalVoucher | null> {
		return this.books.findVoucherByKey(idempotencyKey, context);
	}

	/**
	 * A document's posting (tax invoices, credit notes, refund vouchers…): in the document's own transaction, to the
	 * ledgers playing its roles (or a ledger by id). A second call with the same key returns the first voucher.
	 */
	async post(
		request: PostingRequest,
		context: TransactionContext,
		by: string | null = null,
	): Promise<JournalVoucher> {
		const chart = await this.chart();
		const lines = await this.stampLines(
			request.lines.map((line) => {
				const ledger =
					'role' in line.ledger
						? this.byRole(chart.ledgers, line.ledger.role)
						: chart.ledgers.find((l) => l.id === (line.ledger as { id: string }).id);
				if (!ledger) throw new BadRequestException(accountsRefusal('voucher_problem:ledger_unknown'));
				return {
					ledgerId: ledger.id,
					locationId: line.locationId,
					debitPaise: line.debitPaise ?? 0,
					creditPaise: line.creditPaise ?? 0,
					narration: line.narration ?? '',
				};
			}),
		);
		return this.insert(
			{ ...request, kind: request.kind ?? 'document', lines },
			{ byHand: false, mayPostWhenClosed: false },
			by,
			context,
		);
	}

	/** Q3, Q4: a voucher typed by hand, only at locations the person may see. */
	async postByHand(
		write: JournalVoucherWrite,
		principal: AuthenticatedPrincipal | undefined,
	): Promise<JournalVoucher> {
		const scope = await this.locations.scope(principal);
		if (write.lines.some((line) => !scope.all && !scope.ids.includes(line.locationId)))
			throw new ForbiddenException(accountsRefusal('location_out_of_scope'));
		const lines = await this.stampLines(write.lines);
		const mayPostWhenClosed = !!principal?.permissions.includes('accounts.lock');
		const { draftId, ...voucher } = write;
		return this.tx.withTransaction(async (context) => {
			const posted = await this.insert(
				{ ...voucher, lines },
				{ byHand: true, mayPostWhenClosed },
				principal?.userId ?? null,
				context,
			);
			// Posted from a draft: the draft goes with it, so it can never be posted twice.
			if (draftId) await this.books.deleteDraft(draftId, context);
			return posted;
		});
	}

	/** Q3 Save draft: kept with no number; anyone who may post can open and finish it. */
	drafts(): Promise<VoucherDraft[]> {
		return this.books.listDrafts();
	}

	async draft(id: string): Promise<VoucherDraft> {
		const draft = await this.books.getDraft(id);
		if (!draft) throw new NotFoundException('draft_not_found');
		return draft;
	}

	async saveDraft(
		id: string | null,
		write: VoucherDraftWrite,
		principal: AuthenticatedPrincipal | undefined,
	): Promise<VoucherDraft> {
		const now = new Date().toISOString();
		const current = id ? await this.books.getDraft(id) : null;
		if (id && !current) throw new NotFoundException('draft_not_found');
		const { expectedUpdatedAt, ...rest } = write;
		const draft = VoucherDraft.parse({
			...rest,
			id: current?.id ?? `vd_${randomUUID()}`,
			createdBy: current?.createdBy ?? principal?.userId ?? null,
			createdByName: current?.createdByName ?? (principal ? await this.nameOf(principal.userId) : ''),
			createdAt: current?.createdAt ?? now,
			updatedAt: now,
			updatedBy: principal?.userId ?? null,
		});
		try {
			await this.books.saveDraft(draft, current ? (expectedUpdatedAt ?? current.updatedAt) : null);
		} catch (error) {
			if (error instanceof StaleRevisionError) throw new ConflictException(accountsRefusal('draft_changed'));
			throw error;
		}
		return draft;
	}

	async deleteDraft(id: string, principal: AuthenticatedPrincipal | undefined): Promise<void> {
		await this.draft(id);
		await this.books.deleteDraft(id);
		await this.log(principal?.userId ?? null, 'accounts.draft.delete', 'voucherDraft', id, []);
	}

	/** A posted voucher is never edited: a reversal on a date undoes it (super admin only, brief tests). */
	async reverse(
		id: string,
		write: VoucherReverse,
		principal: AuthenticatedPrincipal | undefined,
	): Promise<JournalVoucher> {
		if (!principal || !(await this.isSuperAdmin(principal)))
			throw new ForbiddenException(accountsRefusal('reverse_super_admin_only'));
		const original = await this.books.getVoucher(id);
		if (!original) throw new NotFoundException('voucher_not_found');
		if (original.reversedById) throw new BadRequestException(accountsRefusal('voucher_problem:already_reversed'));
		if (write.date < original.date)
			throw new BadRequestException(accountsRefusal('voucher_problem:reverse_on_before_date'));
		return this.tx.withTransaction(async (context) => {
			const reversal = await this.insert(
				{
					kind: original.kind,
					date: write.date,
					narration: `Reversal of ${original.number}: ${write.reason}`,
					lines: reversalLines(original),
					source: original.source,
					reversalOfId: original.id,
					idempotencyKey: write.idempotencyKey,
				},
				{ byHand: false, mayPostWhenClosed: principal.permissions.includes('accounts.lock') },
				principal.userId,
				context,
			);
			await this.books.markReversed(original.id, reversal.id, context);
			return reversal;
		});
	}

	/** Q3 reversal dates: undo every voucher due by today (run by the daily job and on demand). */
	async runDueReversals(today = istDay(new Date())): Promise<number> {
		let done = 0;
		for (const voucher of await this.books.dueReversals(today)) {
			await this.tx.withTransaction(async (context) => {
				const reversal = await this.insert(
					{
						kind: voucher.kind,
						date: voucher.reverseOn ?? today,
						narration: `Automatic reversal of ${voucher.number}`,
						lines: reversalLines(voucher),
						source: voucher.source,
						reversalOfId: voucher.id,
						idempotencyKey: `auto-reverse:${voucher.id}`,
					},
					{ byHand: false, mayPostWhenClosed: true },
					null,
					context,
				);
				await this.books.markReversed(voucher.id, reversal.id, context);
			});
			done += 1;
		}
		return done;
	}

	async vouchers(query: {
		from: string;
		to: string;
		kinds: VoucherKind[];
		search: string;
		page: number;
		pageSize: number;
	}) {
		const result = await this.books.listVouchers(query);
		return { ...result, page: query.page, pageSize: query.pageSize };
	}

	async voucher(id: string): Promise<VoucherDetail> {
		const voucher = await this.books.getVoucher(id);
		if (!voucher) throw new NotFoundException('voucher_not_found');
		const assets = voucher.attachments.length
			? await this.media.findManyByIds(voucher.attachments.map((a) => a.assetId))
			: [];
		return {
			...voucher,
			attachmentLinks: voucher.attachments.map((attachment) => {
				const asset = assets.find((a) => a.id === attachment.assetId);
				return {
					...attachment,
					url: asset?.originalStorageKey ? this.storage.getUrl(asset.originalStorageKey) : null,
				};
			}),
		};
	}

	/** Q1: each ledger's balance on a day (debit positive), at the locations the person may see. */
	async balances(day: string, principal: AuthenticatedPrincipal | undefined): Promise<Record<string, number>> {
		const scope = await this.locations.scope(principal);
		return this.books.balancesAt(day, scope.all ? [] : [...scope.ids]);
	}

	/**
	 * Balances on a day at chosen locations (reports by location, R1), never beyond the ones the person may see; an
	 * empty choice means every location they may see, and a choice of none they may see gives no balances.
	 */
	async balancesAtLocations(
		day: string,
		principal: AuthenticatedPrincipal | undefined,
		only: readonly string[],
	): Promise<Record<string, number>> {
		if (!only.length) return this.balances(day, principal);
		const scope = await this.locations.scope(principal);
		const ids = only.filter((id) => scope.all || scope.ids.includes(id));
		return ids.length ? this.books.balancesAt(day, ids) : {};
	}

	/** Q2: opening, every entry with a running balance, closing; staff see only their locations. */
	async statement(
		ledgerId: string,
		query: AccountStatementQuery,
		principal: AuthenticatedPrincipal | undefined,
	): Promise<AccountStatement> {
		const ledger = (await this.chart()).ledgers.find((l) => l.id === ledgerId);
		if (!ledger) throw new NotFoundException('ledger_not_found');
		const scope = await this.locations.scope(principal);
		const asked = query.locationIds;
		if (!scope.all && asked.some((id) => !scope.ids.includes(id)))
			throw new ForbiddenException(accountsRefusal('location_out_of_scope'));
		const locationIds = asked.length ? asked : scope.all ? [] : [...scope.ids];
		const [openingPaise, lines] = await Promise.all([
			this.books.balanceBefore(ledgerId, query.from, locationIds),
			this.books.statementLines(ledgerId, query.from, query.to, locationIds),
		]);
		return { ledger, from: query.from, to: query.to, openingPaise, ...ledgerStatement(openingPaise, lines) };
	}

	/** T1: every month of this financial year and the last, with each part's state. */
	async periodGrid(
		today = istDay(new Date()),
	): Promise<{ months: string[]; locks: PeriodLock[]; filings: GstReturnFiling[] }> {
		const fy = fiscalYearOf(today);
		const start = Number(fy.slice(0, 4)) - 1;
		const months: string[] = [];
		for (let i = 0; i < 24; i += 1) {
			const month = ((3 + i) % 12) + 1;
			const year = start + Math.floor((3 + i) / 12);
			months.push(`${year}-${String(month).padStart(2, '0')}`);
		}
		const [locks, filings] = await Promise.all([this.periods.list(), this.gstReturns.list()]);
		return { months, locks, filings };
	}

	/**
	 * T2's checks before locking a month (as drawn). Depreciation and payroll answer `not_in_use` until those features
	 * exist (A1, P1); the rest are checked now: cash sheets of the month still open or waiting for a manager, transfers
	 * that left in the month and are still on the way, drafts dated in the month, reversals due in it, stock counts
	 * still open, and stock changes waiting for approval.
	 */
	async periodChecks(month: string): Promise<PeriodCheck[]> {
		const [drafts, due, counts, approvals, sheets, moving] = await Promise.all([
			this.books.listDrafts(),
			this.books.dueReversals(`${month}-31`),
			this.counts.list({ filter: 'all', page: 1, pageSize: 1 }),
			this.approvals.pendingCount(),
			this.cash?.unfinishedIn(month) ?? null,
			this.transfers?.inTransitFrom(month) ?? null,
		]);
		const attention = (key: PeriodCheck['key'], count: number): PeriodCheck => ({
			key,
			state: count ? 'attention' : 'ok',
			count,
		});
		return [
			sheets ? attention('cash_sheets', sheets.length) : { key: 'cash_sheets', state: 'not_in_use', count: 0 },
			moving ? attention('transfers', moving.length) : { key: 'transfers', state: 'not_in_use', count: 0 },
			{ key: 'depreciation', state: 'not_in_use', count: 0 },
			{ key: 'payroll', state: 'not_in_use', count: 0 },
			attention('drafts', drafts.filter((d) => d.date.startsWith(month)).length),
			attention('reversals', due.filter((v) => v.reverseOn?.startsWith(month)).length),
			attention('stock_counts', (counts.counts['counting'] ?? 0) + (counts.counts['review'] ?? 0)),
			attention('stock_approvals', approvals),
		];
	}

	/** T2: close or lock chosen months and parts with a reason; reopening is logged the same way. */
	async lockPeriods(write: PeriodLockWrite, principal: AuthenticatedPrincipal | undefined): Promise<PeriodLock[]> {
		if (write.state === 'open' && !(await this.isSuperAdmin(principal)))
			throw new ForbiddenException(accountsRefusal('reopen_super_admin_only'));
		const now = new Date().toISOString();
		const before = await this.periods.list();
		const next: PeriodLock[] = write.months.flatMap((month) =>
			write.parts.map((part: BookPart) => ({
				month,
				part,
				state: write.state,
				reason: write.reason,
				by: principal?.userId ?? null,
				at: now,
			})),
		);
		await this.periods.save(next);
		await this.log(
			principal?.userId ?? null,
			'accounts.period.lock',
			'periodLock',
			null,
			next.map((lock) => ({
				field: `${lock.month}:${lock.part}`,
				before: before.find((b) => b.month === lock.month && b.part === lock.part)?.state ?? 'open',
				after: lock.state,
			})),
			{ reason: write.reason },
		);
		return next;
	}

	/**
	 * G8 Mark filed: a return filed on the GST portal, entered with its ARN. From then on that month locks for that
	 * GSTIN in the parts the return covers (GSTR-1: sales; GSTR-3B: sales and purchases). Logged with the ARN.
	 */
	async markFiled(
		write: GstReturnFilingWrite,
		principal: AuthenticatedPrincipal | undefined,
	): Promise<GstReturnFiling> {
		const registration = await this.company.getRegistration(write.gstRegistrationId);
		if (!registration) throw new BadRequestException(accountsRefusal('gst_registration_unknown'));
		const filing = GstReturnFiling.parse({
			...write,
			gstin: registration.gstin,
			by: principal?.userId ?? null,
			at: new Date().toISOString(),
		});
		try {
			await this.gstReturns.insert(filing);
		} catch (error) {
			if (error instanceof Error && error.message === 'duplicate_gst_filing')
				throw new ConflictException(accountsRefusal('gst_already_filed'));
			throw error;
		}
		await this.log(principal?.userId ?? null, 'accounts.gst.filed', 'gstReturn', null, [], {
			gstin: filing.gstin,
			returnType: filing.returnType,
			month: filing.month,
			arn: filing.arn,
		});
		return filing;
	}

	/** D10: take the document, or learn who holds it. */
	async lockDocument(
		documentType: string,
		documentId: string,
		principal: AuthenticatedPrincipal | undefined,
	): Promise<DocumentLock> {
		if (!principal) throw new ForbiddenException(accountsRefusal('document_lock_refused'));
		const holderName = await this.nameOf(principal.userId);
		const now = new Date();
		return this.documentLocks.acquire(
			{
				documentType,
				documentId,
				holderId: principal.userId,
				holderName,
				since: now.toISOString(),
				lastActiveAt: now.toISOString(),
			},
			new Date(now.getTime() - LOCK_IDLE_MS).toISOString(),
		);
	}

	async touchDocument(documentType: string, documentId: string, principal: AuthenticatedPrincipal | undefined) {
		if (!principal) return { held: false };
		return {
			held: await this.documentLocks.touch(documentType, documentId, principal.userId, new Date().toISOString()),
		};
	}

	async releaseDocument(documentType: string, documentId: string, principal: AuthenticatedPrincipal | undefined) {
		if (principal) await this.documentLocks.release(documentType, documentId, principal.userId);
	}

	/** A super admin takes a document over from someone who left it open (logged with both names). */
	async takeOverDocument(
		documentType: string,
		documentId: string,
		principal: AuthenticatedPrincipal | undefined,
	): Promise<DocumentLock> {
		if (!principal || !(await this.isSuperAdmin(principal)))
			throw new ForbiddenException(accountsRefusal('take_over_super_admin_only'));
		const holderName = await this.nameOf(principal.userId);
		const before = await this.documentLocks.get(documentType, documentId);
		const now = new Date().toISOString();
		const lock = await this.documentLocks.takeOver({
			documentType,
			documentId,
			holderId: principal.userId,
			holderName,
			since: now,
			lastActiveAt: now,
		});
		await this.log(principal.userId, 'document.lock.take_over', documentType, documentId, [
			{ field: 'holder', before: before?.holderName ?? null, after: holderName },
		]);
		return lock;
	}

	private async log(
		actor: string | null,
		action: string,
		entityType: string,
		entityId: string | null,
		diffs: { field: string; before?: unknown; after?: unknown }[],
		metadata: Record<string, unknown> = {},
		context?: TransactionContext,
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
