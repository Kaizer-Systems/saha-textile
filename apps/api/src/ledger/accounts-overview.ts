import { Controller, Get, Header, Inject, Injectable, Optional, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	AccountsListQuery,
	AccountsOverviewQuery,
	type AccountsListTab,
	type AccountsOverview,
	type OverviewWaiting,
	type PeriodLock,
} from '@saha-textile/contracts';
import {
	istDay,
	overviewFigures,
	UNSETTLED_AFTER_DAYS,
	UNSETTLED_LOOKBACK_DAYS,
	type AccountsListsReader,
	type BankStatementRepository,
	type CashRepository,
	type GeneralLedgerRepository,
	type OrderPaymentRepository,
	type PeriodLockRepository,
	type SettlementRepository,
} from '@saha-textile/core-domain';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
	ACCOUNTS_LISTS_READER,
	BANK_STATEMENT_REPOSITORY,
	CASH_REPOSITORY,
	GENERAL_LEDGER_REPOSITORY,
	ORDER_PAYMENT_REPOSITORY,
	PERIOD_LOCK_REPOSITORY,
	SETTLEMENT_REPOSITORY,
} from '../infra/tokens';
import { API_TAGS } from '../openapi-tags';
import { LedgerService } from './ledger.service';

/** The day before an India day, as YYYY-MM-DD. */
const dayBefore = (day: string): string =>
	new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
/** The first day of the month after a YYYY-MM month. */
const nextMonthStart = (month: string): string => {
	const [y, m] = month.split('-').map(Number) as [number, number];
	return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
};

/** Months whose every part of the books is locked (T1), latest last. */
function lockedMonths(locks: readonly PeriodLock[]): string[] {
	const byMonth = new Map<string, PeriodLock[]>();
	for (const lock of locks) byMonth.set(lock.month, [...(byMonth.get(lock.month) ?? []), lock]);
	return [...byMonth]
		.filter(([, rows]) => rows.every((row) => row.state === 'locked'))
		.map(([month]) => month)
		.sort();
}

/** What waits, where it is counted: a Vouchers tab and its chip. */
const WAITING: ReadonlyArray<{ kind: OverviewWaiting['kind']; tab: AccountsListTab; chip: string }> = [
	{ kind: 'creditNoteDrafts', tab: 'creditNotes', chip: 'drafts' },
	{ kind: 'selfInvoicesDue', tab: 'selfInvoices', chip: 'due_soon' },
	{ kind: 'adjustmentsWaiting', tab: 'stockAdjustments', chip: 'waiting' },
	{ kind: 'refundsFailed', tab: 'refundVouchers', chip: 'failed' },
];

const shiftDays = (day: string, days: number) =>
	new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Accounts › Overview (accounts brief Q0): cash, bank, who owes whom today, the month's GST and whether the month is
 * locked, the year's profit, stock at cost, and what is waiting for someone. Balances follow the locations the person
 * may see, as every ledger screen does.
 */
@Injectable()
export class AccountsOverviewService {
	constructor(
		@Inject(LedgerService) private readonly ledger: Pick<LedgerService, 'chart' | 'balances'>,
		@Inject(PERIOD_LOCK_REPOSITORY) private readonly periods: Pick<PeriodLockRepository, 'list'>,
		@Inject(GENERAL_LEDGER_REPOSITORY) private readonly books: Pick<GeneralLedgerRepository, 'listDrafts'>,
		@Inject(ACCOUNTS_LISTS_READER) private readonly reader: AccountsListsReader,
		/** Cash boxes, differences and claims (accounts brief O); last so older callers keep working. */
		@Optional()
		@Inject(CASH_REPOSITORY)
		private readonly cash: Pick<CashRepository, 'boxes' | 'listSheets' | 'listClaims'> | null = null,
		/** Banks (accounts brief BA, Q10): lines to match and gateway payments in no payout; optional for the same reason. */
		@Optional()
		@Inject(BANK_STATEMENT_REPOSITORY)
		private readonly statements: Pick<BankStatementRepository, 'summary'> | null = null,
		@Optional()
		@Inject(ORDER_PAYMENT_REPOSITORY)
		private readonly payments: Pick<OrderPaymentRepository, 'listGatewayReceived'> | null = null,
		@Optional()
		@Inject(SETTLEMENT_REPOSITORY)
		private readonly settlements: Pick<SettlementRepository, 'settledPaymentIds'> | null = null,
	) {}

	async overview(
		query: AccountsOverviewQuery,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<AccountsOverview> {
		const today = istDay(now);
		const month = query.month ?? today.slice(0, 7);
		const monthEnd = dayBefore(nextMonthStart(month));
		const [y, m] = today.split('-').map(Number) as [number, number];
		const yearStart = `${m >= 4 ? y : y - 1}-04-01`;
		const balances = (day: string) => this.ledger.balances(day, principal);
		const [chart, atToday, atMonthEnd, monthBefore, yearBefore, locks, drafts, waiting, cash, banks] =
			await Promise.all([
				this.ledger.chart(),
				balances(today),
				balances(monthEnd < today ? monthEnd : today),
				balances(dayBefore(`${month}-01`)),
				balances(dayBefore(yearStart)),
				this.periods.list(),
				this.books.listDrafts(),
				this.waiting(today),
				this.cashFigures(today),
				this.bankWaiting(today),
			]);
		const figures = overviewFigures(chart, atToday, monthBefore, yearBefore);
		const locked = lockedMonths(locks);
		const items: OverviewWaiting[] = [
			...(drafts.length ? [{ kind: 'voucherDrafts' as const, count: drafts.length }] : []),
			...waiting,
			...cash.waiting,
			...banks,
		];
		return {
			...figures,
			cashBoxes: cash.boxes,
			month,
			gstPaise: overviewFigures(chart, atMonthEnd, monthBefore, monthBefore).gstPaise,
			gstDueOn: `${nextMonthStart(month).slice(0, 7)}-20`,
			monthLocked: locked.includes(month),
			lastLocked: locked.at(-1) ?? null,
			profitTo: today,
			waiting: items,
		};
	}

	/** Banks: statement lines still to match, and gateway payments no payout has paid after 7 days. */
	private async bankWaiting(today: string): Promise<OverviewWaiting[]> {
		const toMatch = this.statements
			? Object.values(await this.statements.summary()).reduce((sum, account) => sum + account.toMatch, 0)
			: 0;
		let unpaid = 0;
		if (this.payments && this.settlements) {
			const received = await this.payments.listGatewayReceived(
				shiftDays(today, -UNSETTLED_LOOKBACK_DAYS),
				shiftDays(today, -UNSETTLED_AFTER_DAYS),
			);
			const settled = await this.settlements.settledPaymentIds(received.map((p) => p.id));
			unpaid = received.filter((p) => !settled.has(p.id)).length;
		}
		const waiting: OverviewWaiting[] = [
			{ kind: 'bankLinesToMatch', count: toMatch },
			{ kind: 'paymentsNotInPayout', count: unpaid },
		];
		return waiting.filter((w) => w.count > 0);
	}

	/** Cash (accounts brief O): boxes in use, sheets waiting with a difference, claims waiting for approval. */
	private async cashFigures(today: string): Promise<{ boxes: number; waiting: OverviewWaiting[] }> {
		if (!this.cash) return { boxes: 0, waiting: [] };
		const [boxes, sheets, claims] = await Promise.all([
			this.cash.boxes(),
			this.cash.listSheets({
				from: '2017-07-01',
				to: today,
				chip: 'difference',
				locationIds: null,
				match: null,
				page: 1,
				pageSize: 1,
			}),
			this.cash.listClaims({
				from: '2017-07-01',
				to: today,
				chip: 'waiting',
				search: '',
				locationIds: null,
				page: 1,
				pageSize: 1,
			}),
		]);
		const waiting: OverviewWaiting[] = [
			{ kind: 'cashDifferences', count: sheets.counts.difference },
			{ kind: 'expenseClaims', count: claims.counts.waiting },
		];
		return { boxes: boxes.filter((b) => b.active).length, waiting: waiting.filter((w) => w.count > 0) };
	}

	/** Each waiting kind's count over every day the books have had, left out when nothing waits. */
	private async waiting(today: string): Promise<OverviewWaiting[]> {
		const counted = await Promise.all(
			WAITING.map(async (entry) => {
				const page = await this.reader.list(
					entry.tab,
					AccountsListQuery.parse({ from: '2017-07-01', to: today, chip: entry.chip, pageSize: 1 }),
					today,
				);
				return { kind: entry.kind, count: page.total };
			}),
		);
		return counted.filter((entry) => entry.count > 0);
	}
}

@ApiTags(API_TAGS.stock)
@Audience('admin')
@Controller('admin/accounts')
export class AccountsOverviewController {
	constructor(private readonly overview: AccountsOverviewService) {}

	@Get('overview')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({
		operationId: 'accountsOverview',
		summary: 'Accounts › Overview: cash, bank, dues, GST, profit, stock',
	})
	get(
		@Query(new ZodValidationPipe(AccountsOverviewQuery)) query: AccountsOverviewQuery,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.overview.overview(query, principal);
	}
}
