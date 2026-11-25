import type {
	BusinessKind,
	ChartTemplateGroup,
	ChartTemplateLedger,
	ReportLine,
	ReportSource,
	ReportTemplateContent,
	TaxRuleEntry,
	TaxRuleSetContent,
} from '@saha-textile/contracts';

/**
 * The starter packs authored for every kind of business (accounts templates plan T8, AT-D1): what each kind's chart adds
 * to the shared one, the TDS sections and limits rule sets (AT5b, AT5c), and the statements of the plan's matrix as
 * report templates. Everything here is marked for the CA's review (AT-D6) and reaches a company only as an update a
 * person installs (AT-D5). Section numbers, rates and limits follow the sources named on each entry and are to be
 * confirmed by the CA before go-live.
 */

const group = (key: string, name: string, nature: ChartTemplateGroup['nature'], parentKey: string | null = null) => ({
	key,
	name,
	parentKey,
	nature,
	tradingAccount: false,
	roles: [key],
});
const ledger = (key: string, name: string, groupKey: string, source = ''): ChartTemplateLedger => ({
	key,
	name,
	groupKey,
	handPosting: true,
	roles: [key],
	ruleSetCode: null,
	source,
});

const PARTNER_RULES =
	'Income-tax Act 2025 (from 1 Apr 2026; earlier s.40(b) of the 1961 Act): interest up to 12% simple and remuneration to working partners within the book-profit limit, when the deed allows; to be confirmed by the CA.';
const SCHEDULE_III = 'Companies Act 2013, Schedule III Division I; to be confirmed by the CA.';

const partnerItems = (rules = PARTNER_RULES) => ({
	groups: [group('appropriation', 'Profit and loss appropriation', 'expense')],
	ledgers: [
		ledger('drawings', "Partners' drawings", 'partners_current'),
		ledger('loans_from_partners', 'Loans from partners', 'unsecured_loans'),
		ledger('interest_on_partners_capital', "Interest on partners' capital", 'appropriation', rules),
		ledger('partners_remuneration', "Partners' remuneration", 'appropriation', rules),
	],
});
/** Version 4 of a firm's and an LLP's chart (brief 25 YC3): the ledgers Year close's sharing posts to. */
export const FIRM_SHARE_LEDGERS: ChartTemplateLedger[] = [
	ledger('partners_profit_share', 'Share of profit to partners', 'appropriation', PARTNER_RULES),
	ledger(
		'tds_payable_partners',
		'TDS payable on partners (194T)',
		'duties_and_taxes',
		'Income-tax Act 1961 s.194T (from 1 Apr 2025; 2025 Act s.393); to be confirmed by the CA.',
	),
];
export const FIRM_SHARE_SOURCE = `Adds the share of profit and TDS on partners, as Year close posts them. ${PARTNER_RULES}`;

const companyItems = () => ({
	groups: [group('deferred_tax', 'Deferred tax liabilities (net)', 'liability')],
	ledgers: [
		ledger('securities_premium', 'Securities premium', 'reserves_and_surplus', SCHEDULE_III),
		ledger('general_reserve', 'General reserve', 'reserves_and_surplus', SCHEDULE_III),
		ledger('dividend_payable', 'Dividend payable', 'current_liabilities', SCHEDULE_III),
		ledger('provision_for_income_tax', 'Provision for income tax', 'provisions', SCHEDULE_III),
		ledger(
			'deferred_tax_liability',
			'Deferred tax liability',
			'deferred_tax',
			'AS 22, Taxes on income; to be confirmed by the CA.',
		),
		ledger('income_tax_expense', 'Tax expense', 'indirect_expenses', SCHEDULE_III),
		ledger('directors_sitting_fees', "Directors' sitting fees", 'indirect_expenses', SCHEDULE_III),
		ledger('loans_from_directors', 'Loans from directors', 'unsecured_loans', SCHEDULE_III),
		ledger(
			'csr_expense',
			'Corporate social responsibility',
			'indirect_expenses',
			'Companies Act 2013 s.135 (when it applies); to be confirmed by the CA.',
		),
	],
});

/** What each kind's chart gains in its next version, on top of the shared chart (the plan's matrix). */
export const KIND_PACKS: Record<BusinessKind, { groups: ChartTemplateGroup[]; ledgers: ChartTemplateLedger[] }> = {
	proprietorship: {
		groups: [],
		ledgers: [
			ledger(
				'interest_on_capital',
				'Interest on capital',
				'indirect_expenses',
				'Optional; for a proprietor it is not a deductible expense; to be confirmed by the CA.',
			),
			ledger('loans_from_family', "Loans from the proprietor's family", 'unsecured_loans'),
		],
	},
	partnership: partnerItems(),
	llp: {
		groups: [...partnerItems().groups, group('reserves_and_surplus', 'Reserves and surplus', 'equity')],
		ledgers: partnerItems(
			'LLP Act 2008 and the LLP agreement; ICAI Guidance Note on LLP financial statements; to be confirmed by the CA.',
		).ledgers,
	},
	private_limited_opc: companyItems(),
	private_limited: companyItems(),
};

/* ---------------------------------------------------------------------------------------------- */
/* TDS sections (AT5b) and limits (AT5c)                                                           */
/* ---------------------------------------------------------------------------------------------- */

const ACT_1961 = 'Income-tax Act 1961';
const ACT_2025 = 'Income-tax Act 2025, s.393 table; item to be confirmed by the CA';
const OLD_UNTIL = '2026-03-31';
const NEW_FROM = '2026-04-01';

const tds = (
	key: string,
	name: string,
	code: string,
	ratePercent: number,
	limitINR: number,
	limitPer: TaxRuleEntry['limitPer'],
	from: string,
	to: string | null,
	source: string,
	kinds: BusinessKind[] | null = null,
): TaxRuleEntry => ({
	key,
	name,
	code,
	ratePercent,
	due: null,
	expenseRole: null,
	kinds,
	from,
	to,
	source,
	caReview: 'pending',
	limitINR,
	limitPer,
});

/** Each section twice: the 1961 number for the year before 1 April 2026, the 2025 Act's from then (AT5-D3). */
const bothActs = (
	key: string,
	name: string,
	oldCode: string,
	ratePercent: number,
	limitINR: number,
	limitPer: TaxRuleEntry['limitPer'],
	kinds: BusinessKind[] | null = null,
): TaxRuleEntry[] => [
	tds(`${key}_1961`, name, oldCode, ratePercent, limitINR, limitPer, '2025-04-01', OLD_UNTIL, ACT_1961, kinds),
	tds(key, name, '393', ratePercent, limitINR, limitPer, NEW_FROM, null, ACT_2025, kinds),
];

/** RS-TDS v1: the TDS sections a textile retailer meets most, with the limits from 1 April 2025. */
export const TDS_SECTIONS: TaxRuleSetContent = {
	kind: 'taxRules',
	list: 'tds',
	entries: [
		// Two limits on one section are two entries (AT5-D2).
		...bothActs('contractor_individual_payment', 'Contractor, individual or HUF', '194C', 1, 30_000, 'payment'),
		...bothActs('contractor_individual_year', 'Contractor, individual or HUF', '194C', 1, 100_000, 'year'),
		...bothActs('contractor_other_payment', 'Contractor, others', '194C', 2, 30_000, 'payment'),
		...bothActs('contractor_other_year', 'Contractor, others', '194C', 2, 100_000, 'year'),
		...bothActs('professional_fees', 'Fees for professional services', '194J', 10, 50_000, 'year'),
		...bothActs('technical_fees', 'Fees for technical services', '194J', 2, 50_000, 'year'),
		...bothActs('rent_building', 'Rent of land or a building', '194-I', 10, 50_000, 'month'),
		...bothActs('commission', 'Commission or brokerage', '194H', 2, 20_000, 'year'),
		...bothActs('partner_payments', 'Salary, interest and commission to partners', '194T', 10, 20_000, 'year', [
			'partnership',
			'llp',
		]),
		...bothActs(
			'purchase_of_goods',
			'Purchase of goods (buyer above ₹10 crore turnover)',
			'194Q',
			0.1,
			5_000_000,
			'year',
		),
	],
};

const limit = (
	key: string,
	name: string,
	limitINR: number,
	limitPer: TaxRuleEntry['limitPer'],
	from: string,
	source: string,
	kinds: BusinessKind[] | null = null,
): TaxRuleEntry => tds(key, name, '', 0, limitINR, limitPer, from, null, source, kinds);

/** RS-LIMITS v1: the turnover and amount limits the books and returns check against. */
export const LIMITS: TaxRuleSetContent = {
	kind: 'taxRules',
	list: 'limits',
	entries: [
		limit(
			'tax_audit_turnover',
			'Tax audit: turnover in the year',
			10_000_000,
			'year',
			NEW_FROM,
			'Income-tax Act 2025 s.63 (earlier 1961 s.44AB); to be confirmed by the CA.',
		),
		limit(
			'tax_audit_turnover_low_cash',
			'Tax audit: turnover when cash receipts and payments are each within 5%',
			100_000_000,
			'year',
			NEW_FROM,
			'Income-tax Act 2025 s.63 (earlier 1961 s.44AB); to be confirmed by the CA.',
		),
		limit(
			'cash_payment_one_person',
			'Cash paid to one person in a day (above it, the expense is not allowed)',
			10_000,
			'payment',
			NEW_FROM,
			'Income-tax Act 2025 (earlier 1961 s.40A(3)); to be confirmed by the CA.',
		),
		limit(
			'llp_audit_turnover',
			'LLP audit: turnover',
			4_000_000,
			'year',
			'2009-04-01',
			'LLP Rules 2009 rule 24(8)',
			['llp'],
		),
		limit(
			'llp_audit_contribution',
			'LLP audit: contribution',
			2_500_000,
			null,
			'2009-04-01',
			'LLP Rules 2009 rule 24(8)',
			['llp'],
		),
		limit(
			'einvoice_turnover',
			'E-invoice: aggregate turnover in any year since 2017-18',
			50_000_000,
			'year',
			'2023-08-01',
			'Notification 10/2023-Central Tax',
		),
		limit(
			'gstr9_turnover',
			'GSTR-9 annual return: aggregate turnover',
			20_000_000,
			'year',
			'2024-04-01',
			'CGST Rules 2017 rule 80; to be confirmed by the CA.',
		),
		limit(
			'gstr9c_turnover',
			'GSTR-9C reconciliation: aggregate turnover',
			50_000_000,
			'year',
			'2024-04-01',
			'CGST Rules 2017 rule 80(3); to be confirmed by the CA.',
		),
	],
};

/**
 * RS-LIMITS v2 (accounts brief O4, P): cash to a transporter in a day (s.40A(3)'s higher limit) and cash received from
 * one person (s.269ST: two lakh or more in a day, for one transaction or one occasion, is not allowed).
 */
export const LIMITS_V2: TaxRuleSetContent = {
	...LIMITS,
	entries: [
		...LIMITS.entries,
		limit(
			'cash_payment_transporter',
			'Cash paid to a transporter of goods in a day (above it, the expense is not allowed)',
			35_000,
			'payment',
			NEW_FROM,
			'Income-tax Act 2025 (earlier 1961 s.40A(3A) and rule 6DD); to be confirmed by the CA.',
		),
		limit(
			'cash_receipt_one_person',
			'Cash received from one person in a day, for one sale or one occasion (two lakh or more is not allowed)',
			200_000,
			'payment',
			NEW_FROM,
			'Income-tax Act 2025 (earlier 1961 s.269ST); to be confirmed by the CA.',
		),
	],
};

/** One GST due-date rule of RS-DUE. */
const dueRule = (
	key: string,
	name: string,
	due: NonNullable<TaxRuleEntry['due']>,
	source: string,
	from = '2017-07-01',
): TaxRuleEntry => ({
	key,
	name,
	code: '',
	ratePercent: 0,
	expenseRole: null,
	kinds: null,
	from,
	to: null,
	source,
	caReview: 'pending',
	limitINR: null,
	limitPer: null,
	due,
});

/** QRMP States whose GSTR-3B falls due on the 22nd (the rest on the 24th), by GST State code. */
export const QRMP_22ND_STATES = ['22', '23', '24', '26', '27', '29', '30', '31', '32', '33', '34', '35', '36', '37'];

/**
 * RS-DUE v1: when GST returns fall due. Changed by CBIC notification (and extended for single months), so kept as data:
 * a month's extension is added as an entry with its `period`.
 */
export const DUE_DATES: TaxRuleSetContent = {
	kind: 'taxRules',
	list: 'dueDates',
	entries: [
		dueRule(
			'gstr1_monthly',
			'GSTR-1, monthly filers',
			{ returnType: 'GSTR-1', scheme: 'monthly', day: 11, monthsAfter: 1, states: [], period: null },
			'CGST Rules 2017 rule 59(1); to be confirmed by the CA.',
		),
		dueRule(
			'gstr1_qrmp',
			'GSTR-1, quarterly (QRMP), for the quarter',
			{ returnType: 'GSTR-1', scheme: 'qrmp', day: 13, monthsAfter: 1, states: [], period: null },
			'CGST Rules 2017 rule 59(1) second proviso; to be confirmed by the CA.',
			'2021-01-01',
		),
		dueRule(
			'gstr3b_monthly',
			'GSTR-3B, monthly filers',
			{ returnType: 'GSTR-3B', scheme: 'monthly', day: 20, monthsAfter: 1, states: [], period: null },
			'CGST Rules 2017 rule 61(5); to be confirmed by the CA.',
		),
		dueRule(
			'gstr3b_qrmp_22',
			'GSTR-3B, quarterly (QRMP), States due on the 22nd',
			{ returnType: 'GSTR-3B', scheme: 'qrmp', day: 22, monthsAfter: 1, states: QRMP_22ND_STATES, period: null },
			'CGST Rules 2017 rule 61(5) proviso; Notification 01/2020-Central Tax; to be confirmed by the CA.',
			'2021-01-01',
		),
		dueRule(
			'gstr3b_qrmp_24',
			'GSTR-3B, quarterly (QRMP), every other State (24th)',
			{ returnType: 'GSTR-3B', scheme: 'qrmp', day: 24, monthsAfter: 1, states: [], period: null },
			'CGST Rules 2017 rule 61(5) proviso; Notification 01/2020-Central Tax; to be confirmed by the CA.',
			'2021-01-01',
		),
		dueRule(
			'gstr9_annual',
			'GSTR-9, annual return (from the year’s last month, March)',
			{ returnType: 'GSTR-9', scheme: null, day: 31, monthsAfter: 9, states: [], period: null },
			'CGST Act 2017 s.44 and CGST Rules 2017 rule 80; to be confirmed by the CA.',
		),
	],
};

/**
 * RS-DUE v2 (25 Nov 2026, owner: build composition, QRMP and ISD): v1's rules and the other taxpayers' returns.
 */
export const DUE_DATES_V2: TaxRuleSetContent = {
	...DUE_DATES,
	entries: [
		...DUE_DATES.entries,
		dueRule(
			'iff_qrmp',
			'IFF, quarterly filers, first two months of a quarter (optional)',
			{ returnType: 'IFF', scheme: 'qrmp', day: 13, monthsAfter: 1, states: [], period: null },
			'CGST Rules 2017 rule 59(2); to be confirmed by the CA.',
			'2021-01-01',
		),
		dueRule(
			'pmt06_qrmp',
			'PMT-06, quarterly filers, first two months of a quarter',
			{ returnType: 'PMT-06', scheme: 'qrmp', day: 25, monthsAfter: 1, states: [], period: null },
			'CGST Rules 2017 rule 61A; to be confirmed by the CA.',
			'2021-01-01',
		),
		dueRule(
			'cmp08_quarter',
			'CMP-08, composition, for the quarter',
			{ returnType: 'CMP-08', scheme: null, day: 18, monthsAfter: 1, states: [], period: null },
			'CGST Rules 2017 rule 62(1)(i); to be confirmed by the CA.',
			'2019-04-01',
		),
		dueRule(
			'gstr4_annual',
			'GSTR-4, composition, for the year (from March)',
			{ returnType: 'GSTR-4', scheme: null, day: 30, monthsAfter: 1, states: [], period: null },
			'CGST Rules 2017 rule 62(1)(ii), from 2021-22; to be confirmed by the CA.',
			'2022-04-01',
		),
		dueRule(
			'gstr6_monthly',
			'GSTR-6, input service distributor',
			{ returnType: 'GSTR-6', scheme: null, day: 13, monthsAfter: 1, states: [], period: null },
			'CGST Rules 2017 rule 65; to be confirmed by the CA.',
		),
	],
};

/* ---------------------------------------------------------------------------------------------- */
/* Statements (AT6)                                                                                */
/* ---------------------------------------------------------------------------------------------- */

const groups = (...keys: string[]): ReportSource[] => keys.map((key) => ({ kind: 'group', key }));
const ledgers = (...keys: string[]): ReportSource[] => keys.map((key) => ({ kind: 'ledger', key }));
const line = (key: string, label: string, parentKey: string | null, sources: ReportSource[] = []): ReportLine => ({
	key,
	label,
	parentKey,
	sources,
});
const report = (lines: ReportLine[], level: ReportTemplateContent['level'] = null): ReportTemplateContent => ({
	kind: 'report',
	columns: 'thisAndLast',
	notes: true,
	level,
	lines,
});

/** The year's income and expense groups every chart has (the profit for the year, before appropriation). */
const PROFIT = groups('sales_accounts', 'direct_incomes', 'indirect_incomes', 'direct_expenses', 'indirect_expenses');

const assetLines = (): ReportLine[] => [
	line('assets', 'Assets', null),
	line('fixed_assets', 'Property, plant and equipment', 'assets', groups('fixed_assets')),
	line('investments', 'Investments', 'assets', groups('investments')),
	line('inventories', 'Inventories', 'assets', groups('stock_in_hand')),
	line('trade_receivables', 'Trade receivables', 'assets', groups('sundry_debtors')),
	line('cash_and_bank', 'Cash and bank balances', 'assets', groups('cash_in_hand', 'bank_accounts')),
	line('loans_and_advances', 'Loans and advances', 'assets', groups('loans_and_advances')),
	line('other_current_assets', 'Other current assets', 'assets', [
		...ledgers('gateway_clearing', 'upi_card_clearing', 'cod_receivable'),
		...groups('branch_divisions'),
	]),
];
const liabilityLines = (parent: string): ReportLine[] => [
	line('borrowings', 'Borrowings', parent, groups('secured_loans', 'unsecured_loans', 'bank_od')),
	line('trade_payables', 'Trade payables', parent, groups('sundry_creditors')),
	line('other_current_liabilities', 'Other current liabilities', parent, [
		...ledgers('customer_advances'),
		...groups('duties_and_taxes', 'suspense_account'),
	]),
	line('provisions', 'Provisions', parent, groups('provisions')),
];

/** Non-corporate profit and loss (ICAI guidance note), for a proprietorship and a firm. */
export const NCE_PROFIT_AND_LOSS = report(
	[
		line('income', 'Income', null),
		line('revenue', 'Revenue from operations', 'income', groups('sales_accounts', 'direct_incomes')),
		line('other_income', 'Other income', 'income', groups('indirect_incomes')),
		line('expenses', 'Expenses', null),
		line('direct', 'Cost of goods sold and direct expenses', 'expenses', groups('direct_expenses')),
		line('other_expenses', 'Other expenses', 'expenses', groups('indirect_expenses')),
		line('profit', 'Profit (loss) for the year', null, PROFIT),
	],
	'auto',
);

/** Non-corporate balance sheet for a proprietorship: the owner's funds with the year's profit. */
export const NCE_BALANCE_SHEET_PROPRIETORSHIP = report(
	[
		line('funds_and_liabilities', "Owner's funds and liabilities", null),
		line('owners_funds', "Owner's funds", 'funds_and_liabilities', groups('capital_account')),
		line('year_profit', 'Profit (loss) for the year', 'owners_funds', PROFIT),
		...liabilityLines('funds_and_liabilities'),
		...assetLines(),
	],
	'auto',
);

/** Non-corporate balance sheet for a firm: partners' capital and current accounts, the year's profit after appropriation. */
export const NCE_BALANCE_SHEET_FIRM = report(
	[
		line('funds_and_liabilities', "Partners' funds and liabilities", null),
		line('partners_capital', "Partners' capital accounts", 'funds_and_liabilities', groups('capital_account')),
		line('partners_current', "Partners' current accounts", 'funds_and_liabilities', groups('partners_current')),
		line('year_profit', 'Profit (loss) for the year, after appropriation', 'funds_and_liabilities', [
			...PROFIT,
			...groups('appropriation'),
		]),
		...liabilityLines('funds_and_liabilities'),
		...assetLines(),
	],
	'auto',
);

/** A firm's (and an LLP's) profit and loss appropriation account. */
export const APPROPRIATION = report([
	line('net_profit', 'Net profit for the year', null, PROFIT),
	line('interest', "Interest on partners' capital", null, ledgers('interest_on_partners_capital')),
	line('remuneration', "Partners' remuneration", null, ledgers('partners_remuneration')),
	line('to_partners', 'Share of profit to partners', null, [...PROFIT, ...groups('appropriation')]),
]);

const roles = (...keys: string[]): ReportSource[] => keys.map((key) => ({ kind: 'role', key }));

/**
 * Version 2 (brief 25 YC3): once Year close shares the profit through the appropriation ledgers, the share of profit is
 * its own line and the balance carried to the balance sheet is what is left unshared.
 */
export const APPROPRIATION_V2 = report([
	line('net_profit', 'Net profit for the year', null, PROFIT),
	line('interest', "Interest on partners' capital", null, roles('interest_on_partners_capital')),
	line('remuneration', "Partners' remuneration", null, roles('partners_remuneration')),
	line('to_partners', 'Share of profit to partners', null, roles('partners_profit_share')),
	line('balance', 'Balance carried to the balance sheet', null, [...PROFIT, ...groups('appropriation')]),
]);

/** An LLP's balance sheet (ICAI guidance note on LLPs): partners' funds as contribution, current accounts and reserves. */
export const LLP_BALANCE_SHEET = report([
	line('funds_and_liabilities', "Partners' funds and liabilities", null),
	line('contribution', "Partners' contribution", 'funds_and_liabilities', groups('capital_account')),
	line('partners_current', "Partners' current accounts", 'funds_and_liabilities', groups('partners_current')),
	line('reserves', 'Reserves and surplus', 'funds_and_liabilities', groups('reserves_and_surplus')),
	line('year_profit', 'Profit (loss) for the year, after appropriation', 'funds_and_liabilities', [
		...PROFIT,
		...groups('appropriation'),
	]),
	...liabilityLines('funds_and_liabilities'),
	...assetLines(),
]);

/** A company's balance sheet in the Schedule III Division I order (private limited and one person company). */
export const SCHEDULE_III_BALANCE_SHEET = report([
	line('equity_and_liabilities', 'Equity and liabilities', null),
	line('share_capital', 'Share capital', 'equity_and_liabilities', groups('capital_account')),
	line('reserves', 'Reserves and surplus', 'equity_and_liabilities', [...groups('reserves_and_surplus'), ...PROFIT]),
	line(
		'long_term_borrowings',
		'Long-term borrowings',
		'equity_and_liabilities',
		groups('secured_loans', 'unsecured_loans'),
	),
	line('deferred_tax', 'Deferred tax liabilities (net)', 'equity_and_liabilities', groups('deferred_tax')),
	line('short_term_borrowings', 'Short-term borrowings', 'equity_and_liabilities', groups('bank_od')),
	line('trade_payables', 'Trade payables', 'equity_and_liabilities', groups('sundry_creditors')),
	line('other_current_liabilities', 'Other current liabilities', 'equity_and_liabilities', [
		...ledgers('customer_advances', 'dividend_payable'),
		...groups('duties_and_taxes', 'suspense_account'),
	]),
	line('short_term_provisions', 'Short-term provisions', 'equity_and_liabilities', groups('provisions')),
	...assetLines(),
]);

/** A company's statement of profit and loss in the Schedule III order. */
export const SCHEDULE_III_PROFIT_AND_LOSS = report([
	line('revenue', 'Revenue from operations', null, groups('sales_accounts', 'direct_incomes')),
	line('other_income', 'Other income', null, groups('indirect_incomes')),
	line('expenses', 'Expenses', null),
	line('cost', 'Cost of goods sold and direct expenses', 'expenses', groups('direct_expenses')),
	line('employees', 'Employee benefits expense', 'expenses', ledgers('salaries')),
	line('depreciation', 'Depreciation and amortisation', 'expenses', ledgers('depreciation')),
	line(
		'other_expenses',
		'Other expenses',
		'expenses',
		ledgers(
			'gateway_charges',
			'bank_charges',
			'rent',
			'stock_loss',
			'cash_short_over',
			'rounding_off',
			'legal_fees',
			'security_services',
			'advertising',
			'directors_remuneration',
			'directors_sitting_fees',
			'csr_expense',
		),
	),
	line('tax', 'Tax expense', 'expenses', ledgers('income_tax_expense')),
	line('profit', 'Profit (loss) for the year', null, PROFIT),
]);

/** The report templates the starter library ships, with the kinds each is for and its source. */
export const STARTER_REPORTS: {
	code: string;
	name: string;
	kinds: BusinessKind[];
	source: string;
	content: ReportTemplateContent;
	/** Versions after the first, each from its date. */
	later?: { content: ReportTemplateContent; source: string; validFrom: string }[];
}[] = [
	{
		code: 'RP-NCE-PL',
		name: 'Profit and loss account (non-corporate)',
		kinds: ['proprietorship', 'partnership'],
		source: 'ICAI Guidance Note on Financial Statements of Non-Corporate Entities; to be confirmed by the CA.',
		content: NCE_PROFIT_AND_LOSS,
	},
	{
		code: 'RP-NCE-BS-PROP',
		name: 'Balance sheet (non-corporate, proprietorship)',
		kinds: ['proprietorship'],
		source: 'ICAI Guidance Note on Financial Statements of Non-Corporate Entities; to be confirmed by the CA.',
		content: NCE_BALANCE_SHEET_PROPRIETORSHIP,
	},
	{
		code: 'RP-NCE-BS-FIRM',
		name: 'Balance sheet (non-corporate, partnership firm)',
		kinds: ['partnership'],
		source: 'ICAI Guidance Note on Financial Statements of Non-Corporate Entities; to be confirmed by the CA.',
		content: NCE_BALANCE_SHEET_FIRM,
	},
	{
		code: 'RP-APPROP',
		name: 'Profit and loss appropriation account',
		kinds: ['partnership', 'llp'],
		source: `${PARTNER_RULES}`,
		content: APPROPRIATION,
		later: [
			{
				content: APPROPRIATION_V2,
				source: `Adds the share of profit and the balance carried, as Year close posts them. ${PARTNER_RULES}`,
				validFrom: '2026-11-25',
			},
		],
	},
	{
		code: 'RP-LLP-BS',
		name: 'Balance sheet (LLP)',
		kinds: ['llp'],
		source: 'ICAI Guidance Note on Financial Statements of LLPs; LLP Form 8; to be confirmed by the CA.',
		content: LLP_BALANCE_SHEET,
	},
	{
		code: 'RP-LLP-PL',
		name: 'Statement of profit and loss (LLP)',
		kinds: ['llp'],
		source: 'ICAI Guidance Note on Financial Statements of LLPs; to be confirmed by the CA.',
		content: { ...NCE_PROFIT_AND_LOSS, level: null },
	},
	{
		code: 'RP-SCH3-BS',
		name: 'Balance sheet (Schedule III)',
		kinds: ['private_limited', 'private_limited_opc'],
		source: SCHEDULE_III,
		content: SCHEDULE_III_BALANCE_SHEET,
	},
	{
		code: 'RP-SCH3-PL',
		name: 'Statement of profit and loss (Schedule III)',
		kinds: ['private_limited', 'private_limited_opc'],
		source: SCHEDULE_III,
		content: SCHEDULE_III_PROFIT_AND_LOSS,
	},
];
