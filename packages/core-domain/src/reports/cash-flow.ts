/**
 * Cash flow statement (indirect method, AS 3) and the usual ratios (accounts brief U1 "Financial statements"). Pure:
 * from the chart and the ledger balances (debit positive, paise) at the start and the end of a period. Every ledger is
 * placed by the system key of its nearest classified group, so the lines always add up to the change in cash.
 */

interface ChartLike {
	groups: readonly { id: string; systemKey: string | null; parentId: string | null; nature: string }[];
	ledgers: readonly { id: string; systemKey: string | null; groupId: string }[];
}
type Balances = Readonly<Record<string, number>>;

export type CashFlowSection = 'operating' | 'investing' | 'financing';
export interface CashFlowLine {
	section: CashFlowSection;
	key: string;
	paise: number;
}

const CASH_GROUPS = new Set(['cash_in_hand', 'bank_accounts']);
const INVESTING = new Set(['fixed_assets', 'investments']);
const FINANCING = new Set([
	'capital_account',
	'reserves_and_surplus',
	'partners_current',
	'loans_liability',
	'secured_loans',
	'unsecured_loans',
	'bank_od',
]);
/** Working-capital groups shown on their own line; anything else on the balance sheet goes to "other". */
const WORKING = [
	'sundry_debtors',
	'stock_in_hand',
	'loans_and_advances',
	'current_assets',
	'sundry_creditors',
	'duties_and_taxes',
	'provisions',
	'current_liabilities',
];

/** A ledger's classifying key: the nearest group (from its own upwards) whose system key is one we place. */
function placeOf(chart: ChartLike, groupId: string): { key: string | null; nature: string } {
	const groups = new Map(chart.groups.map((g) => [g.id, g]));
	let group = groups.get(groupId);
	const nature = group?.nature ?? 'asset';
	while (group) {
		const key = group.systemKey;
		if (key && (CASH_GROUPS.has(key) || INVESTING.has(key) || FINANCING.has(key) || WORKING.includes(key)))
			return { key, nature };
		group = group.parentId ? groups.get(group.parentId) : undefined;
	}
	return { key: null, nature };
}

export interface CashFlowStatement {
	lines: CashFlowLine[];
	sections: Record<CashFlowSection, number>;
	netChange: number;
	openingCash: number;
	closingCash: number;
}

/**
 * Operating: profit for the period, depreciation added back, then each working-capital change (an asset grown uses
 * cash, a liability grown brings it). Investing: fixed assets bought (net of the depreciation already added back) and
 * investments. Financing: owners' money and loans. Net change = closing cash − opening cash.
 */
export function cashFlowStatement(chart: ChartLike, opening: Balances, closing: Balances): CashFlowStatement {
	const change = (id: string) => (closing[id] ?? 0) - (opening[id] ?? 0);
	let profit = 0;
	let depreciation = 0;
	let openingCash = 0;
	let closingCash = 0;
	const byKey = new Map<string, number>();
	for (const ledger of chart.ledgers) {
		const place = placeOf(chart, ledger.groupId);
		const delta = change(ledger.id);
		if (place.nature === 'income' || place.nature === 'expense') {
			profit -= delta;
			if (ledger.systemKey === 'depreciation') depreciation += delta;
			continue;
		}
		if (place.key && CASH_GROUPS.has(place.key)) {
			openingCash += opening[ledger.id] ?? 0;
			closingCash += closing[ledger.id] ?? 0;
			continue;
		}
		const key = place.key ?? 'other';
		byKey.set(key, (byKey.get(key) ?? 0) - delta);
	}
	const lines: CashFlowLine[] = [
		{ section: 'operating', key: 'profit', paise: profit },
		{ section: 'operating', key: 'depreciation', paise: depreciation },
		...[...WORKING, 'other'].map((key) => ({ section: 'operating' as const, key, paise: byKey.get(key) ?? 0 })),
		{ section: 'investing', key: 'fixed_assets', paise: (byKey.get('fixed_assets') ?? 0) - depreciation },
		{ section: 'investing', key: 'investments', paise: byKey.get('investments') ?? 0 },
		...[...FINANCING].map((key) => ({ section: 'financing' as const, key, paise: byKey.get(key) ?? 0 })),
	];
	const sections = { operating: 0, investing: 0, financing: 0 };
	for (const line of lines) sections[line.section] += line.paise;
	return {
		lines: lines.filter((l) => l.paise !== 0 || l.key === 'profit'),
		sections,
		netChange: sections.operating + sections.investing + sections.financing,
		openingCash,
		closingCash,
	};
}

export type RatioKey =
	| 'currentRatio'
	| 'quickRatio'
	| 'grossMargin'
	| 'netMargin'
	| 'debtorDays'
	| 'creditorDays'
	| 'stockTurnover'
	| 'debtEquity';

/**
 * The usual ratios for a period ending `closing` (days in the period given): liquidity from the balance sheet at the
 * end, margins and turnover from the period's trading. Null where the divisor is nothing.
 */
export function ratios(
	chart: ChartLike,
	opening: Balances,
	closing: Balances,
	days: number,
): Record<RatioKey, number | null> {
	const groups = new Map(chart.groups.map((g) => [g.id, g]));
	const under = (groupId: string, key: string): boolean => {
		let group = groups.get(groupId);
		while (group) {
			if (group.systemKey === key) return true;
			group = group.parentId ? groups.get(group.parentId) : undefined;
		}
		return false;
	};
	const sum = (pick: (l: ChartLike['ledgers'][number]) => boolean, at: Balances) =>
		chart.ledgers.filter(pick).reduce((total, l) => total + (at[l.id] ?? 0), 0);
	const moved = (pick: (l: ChartLike['ledgers'][number]) => boolean) => sum(pick, closing) - sum(pick, opening);
	const inGroup = (key: string) => (l: ChartLike['ledgers'][number]) => under(l.groupId, key);

	const currentAssets = sum(inGroup('current_assets'), closing);
	const stock = sum(inGroup('stock_in_hand'), closing);
	const openingStock = sum(inGroup('stock_in_hand'), opening);
	const currentLiabilities = -sum(inGroup('current_liabilities'), closing);
	const sales = -moved(inGroup('sales_accounts'));
	const directIncome = -moved(inGroup('direct_incomes'));
	const directCosts = moved(inGroup('direct_expenses'));
	const indirectIncome = -moved(inGroup('indirect_incomes'));
	const indirectCosts = moved(inGroup('indirect_expenses'));
	const grossProfit = sales + directIncome - directCosts;
	const netProfit = grossProfit + indirectIncome - indirectCosts;
	const debtors = sum(inGroup('sundry_debtors'), closing);
	const creditors = -sum(inGroup('sundry_creditors'), closing);
	const purchases = moved((l) => l.systemKey === 'purchases') || directCosts;
	const loans = -['secured_loans', 'unsecured_loans', 'loans_liability', 'bank_od'].reduce(
		(total, key) => total + sum(inGroup(key), closing),
		0,
	);
	const equity = -['capital_account', 'reserves_and_surplus', 'partners_current'].reduce(
		(total, key) => total + sum(inGroup(key), closing),
		0,
	);
	const per = (a: number, b: number, scale = 1) => (b ? Math.round((a / b) * scale * 100) / 100 : null);
	return {
		currentRatio: per(currentAssets, currentLiabilities),
		quickRatio: per(currentAssets - stock, currentLiabilities),
		grossMargin: per(grossProfit, sales, 100),
		netMargin: per(netProfit, sales, 100),
		debtorDays: per(debtors * days, sales),
		creditorDays: per(creditors * days, purchases),
		stockTurnover: per(directCosts, (stock + openingStock) / 2),
		debtEquity: per(loans, equity),
	};
}
