import { randomUUID } from 'node:crypto';

import { BadRequestException, Body, Controller, Get, Header, Inject, Injectable, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	BOOK_PARTS,
	FinancialYear,
	YearCloseConfirm,
	type ChartOfAccounts,
	type CompanyProfile,
	type JournalVoucher,
	type Location,
	type ProfitChoice,
	type ProfitPlan,
	type YearCloseView,
} from '@saha-textile/contracts';
import {
	PROFIT_CHOICES,
	PROFIT_LEDGERS,
	closingLines,
	closingStale,
	partnerRole,
	profitByLocation,
	profitChoiceFor,
	profitPlanLines,
	shareProfit,
	yearSpan,
	resolveRole,
	rolesOf,
	returnsFor,
	termsOn,
	yearCloseChecks,
	yearCloseDone,
	yearCloseReady,
	type BankRepository,
	type BankStatementRepository,
	type CapitalTrail,
	type CashRepository,
	type ClosingLine,
	type CompanyRepository,
	type FixedAssetRepository,
	type GeneralLedgerRepository,
	type GstReturnRepository,
	type LocationRepository,
	type PayrollRunRepository,
	type ShareResult,
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
const KEEP: ProfitChoice = { option: 'keep', reserveBasis: 'percent', reserveValue: 0 };
/** What a choice posts, as a key: the reserve's figures count only for the general reserve. */
const choiceKey = (choice: ProfitChoice): string =>
	JSON.stringify(
		choice.option === 'to_general_reserve'
			? [choice.option, choice.reserveBasis, choice.reserveValue]
			: [choice.option],
	);
const NO_SHARE: ShareResult = {
	rows: [],
	bookProfitPaise: null,
	remunerationLimitPaise: null,
	remunerationDisallowedPaise: 0,
	interestDisallowedPaise: 0,
	chargesApplied: false,
	problems: [],
};
type ByLocation = Record<string, { closing: Record<string, number>; opening: Record<string, number> }>;
interface Books {
	chart: ChartOfAccounts;
	pl: string;
	locations: Location[];
	byLocation: ByLocation;
}
/** Where the owners' accounts are kept: the head office, the first active location made. */
const ownersLocation = (locations: readonly Location[]): string | null =>
	[...locations].filter((l) => l.active).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]?.id ?? null;
/** The balances with a posted profit voucher taken back out, so the sharing it posted reads as it did before. */
function without(byLocation: ByLocation, voucher: JournalVoucher | null): ByLocation {
	if (!voucher) return byLocation;
	const out: ByLocation = {};
	for (const [location, at] of Object.entries(byLocation)) out[location] = { ...at, closing: { ...at.closing } };
	for (const line of voucher.lines) {
		const at = out[line.locationId];
		if (at) at.closing[line.ledgerId] = (at.closing[line.ledgerId] ?? 0) - line.debitPaise + line.creditPaise;
	}
	return out;
}

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
		private readonly books: Pick<
			GeneralLedgerRepository,
			'balancesAt' | 'getVoucher' | 'balanceBefore' | 'statementLines'
		>,
		@Inject(LOCATION_REPOSITORY) private readonly locations: Pick<LocationRepository, 'list'>,
		@Inject(CASH_REPOSITORY) private readonly cash: Pick<CashRepository, 'unfinishedIn'>,
		@Inject(BANK_REPOSITORY) private readonly banks: Pick<BankRepository, 'list'>,
		@Inject(BANK_STATEMENT_REPOSITORY)
		private readonly statements: Pick<BankStatementRepository, 'summary' | 'inPeriod'>,
		@Inject(STOCK_COUNT_REPOSITORY) private readonly counts: Pick<StockCountRepository, 'list'>,
		@Inject(TRANSFER_REPOSITORY) private readonly transfers: Pick<TransferRepository, 'inTransitFrom'>,
		@Inject(FIXED_ASSET_REPOSITORY) private readonly assets: Pick<FixedAssetRepository, 'list'>,
		@Inject(PAYROLL_RUN_REPOSITORY) private readonly payroll: Pick<PayrollRunRepository, 'list'>,
		@Inject(COMPANY_REPOSITORY)
		private readonly company: Pick<CompanyRepository, 'listRegistrations' | 'getProfile'>,
		@Inject(GST_RETURN_REPOSITORY) private readonly filings: Pick<GstReturnRepository, 'list'>,
		@Inject(LedgerService)
		private readonly ledger: Pick<LedgerService, 'chart' | 'post' | 'reverse' | 'lockPeriods' | 'ensureRoleLedger'>,
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

	/** Each location's balances at the year's end and on its eve (closing lines left out), with the chart. */
	private async readBooks(year: string): Promise<Books> {
		const fy = yearSpan(year);
		const chart = await this.ledger.chart();
		let pl: string;
		try {
			pl = resolveRole(chart.ledgers, 'profit_and_loss').id;
		} catch {
			throw refuse('books_not_set_up');
		}
		const locations = await this.locations.list();
		const byLocation: ByLocation = {};
		for (const location of locations) {
			const [closing, opening] = await Promise.all([
				this.books.balancesAt(fy.to, [location.id]),
				this.books.balancesAt(dayAfter(fy.from, -1), [location.id]),
			]);
			byLocation[location.id] = { closing, opening };
		}
		return { chart, pl, locations, byLocation };
	}

	/** The closing voucher the year needs now, from each location's balances (closing lines left out). */
	private wantedClosing(books: Books): { lines: ClosingLine[]; profitPaise: number } {
		return closingLines(books.chart, books.byLocation, books.pl);
	}

	/** A partner's capital through the year from their capital ledger. */
	private async capitalTrail(ledgerId: string, year: string): Promise<CapitalTrail> {
		const fy = yearSpan(year);
		const [before, lines] = await Promise.all([
			this.books.balanceBefore(ledgerId, fy.from, []),
			this.books.statementLines(ledgerId, fy.from, fy.to, []),
		]);
		// Opening balances brought in are capital at the year's start, whatever day the opening entry carries.
		const opening = lines.filter((l) => l.kind === 'opening');
		return {
			openingPaise: opening.reduce((sum, l) => sum + l.creditPaise - l.debitPaise, -before),
			moves: lines
				.filter((l) => l.kind !== 'opening')
				.map((l) => ({ day: l.date, paise: l.creditPaise - l.debitPaise })),
		};
	}

	/**
	 * YC1, YC3: what the choice posts on these books (a posted sharing taken back out first), its lines by ledger for
	 * comparing with what was posted, and the roles it needs.
	 */
	private async profitPlan(
		year: string,
		choice: ProfitChoice,
		books: Books,
		profile: CompanyProfile | null,
	): Promise<{ plan: ProfitPlan; lines: ClosingLine[]; roles: string[] }> {
		const fy = yearSpan(year);
		const profits = profitByLocation(books.chart, books.byLocation, books.pl);
		const profit = Object.values(profits).reduce((sum, p) => sum + p, 0);
		const owners = ownersLocation(books.locations);
		const byRole = (role: string) =>
			books.chart.ledgers.find((l) => l.active !== false && rolesOf(l).includes(role));
		const problems = new Set<string>();
		let share: ShareResult | null = null;
		if ((choice.option === 'deed' || choice.option === 'ratio_only') && profile) {
			const capital: Record<string, CapitalTrail> = {};
			const ids = new Set(
				[...profile.partners, ...profile.earlierDeeds.flatMap((deed) => deed.partners)].map((p) => p.id),
			);
			for (const id of ids) {
				const ledger = byRole(partnerRole('capital', id));
				if (ledger) capital[id] = await this.capitalTrail(ledger.id, year);
				else problems.add('partner_ledgers_missing');
			}
			share = shareProfit({
				method: choice.option,
				from: fy.from,
				to: fy.to,
				profitPaise: profit,
				book: profile,
				capital,
			});
			for (const problem of share.problems) problems.add(problem);
		}
		const drawings = byRole('drawings');
		const drawingsByLocation: Record<string, number> = {};
		if (choice.option === 'to_capital' && drawings)
			for (const [location, at] of Object.entries(books.byLocation))
				if (at.closing[drawings.id]) drawingsByLocation[location] = at.closing[drawings.id] as number;
		if (!owners && choice.option !== 'keep') problems.add('no_location');
		const planned = profitPlanLines({
			choice,
			profitByLocation: profits,
			ownersLocationId: owners ?? '',
			drawingsByLocation,
			share,
			partnersCapital: profile?.partnersCapital ?? 'fixed_with_current',
		});
		const capitalLedger = byRole('capital');
		const capitalNow = capitalLedger
			? -Object.values(books.byLocation).reduce((sum, at) => sum + (at.closing[capitalLedger.id] ?? 0), 0)
			: 0;
		const done = share ?? NO_SHARE;
		return {
			plan: {
				option: choice.option,
				profitPaise: profit,
				rows: done.rows,
				bookProfitPaise: done.bookProfitPaise,
				remunerationLimitPaise: done.remunerationLimitPaise,
				remunerationDisallowedPaise: done.remunerationDisallowedPaise,
				interestDisallowedPaise: done.interestDisallowedPaise,
				chargesApplied: done.chargesApplied,
				drawingsPaise: planned.drawingsPaise,
				capitalAfterPaise: choice.option.startsWith('to_capital')
					? capitalNow + profit - planned.drawingsPaise
					: null,
				reservePaise: planned.reservePaise,
				lines: planned.lines.map((line) => ({
					ledgerName: byRole(line.role)?.name ?? PROFIT_LEDGERS[line.role]?.name ?? line.role,
					debitPaise: line.debitPaise,
					creditPaise: line.creditPaise,
					narration: line.narration,
				})),
				problems: [...problems],
			},
			lines: planned.lines.map((line) => ({
				ledgerId: byRole(line.role)?.id ?? `role:${line.role}`,
				locationId: line.locationId,
				debitPaise: line.debitPaise,
				creditPaise: line.creditPaise,
			})),
			roles: [...new Set(planned.lines.map((line) => line.role))],
		};
	}

	/** The year's choice in force: saved, else the kind's default (a year closed before keeps the profit where it is). */
	private async choiceFor(year: string, record: YearCloseRecord, profile: CompanyProfile | null) {
		const start = Number(year.slice(0, 4));
		const before = await this.store.get(`${start - 1}-${String(start % 100).padStart(2, '0')}`);
		const kind = profile?.kind ?? 'private_limited';
		// A year whose closing entries were posted before the choice existed posted "keep".
		const saved = record.profitChoice ?? (record.closingVoucherId && !record.postedChoice ? KEEP : null);
		return { kind, choice: profitChoiceFor(kind, saved, !!before?.closedAt) };
	}

	/** The profit voucher a year posted, while it stands. */
	private async liveProfitVoucher(record: YearCloseRecord): Promise<JournalVoucher | null> {
		const voucher = record.profitVoucherId ? await this.books.getVoucher(record.profitVoucherId) : null;
		return voucher && !voucher.reversedById ? voucher : null;
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
		const [sheets, moving, banks, summary, assets, runs, registrations, filed, books, suspense] = await Promise.all(
			[
				Promise.all(fy.months.map((m) => this.cash.unfinishedIn(m))),
				Promise.all(fy.months.map((m) => this.transfers.inTransitFrom(m))),
				this.banks.list(),
				this.statements.summary(),
				this.assets.list(),
				this.payroll.list(),
				this.company.listRegistrations(),
				this.filings.list(),
				this.readBooks(year),
				this.suspensePaise(fy.to),
			],
		);
		const wanted = this.wantedClosing(books);
		const profile = await this.company.getProfile();
		const { kind, choice } = await this.choiceFor(year, record, profile);
		const liveProfit = await this.liveProfitVoucher(record);
		const planned = await this.profitPlan(
			year,
			choice,
			{ ...books, byLocation: without(books.byLocation, liveProfit) },
			profile,
		);
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
				if (!terms) continue;
				// The returns each kind files (G1–G3): IFF is optional and PMT-06 a payment, so neither is counted.
				for (const type of returnsFor(terms.kind, terms.scheme)) {
					if (type === 'IFF' || type === 'PMT-06') continue;
					const quarterly =
						type === 'CMP-08' || (terms.scheme === 'qrmp' && (type === 'GSTR-1' || type === 'GSTR-3B'));
					if (quarterly && !QUARTER_ENDS.has(month.slice(5))) continue;
					needed.push(`${reg.id}:${type}:${month}`);
				}
			}
		}
		const filedKeys = new Set(filed.map((f) => `${f.gstRegistrationId}:${f.returnType}:${f.month}`));
		const runFor = runs.find((r) => r.month === march);
		let closing: 'none' | 'posted' | 'stale' = 'none';
		if (record.closingVoucherId) {
			const voucher = await this.books.getVoucher(record.closingVoucherId);
			// An open year's closing is out of date too when the choice, or what it shares, has changed since.
			const moved =
				!record.closedAt &&
				((record.postedChoice ?? choiceKey(KEEP)) !== choiceKey(choice) ||
					closingStale(liveProfit?.lines ?? [], planned.lines));
			closing =
				voucher && !voucher.reversedById && !closingStale(voucher.lines, wanted.lines) && !moved
					? 'posted'
					: 'stale';
		}
		const checks = yearCloseChecks({
			cashOpen: sheets.flat().length,
			banks: banks.length ? { total: banks.length, reconciled } : null,
			stockCount: {
				posted: recent.filter((c) => c.status === 'posted').length,
				open: recent.filter((c) => ['counting', 'review', 'awaiting_approval'].includes(c.status)).length,
				// SC2: every warehouse counted, by a count of its own or one of every location.
				uncounted: recent.some((c) => c.status === 'posted' && !c.locationId)
					? 0
					: books.locations.filter(
							(l) =>
								l.active &&
								l.warehouse &&
								!recent.some((c) => c.status === 'posted' && c.locationId === l.id),
						).length,
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
			kind,
			profitChoice: choice,
			profitChoices: [...PROFIT_CHOICES[kind]],
			profitPlan: planned.plan,
			profitVoucherId: liveProfit?.id ?? null,
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
		if (write.profitChoice) {
			const kind = (await this.company.getProfile())?.kind ?? 'private_limited';
			if (!PROFIT_CHOICES[kind].includes(write.profitChoice.option)) throw refuse('profit_choice_not_offered');
		}
		await this.store.save({
			...record,
			...(write.profitChoice ? { profitChoice: write.profitChoice } : {}),
			...(write.accruals
				? { accrualsConfirmedBy: principal?.userId ?? null, accrualsConfirmedAt: now.toISOString() }
				: {}),
			...(write.suspenseNote !== null ? { suspenseNote: write.suspenseNote || null } : {}),
			updatedAt: now.toISOString(),
		});
		return this.view(year);
	}

	/**
	 * T3 Post the closing entries, dated the year's last day, with where the profit goes (YC1, YC3) posted first as a
	 * voucher of its own; out-of-date ones are reversed and both posted again.
	 */
	async postClosing(year: string, principal: AuthenticatedPrincipal | undefined, now = new Date()) {
		const view = await this.view(year);
		if (!view.canPostClosing) throw refuse('year_close_checks_open');
		const record = this.record(year, await this.store.get(year));
		const fy = yearSpan(year);
		for (const id of [record.closingVoucherId, record.profitVoucherId ?? null]) {
			const old = id ? await this.books.getVoucher(id) : null;
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
		const by = principal?.userId ?? null;
		const before = await this.readBooks(year);
		const planned = await this.profitPlan(year, view.profitChoice, before, await this.company.getProfile());
		if (!planned.lines.length && !this.wantedClosing(before).lines.length) throw refuse('year_close_nothing');
		if (planned.plan.problems.length) throw refuse(`profit_plan_${planned.plan.problems[0]}`);
		let profitVoucherId: string | null = null;
		if (planned.lines.length) {
			const ids = new Map<string, string>();
			for (const role of planned.roles) {
				const found = before.chart.ledgers.find((l) => l.active !== false && rolesOf(l).includes(role));
				const made = PROFIT_LEDGERS[role];
				if (found) ids.set(role, found.id);
				else if (made) ids.set(role, await this.ledger.ensureRoleLedger(role, made.name, made.groupKey, by));
				else throw refuse('profit_plan_ledger_missing');
			}
			const roleOf = new Map([...ids].map(([role, id]) => [`role:${role}`, id]));
			const voucher = await this.transactions.withTransaction((context) =>
				this.ledger.post(
					{
						kind: 'journal',
						date: fy.to,
						narration: `Where the profit of ${year} goes`,
						source: { type: 'profitShare', id: year, number: null },
						idempotencyKey: `profitShare:${year}:${randomUUID()}`,
						lines: planned.lines.map(({ ledgerId, ...amounts }, i) => ({
							ledger: { id: roleOf.get(ledgerId) ?? ledgerId },
							...amounts,
							narration: planned.plan.lines[i]?.narration ?? '',
						})),
					},
					context,
					by,
				),
			);
			profitVoucherId = voucher.id;
		}
		const wanted = this.wantedClosing(planned.lines.length ? await this.readBooks(year) : before);
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
				by,
			),
		);
		await this.store.save({
			...record,
			closingVoucherId: voucher.id,
			profitVoucherId,
			postedChoice: choiceKey(view.profitChoice),
			profitPaise: planned.plan.profitPaise,
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
