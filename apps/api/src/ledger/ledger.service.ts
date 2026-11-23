import { randomUUID } from 'node:crypto';

import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Inject,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import {
	AccountGroup,
	type AccountGroupWrite,
	type AccountStatement,
	type AccountStatementQuery,
	type BookPart,
	type ChartOfAccounts,
	type DocumentLock,
	type JournalLine,
	JournalVoucher,
	type JournalVoucherWrite,
	Ledger,
	type LedgerWrite,
	type PeriodLock,
	type PeriodLockWrite,
	type VoucherKind,
	type VoucherReverse,
} from '@saha-textile/contracts';
import {
	type AdminUserRepository,
	type AdminUserRoleAssignmentRepository,
	type AuditLogRepository,
	type CompanyRepository,
	defaultChart,
	type DocumentLockRepository,
	fiscalYearOf,
	type GeneralLedgerRepository,
	istDay,
	ledgerStatement,
	type LocationRepository,
	type PeriodLockRepository,
	reversalLines,
	type RoleRepository,
	StaleRevisionError,
	SUPER_ADMIN_ROLE_KEY,
	type TransactionContext,
	type TransactionManagerPort,
	voucherProblems,
	voucherTotals,
} from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import {
	ADMIN_USER_REPOSITORY,
	ADMIN_USER_ROLE_ASSIGNMENT_REPOSITORY,
	AUDIT_LOG_REPOSITORY,
	COMPANY_REPOSITORY,
	DOCUMENT_LOCK_REPOSITORY,
	GENERAL_LEDGER_REPOSITORY,
	LOCATION_REPOSITORY,
	PERIOD_LOCK_REPOSITORY,
	ROLE_REPOSITORY,
	TRANSACTION_MANAGER,
} from '../infra/tokens';
import { LocationsService } from '../locations/locations.service';
import { DocumentNumbersService } from '../orders-setup/document-numbers.service';

/** A line a document posts: its ledger by system key or id; the GST registration comes from the location. */
export interface PostingLine {
	ledger: { systemKey: string } | { id: string };
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
		private readonly numbers: DocumentNumbersService,
		private readonly locations: LocationsService,
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

	/** First read: the chart for the kind of business on Settings › Company (proprietorship when not set yet). */
	private ensureChart(): Promise<void> {
		this.seeding ??= (async () => {
			const kind = (await this.company.getProfile())?.kind ?? 'proprietorship';
			const now = new Date().toISOString();
			const seed = defaultChart(kind);
			const groupId = (key: string) => `grp_${key}`;
			await this.books.seedChart({
				groups: seed.groups.map((group, index) =>
					AccountGroup.parse({
						id: groupId(group.systemKey),
						systemKey: group.systemKey,
						name: group.name,
						parentId: group.parentKey ? groupId(group.parentKey) : null,
						nature: group.nature,
						tradingAccount: group.tradingAccount ?? false,
						order: index,
						createdAt: now,
						updatedAt: now,
					}),
				),
				ledgers: seed.ledgers.map((ledger) =>
					Ledger.parse({
						id: `led_${ledger.systemKey}`,
						systemKey: ledger.systemKey,
						name: ledger.name,
						groupId: groupId(ledger.groupKey),
						nature: seed.groups.find((g) => g.systemKey === ledger.groupKey)?.nature ?? 'asset',
						handPosting: ledger.handPosting,
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

	async chart(): Promise<ChartOfAccounts> {
		await this.ensureChart();
		return this.books.chart();
	}

	async addGroup(write: AccountGroupWrite, by: string | null): Promise<AccountGroup> {
		const chart = await this.chart();
		const parent = chart.groups.find((group) => group.id === write.parentId);
		if (!parent) throw new BadRequestException('group_parent_unknown');
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
		if (!group) throw new BadRequestException('group_unknown');
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
		if (!group) throw new BadRequestException('group_unknown');
		if (current.systemKey && write.groupId !== current.groupId)
			throw new BadRequestException('system_ledger_group');
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
			if (error instanceof StaleRevisionError) throw new ConflictException('ledger_changed');
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
			attachmentIds?: string[];
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
		const [chart, locks, locationList] = await Promise.all([
			this.chart(),
			this.periods.list(),
			this.locationRepo.list(),
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
			},
		);
		if (problems.length) throw new BadRequestException(`voucher_problem:${problems[0]}`);
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
			attachmentIds: input.attachmentIds ?? [],
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
		return voucher;
	}

	/**
	 * A document's posting (tax invoices, receipts, purchases… as they arrive): in the document's own transaction,
	 * by system ledger keys. A second call with the same key returns the first voucher.
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
					'systemKey' in line.ledger
						? chart.ledgers.find((l) => l.systemKey === (line.ledger as { systemKey: string }).systemKey)
						: chart.ledgers.find((l) => l.id === (line.ledger as { id: string }).id);
				if (!ledger) throw new BadRequestException('voucher_problem:ledger_unknown');
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
			throw new ForbiddenException('location_out_of_scope');
		const lines = await this.stampLines(write.lines);
		const mayPostWhenClosed = !!principal?.permissions.includes('accounts.lock');
		return this.tx.withTransaction((context) =>
			this.insert({ ...write, lines }, { byHand: true, mayPostWhenClosed }, principal?.userId ?? null, context),
		);
	}

	/** A posted voucher is never edited: a reversal on a date undoes it (super admin only, brief tests). */
	async reverse(
		id: string,
		write: VoucherReverse,
		principal: AuthenticatedPrincipal | undefined,
	): Promise<JournalVoucher> {
		if (!(await this.isSuperAdmin(principal))) throw new ForbiddenException('reverse_super_admin_only');
		const original = await this.books.getVoucher(id);
		if (!original) throw new NotFoundException('voucher_not_found');
		if (original.reversedById) throw new BadRequestException('voucher_problem:already_reversed');
		if (write.date < original.date) throw new BadRequestException('voucher_problem:reverse_on_before_date');
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
				{ byHand: false, mayPostWhenClosed: !!principal?.permissions.includes('accounts.lock') },
				principal?.userId ?? null,
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

	async voucher(id: string): Promise<JournalVoucher> {
		const voucher = await this.books.getVoucher(id);
		if (!voucher) throw new NotFoundException('voucher_not_found');
		return voucher;
	}

	/** Q1: each ledger's balance on a day (debit positive), at the locations the person may see. */
	async balances(day: string, principal: AuthenticatedPrincipal | undefined): Promise<Record<string, number>> {
		const scope = await this.locations.scope(principal);
		return this.books.balancesAt(day, scope.all ? [] : [...scope.ids]);
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
			throw new ForbiddenException('location_out_of_scope');
		const locationIds = asked.length ? asked : scope.all ? [] : [...scope.ids];
		const [openingPaise, lines] = await Promise.all([
			this.books.balanceBefore(ledgerId, query.from, locationIds),
			this.books.statementLines(ledgerId, query.from, query.to, locationIds),
		]);
		return { ledger, from: query.from, to: query.to, openingPaise, ...ledgerStatement(openingPaise, lines) };
	}

	/** T1: every month of this financial year and the last, with each part's state. */
	async periodGrid(today = istDay(new Date())): Promise<{ months: string[]; locks: PeriodLock[] }> {
		const fy = fiscalYearOf(today);
		const start = Number(fy.slice(0, 4)) - 1;
		const months: string[] = [];
		for (let i = 0; i < 24; i += 1) {
			const month = ((3 + i) % 12) + 1;
			const year = start + Math.floor((3 + i) / 12);
			months.push(`${year}-${String(month).padStart(2, '0')}`);
		}
		return { months, locks: await this.periods.list() };
	}

	/** T2: close or lock chosen months and parts with a reason; reopening is logged the same way. */
	async lockPeriods(write: PeriodLockWrite, principal: AuthenticatedPrincipal | undefined): Promise<PeriodLock[]> {
		if (write.state === 'open' && !(await this.isSuperAdmin(principal)))
			throw new ForbiddenException('reopen_super_admin_only');
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

	/** D10: take the document, or learn who holds it. */
	async lockDocument(
		documentType: string,
		documentId: string,
		principal: AuthenticatedPrincipal | undefined,
	): Promise<DocumentLock> {
		if (!principal) throw new ForbiddenException('document_lock_refused');
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
			throw new ForbiddenException('take_over_super_admin_only');
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
				retentionTier: 'financial_security',
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
