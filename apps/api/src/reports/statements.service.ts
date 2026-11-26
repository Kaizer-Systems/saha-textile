import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type {
	CashFlow,
	FinancialStatement,
	PeriodQuery,
	Ratios,
	PlByLocation,
	PlByLocationQuery,
	StatementKind,
	StatementQuery,
} from '@saha-textile/contracts';
import { cashFlowStatement, istDay, ratios, reportRows, type ReportColumn } from '@saha-textile/core-domain';

import { AccountsTemplatesService } from '../accounts-templates/accounts-templates.service';
import type { AuthenticatedPrincipal } from '../auth/session.guard';
import { accountsRefusal } from '../ledger/accounts-refusal';
import { LedgerService } from '../ledger/ledger.service';
import { LocationsService } from '../locations/locations.service';

const dayBefore = (day: string): string =>
	new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const yearStart = (day: string): string => {
	const year = Number(day.slice(0, 4));
	return `${Number(day.slice(5, 7)) >= 4 ? year : year - 1}-04-01`;
};

/** Which installed layout a statement uses: balance sheets end in -BS (or -BS-<kind>), statements of profit in -PL. */
export function isLayoutFor(kind: StatementKind, code: string): boolean {
	return kind === 'balanceSheet' ? /-BS(-|$)/.test(code) : /-PL$/.test(code);
}

/**
 * The financial statements (accounts brief U2, U3): the installed layout for the kind of business worked out on the
 * books as at a day, with last year-end beside it, at one location or every one the person may see; and profit and
 * loss for a period with a column per location.
 */
@Injectable()
export class StatementsService {
	constructor(
		@Inject(LedgerService) private readonly ledger: Pick<LedgerService, 'chart' | 'balancesAtLocations'>,
		@Inject(AccountsTemplatesService)
		private readonly templates: Pick<AccountsTemplatesService, 'installedReports'>,
		@Inject(LocationsService) private readonly locations: Pick<LocationsService, 'list'>,
	) {}

	private async layout(kind: StatementKind) {
		const found = (await this.templates.installedReports()).find((r) => isLayoutFor(kind, r.code));
		if (!found) throw new BadRequestException(accountsRefusal('statement_not_installed'));
		return found;
	}

	async statement(
		kind: StatementKind,
		query: StatementQuery,
		principal: AuthenticatedPrincipal | undefined,
		today = istDay(new Date()),
	): Promise<FinancialStatement> {
		const layout = await this.layout(kind);
		const at = query.asAt ?? today;
		const only = query.locationId ? [query.locationId] : [];
		const start = yearStart(at);
		const lastEnd = dayBefore(start);
		const balances = (day: string) => this.ledger.balancesAtLocations(day, principal, only);
		const [chart, closing, opening] = await Promise.all([this.ledger.chart(), balances(at), balances(lastEnd)]);
		const last: ReportColumn | null =
			layout.content.columns === 'thisAndLast'
				? { closing: opening, opening: await balances(dayBefore(`${Number(start.slice(0, 4)) - 1}-04-01`)) }
				: null;
		const { rows, problems } = reportRows(layout.content, chart, { closing, opening }, last);
		return {
			asAt: at,
			lastAsAt: last ? lastEnd : null,
			rows,
			problems,
			code: layout.code,
			name: layout.name,
			version: layout.version,
		};
	}

	/** The balances on the day before the period and on its last day, at the locations the person may see. */
	private async period(query: PeriodQuery, principal: AuthenticatedPrincipal | undefined) {
		if (query.from > query.to) throw new BadRequestException(accountsRefusal('report_period_backwards'));
		const [chart, opening, closing] = await Promise.all([
			this.ledger.chart(),
			this.ledger.balancesAtLocations(dayBefore(query.from), principal, []),
			this.ledger.balancesAtLocations(query.to, principal, []),
		]);
		return { chart, opening, closing };
	}

	/** Cash flow for a period, indirect method (AS 3). */
	async cashFlow(query: PeriodQuery, principal: AuthenticatedPrincipal | undefined): Promise<CashFlow> {
		const { chart, opening, closing } = await this.period(query, principal);
		return { from: query.from, to: query.to, ...cashFlowStatement(chart, opening, closing) };
	}

	/** The usual ratios for a period: liquidity at its end, margins and turnover over it. */
	async ratios(query: PeriodQuery, principal: AuthenticatedPrincipal | undefined): Promise<Ratios> {
		const { chart, opening, closing } = await this.period(query, principal);
		const days = Math.round((Date.parse(query.to) - Date.parse(query.from)) / 86_400_000) + 1;
		return { from: query.from, to: query.to, values: ratios(chart, opening, closing, days) };
	}

	/** U3: each location's own profit for the period (the head office's costs fall in its own column). */
	async plByLocation(query: PlByLocationQuery, principal: AuthenticatedPrincipal | undefined): Promise<PlByLocation> {
		if (query.from > query.to) throw new BadRequestException(accountsRefusal('report_period_backwards'));
		const layout = await this.layout('profitLoss');
		const chart = await this.ledger.chart();
		const locations = (await this.locations.list(principal)).filter((l) => l.active);
		const run = async (only: string[]) => {
			const [closing, opening] = await Promise.all([
				this.ledger.balancesAtLocations(query.to, principal, only),
				this.ledger.balancesAtLocations(dayBefore(query.from), principal, only),
			]);
			return reportRows(layout.content, chart, { closing, opening }, null);
		};
		const [all, ...each] = await Promise.all([run([]), ...locations.map((l) => run([l.id]))]);
		// Every run reads the same layout, so each location's statement has every row the whole one has.
		const byKey = (statement: typeof all, key: string) =>
			(statement.rows.find((r) => r.key === key) as (typeof all.rows)[number]).thisYearPaise;
		return {
			from: query.from,
			to: query.to,
			code: layout.code,
			name: layout.name,
			locations: locations.map((l) => ({ id: l.id, name: l.name })),
			rows: all.rows.map((row) => ({
				key: row.key,
				label: row.label,
				depth: row.depth,
				side: row.side,
				byLocation: Object.fromEntries(locations.map((l, i) => [l.id, byKey(each[i] as typeof all, row.key)])),
				totalPaise: row.thisYearPaise,
			})),
			problems: all.problems,
		};
	}
}
