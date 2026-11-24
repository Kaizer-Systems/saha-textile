import { randomUUID } from 'node:crypto';

import { BadRequestException, Body, Controller, Get, Header, Inject, Injectable, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BOOK_PARTS, FinancialYear, YearCloseConfirm, type YearCloseView } from '@saha-textile/contracts';
import {
	closingLines,
	closingStale,
	yearSpan,
	resolveRole,
	rolesOf,
	termsOn,
	yearCloseChecks,
	yearCloseDone,
	yearCloseReady,
	type BankRepository,
	type BankStatementRepository,
	type CashRepository,
	type ClosingLine,
	type CompanyRepository,
	type FixedAssetRepository,
	type GeneralLedgerRepository,
	type GstReturnRepository,
	type LocationRepository,
	type PayrollRunRepository,
	type StockCountRepository,
	type TransactionManagerPort,
	type TransferRepository,
	type YearCloseRecord,
	type YearCloseRepository,
} from '@saha-textile/core-domain';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
	BANK_REPOSITORY,
	BANK_STATEMENT_REPOSITORY,
	CASH_REPOSITORY,
	COMPANY_REPOSITORY,
	FIXED_ASSET_REPOSITORY,
	GENERAL_LEDGER_REPOSITORY,
	GST_RETURN_REPOSITORY,
	LOCATION_REPOSITORY,
	PAYROLL_RUN_REPOSITORY,
	STOCK_COUNT_REPOSITORY,
	TRANSACTION_MANAGER,
	TRANSFER_REPOSITORY,
	YEAR_CLOSE_REPOSITORY,
} from '../infra/tokens';
import { API_TAGS } from '../openapi-tags';
import { accountsRefusal } from './accounts-refusal';
import { LedgerService } from './ledger.service';

const refuse = (code: string) => new BadRequestException(accountsRefusal(code));
const dayAfter = (day: string, days: number) =>
	new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const QUARTER_ENDS = new Set(['03', '06', '09', '12']);
/** Clearing ledgers that should be empty at the year's end, besides everything under Suspense. */
const CLEARING_ROLES = ['gateway_clearing', 'upi_card_clearing', 'cod_receivable'] as const;

/**
 * Closing a financial year (accounts brief T3). Ten checks across the books; then the closing entries (every income
 * and expense ledger to nothing, the year's profit to the Profit and loss account, which sits under Reserves and
 * surplus for a company and under Capital otherwise); then the whole year locked for everyone. The accountant
 * prepares; the owner or the CA (lock the books permission) closes. Next year opens with every balance carried: the
 * books are continuous, so nothing is copied.
 */
@Injectable()
export class YearCloseService {
	constructor(
		@Inject(YEAR_CLOSE_REPOSITORY) private readonly store: YearCloseRepository,
		@Inject(GENERAL_LEDGER_REPOSITORY)
		private readonly books: Pick<GeneralLedgerRepository, 'balancesAt' | 'getVoucher'>,
		@Inject(LOCATION_REPOSITORY) private readonly locations: Pick<LocationRepository, 'list'>,
		@Inject(CASH_REPOSITORY) private readonly cash: Pick<CashRepository, 'unfinishedIn'>,
		@Inject(BANK_REPOSITORY) private readonly banks: Pick<BankRepository, 'list'>,
		@Inject(BANK_STATEMENT_REPOSITORY)
		private readonly statements: Pick<BankStatementRepository, 'summary' | 'inPeriod'>,
		@Inject(STOCK_COUNT_REPOSITORY) private readonly counts: Pick<StockCountRepository, 'list'>,
		@Inject(TRANSFER_REPOSITORY) private readonly transfers: Pick<TransferRepository, 'inTransitFrom'>,
		@Inject(FIXED_ASSET_REPOSITORY) private readonly assets: Pick<FixedAssetRepository, 'list'>,
		@Inject(PAYROLL_RUN_REPOSITORY) private readonly payroll: Pick<PayrollRunRepository, 'list'>,
		@Inject(COMPANY_REPOSITORY) private readonly company: Pick<CompanyRepository, 'listRegistrations'>,
		@Inject(GST_RETURN_REPOSITORY) private readonly filings: Pick<GstReturnRepository, 'list'>,
		@Inject(LedgerService)
		private readonly ledger: Pick<LedgerService, 'chart' | 'post' | 'reverse' | 'lockPeriods'>,
		@Inject(TRANSACTION_MANAGER) private readonly transactions: TransactionManagerPort,
	) {}

	private record(year: string, saved: YearCloseRecord | null): YearCloseRecord {
		return (
			saved ?? {
				year,
				accrualsConfirmedBy: null,
				accrualsConfirmedAt: null,
				suspenseNote: null,
				closingVoucherId: null,
				profitPaise: null,
				closedBy: null,
				closedAt: null,
				updatedAt: new Date(0).toISOString(),
			}
		);
	}

	/** The closing voucher the year needs now, from each location's balances (closing lines left out). */
	private async wantedClosing(year: string): Promise<{ lines: ClosingLine[]; profitPaise: number }> {
		const fy = yearSpan(year);
		const chart = await this.ledger.chart();
		let pl: string;
		try {
			pl = resolveRole(chart.ledgers, 'profit_and_loss').id;
		} catch {
			throw refuse('books_not_set_up');
		}
		const byLocation: Record<string, { closing: Record<string, number>; opening: Record<string, number> }> = {};
		for (const location of await this.locations.list()) {
			const [closing, opening] = await Promise.all([
				this.books.balancesAt(fy.to, [location.id]),
				this.books.balancesAt(dayAfter(fy.from, -1), [location.id]),
			]);
			byLocation[location.id] = { closing, opening };
		}
		return closingLines(chart, byLocation, pl);
	}

	private async suspensePaise(day: string): Promise<number> {
		const chart = await this.ledger.chart();
		const groups = new Map(chart.groups.map((g) => [g.id, g]));
		const underSuspense = (groupId: string): boolean => {
			const group = groups.get(groupId);
			if (!group) return false;
			return group.systemKey === 'suspense_account' || (group.parentId ? underSuspense(group.parentId) : false);
		};
		const clearing = new Set(
			chart.ledgers.filter((l) => CLEARING_ROLES.some((role) => rolesOf(l).includes(role))).map((l) => l.id),
		);
		const balances = await this.books.balancesAt(day, []);
		return chart.ledgers
			.filter((l) => underSuspense(l.groupId) || clearing.has(l.id))
			.reduce((sum, l) => sum + Math.abs(balances[l.id] ?? 0), 0);
	}

	/** T3: the year's checks, how many are done, and whether the closing entries or the close may go ahead. */
	async view(year: string): Promise<YearCloseView> {
		const fy = yearSpan(year);
		const record = this.record(year, await this.store.get(year));
		const march = fy.months[11] as string;
		const [sheets, moving, banks, summary, assets, runs, registrations, filed, wanted, suspense] =
			await Promise.all([
				Promise.all(fy.months.map((m) => this.cash.unfinishedIn(m))),
				Promise.all(fy.months.map((m) => this.transfers.inTransitFrom(m))),
				this.banks.list(),
				this.statements.summary(),
				this.assets.list(),
				this.payroll.list(),
				this.company.listRegistrations(),
				this.filings.list(),
				this.wantedClosing(year),
				this.suspensePaise(fy.to),
			]);
		let reconciled = 0;
		for (const bank of banks) {
			const reaches = (summary[bank.id]?.lastDate ?? '') >= fy.to;
			const lines = reaches ? await this.statements.inPeriod(bank.id, fy.from, fy.to) : [];
			if (reaches && lines.every((l) => l.status === 'accepted')) reconciled += 1;
		}
		const countWindow = { from: `${march}-01`, to: dayAfter(fy.to, 15) };
		const recent = (await this.counts.list({ filter: 'all', page: 1, pageSize: 200 })).items.filter(
			(c) => c.startedAt.slice(0, 10) >= countWindow.from && c.startedAt.slice(0, 10) <= countWindow.to,
		);
		const needed: string[] = [];
		for (const reg of registrations.filter((r) => r.active !== false)) {
			for (const month of fy.months) {
				const terms = termsOn(reg, `${month}-01`);
				if (!terms || (terms.kind !== 'regular' && terms.kind !== 'casual')) continue;
				if (terms.scheme === 'qrmp' && !QUARTER_ENDS.has(month.slice(5))) continue;
				needed.push(`${reg.id}:GSTR-1:${month}`, `${reg.id}:GSTR-3B:${month}`);
			}
		}
		const filedKeys = new Set(filed.map((f) => `${f.gstRegistrationId}:${f.returnType}:${f.month}`));
		const runFor = runs.find((r) => r.month === march);
		let closing: 'none' | 'posted' | 'stale' = 'none';
		if (record.closingVoucherId) {
			const voucher = await this.books.getVoucher(record.closingVoucherId);
			closing =
				voucher && !voucher.reversedById && !closingStale(voucher.lines, wanted.lines) ? 'posted' : 'stale';
		}
		const checks = yearCloseChecks({
			cashOpen: sheets.flat().length,
			banks: banks.length ? { total: banks.length, reconciled } : null,
			stockCount: {
				posted: recent.filter((c) => c.status === 'posted').length,
				open: recent.filter((c) => ['counting', 'review', 'awaiting_approval'].includes(c.status)).length,
			},
			transfersOpen: moving.flat().length,
			depreciationDue: assets.filter(
				(a) =>
					a.putToUseOn <= fy.to &&
					(!a.disposedOn || a.disposedOn >= `${march}-01`) &&
					(a.depreciatedThrough ?? '') < march &&
					a.accumulatedPaise < Math.round((a.costINR - a.residualINR) * 100),
			).length,
			payrollMarchDone: runs.length ? runFor?.status === 'posted' || runFor?.status === 'paid' : null,
			gst: needed.length ? { needed: needed.length, filed: needed.filter((k) => filedKeys.has(k)).length } : null,
			suspensePaise: suspense,
			suspenseCarried: !!record.suspenseNote,
			accrualsConfirmed: !!record.accrualsConfirmedAt,
			closing,
		});
		return {
			year,
			from: fy.from,
			to: fy.to,
			checks,
			done: yearCloseDone(checks),
			canPostClosing: !record.closedAt && closing !== 'posted' && yearCloseReady(checks, 'closing_entries'),
			canClose: !record.closedAt && yearCloseReady(checks, 'close'),
			closingVoucherId: record.closingVoucherId,
			profitPaise: record.profitPaise,
			suspenseNote: record.suspenseNote,
			accrualsConfirmedAt: record.accrualsConfirmedAt,
			closedAt: record.closedAt,
			closedBy: record.closedBy,
		};
	}

	/** Accruals and prepaid expenses confirmed as entered, and what is left in suspense carried with a note. */
	async confirm(
		year: string,
		write: YearCloseConfirm,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<YearCloseView> {
		const record = this.record(year, await this.store.get(year));
		if (record.closedAt) throw refuse('year_closed');
		await this.store.save({
			...record,
			...(write.accruals
				? { accrualsConfirmedBy: principal?.userId ?? null, accrualsConfirmedAt: now.toISOString() }
				: {}),
			...(write.suspenseNote !== null ? { suspenseNote: write.suspenseNote || null } : {}),
			updatedAt: now.toISOString(),
		});
		return this.view(year);
	}

	/** T3 Post the closing entries, dated the year's last day; an out-of-date one is reversed and posted again. */
	async postClosing(year: string, principal: AuthenticatedPrincipal | undefined, now = new Date()) {
		const view = await this.view(year);
		if (!view.canPostClosing) throw refuse('year_close_checks_open');
		const record = this.record(year, await this.store.get(year));
		const fy = yearSpan(year);
		if (record.closingVoucherId) {
			const old = await this.books.getVoucher(record.closingVoucherId);
			if (old && !old.reversedById)
				await this.ledger.reverse(
					old.id,
					{
						date: fy.to,
						reason: 'The year changed after its closing entries; posted again',
						idempotencyKey: `yearCloseUndo:${old.id}`,
					},
					principal,
				);
		}
		const wanted = await this.wantedClosing(year);
		if (!wanted.lines.length) throw refuse('year_close_nothing');
		const voucher = await this.transactions.withTransaction((context) =>
			this.ledger.post(
				{
					kind: 'journal',
					date: fy.to,
					narration: `Closing entries for ${year}`,
					source: { type: 'yearClose', id: year, number: null },
					idempotencyKey: `yearClose:${year}:${randomUUID()}`,
					lines: wanted.lines.map(({ ledgerId, ...amounts }) => ({ ledger: { id: ledgerId }, ...amounts })),
				},
				context,
				principal?.userId ?? null,
			),
		);
		await this.store.save({
			...record,
			closingVoucherId: voucher.id,
			profitPaise: wanted.profitPaise,
			updatedAt: now.toISOString(),
		});
		return this.view(year);
	}

	/** T3 Close and lock the year: every month, every part, locked for everyone. */
	async close(year: string, principal: AuthenticatedPrincipal | undefined, now = new Date()) {
		const view = await this.view(year);
		if (view.closedAt) throw refuse('year_closed');
		if (!view.canClose) throw refuse('year_close_checks_open');
		await this.ledger.lockPeriods(
			{ months: yearSpan(year).months, parts: [...BOOK_PARTS], state: 'locked', reason: `Year ${year} closed` },
			principal,
		);
		const record = this.record(year, await this.store.get(year));
		await this.store.save({
			...record,
			closedBy: principal?.userId ?? null,
			closedAt: now.toISOString(),
			updatedAt: now.toISOString(),
		});
		return this.view(year);
	}
}

/** Accounts › Periods and locks › Close the year (T3). */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/accounts/year-close')
export class YearCloseController {
	constructor(private readonly years: YearCloseService) {}

	@Get(':year')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'yearClose', summary: 'A financial year’s close: its checks and state (T3)' })
	view(@Param('year', new ZodValidationPipe(FinancialYear)) year: string) {
		return this.years.view(year);
	}

	@Post(':year/confirm')
	@RequirePermissions('accounts.post')
	@ApiOperation({ operationId: 'yearCloseConfirm', summary: 'Confirm accruals, or carry suspense with a note (T3)' })
	confirm(
		@Param('year', new ZodValidationPipe(FinancialYear)) year: string,
		@Body(new ZodValidationPipe(YearCloseConfirm)) body: YearCloseConfirm,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.years.confirm(year, body, principal);
	}

	@Post(':year/closing-entries')
	@RequirePermissions('accounts.post')
	@ApiOperation({ operationId: 'yearClosePost', summary: 'Post the year’s closing entries (T3)' })
	postClosing(
		@Param('year', new ZodValidationPipe(FinancialYear)) year: string,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.years.postClosing(year, principal);
	}

	@Post(':year/close')
	@RequirePermissions('accounts.lock')
	@ApiOperation({ operationId: 'yearCloseLock', summary: 'Close and lock the year (T3)' })
	close(
		@Param('year', new ZodValidationPipe(FinancialYear)) year: string,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.years.close(year, principal);
	}
}
