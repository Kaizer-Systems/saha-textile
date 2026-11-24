import type {
	AccountsTemplate,
	BusinessKind,
	ChartTemplateContent,
	TaxRuleEntry,
	TemplateContent,
} from '@saha-textile/contracts';

import { type ChartGroupSeed, type ChartLedgerSeed, defaultChart } from '../ledger/chart';
import { KIND_PACKS, LIMITS, LIMITS_V2, STARTER_REPORTS, TDS_SECTIONS } from './starter-packs';
import { CASH_LEDGERS, PETTY_GROUP } from '../cash/cash-rules';
import { BANK_LEDGERS } from '../bank/bank-rules';
import { TRANSFER_LEDGERS } from '../locations/transfer-rules';

/** The five kinds in Settings › Company, with each one's own chart template code. */
export const KIND_CHART_CODES: Record<BusinessKind, string> = {
	proprietorship: 'CH-PROP',
	partnership: 'CH-FIRM',
	llp: 'CH-LLP',
	private_limited_opc: 'CH-OPC',
	private_limited: 'CH-PVT',
};

const KIND_NAMES: Record<BusinessKind, string> = {
	proprietorship: "Proprietor's capital and drawings",
	partnership: "Partners' capital and current accounts",
	llp: "Partners' contribution and current accounts",
	private_limited_opc: 'Share capital and reserves (one person company)',
	private_limited: 'Share capital and reserves',
};

const groupSig = (g: ChartGroupSeed) =>
	JSON.stringify([g.systemKey, g.name, g.parentKey, g.nature, !!g.tradingAccount]);
const ledgerSig = (l: ChartLedgerSeed) => JSON.stringify([l.systemKey, l.name, l.groupKey, l.handPosting]);

const content = (groups: readonly ChartGroupSeed[], ledgers: readonly ChartLedgerSeed[]): ChartTemplateContent => ({
	kind: 'chart',
	groups: groups.map((g) => ({
		key: g.systemKey,
		name: g.name,
		parentKey: g.parentKey,
		nature: g.nature,
		tradingAccount: !!g.tradingAccount,
		roles: [g.systemKey],
	})),
	ledgers: ledgers.map((l) => ({
		key: l.systemKey,
		name: l.name,
		groupKey: l.groupKey,
		handPosting: l.handPosting,
		roles: [l.systemKey],
		ruleSetCode: null,
		source: '',
	})),
});

/** A ledger a later starter version adds (the expense ledgers the reverse-charge list posts to). */
const added = (key: string, name: string, groupKey: string) => ({
	key,
	name,
	groupKey,
	handPosting: true,
	roles: [key],
	ruleSetCode: null,
	source: '',
});

/** CH-COMMON v2: the expense ledgers the reverse-charge list (RS-RCM) posts to. */
const RCM_EXPENSE_LEDGERS = [
	added('legal_fees', 'Legal and professional fees', 'indirect_expenses'),
	added('security_services', 'Security services', 'indirect_expenses'),
	added('advertising', 'Advertising and sponsorship', 'indirect_expenses'),
	added('freight_inward', 'Freight inward', 'direct_expenses'),
];

/** CH-PVT and CH-OPC v2: a company pays its directors (the reverse-charge list's director's services). */
const COMPANY_LEDGERS = [added('directors_remuneration', "Directors' remuneration", 'indirect_expenses')];

const COMPANIES: readonly BusinessKind[] = ['private_limited_opc', 'private_limited'];
const FIRMS_AND_COMPANIES: BusinessKind[] = ['partnership', 'llp', ...COMPANIES];
const RCM_SOURCE = 'Notification 13/2017-Central Tax (Rate), as amended';

const rcmEntry = (
	key: string,
	name: string,
	code: string,
	ratePercent: number,
	expenseRole: string,
	from: string,
	kinds: BusinessKind[] | null = null,
): TaxRuleEntry => ({
	key,
	name,
	code,
	ratePercent,
	expenseRole,
	kinds,
	from,
	to: null,
	source: RCM_SOURCE,
	caReview: 'pending',
	limitINR: null,
	limitPer: null,
});

/** RS-RCM v1: services on which the buyer pays the GST. Codes and rates are to be confirmed by the CA. */
const RCM_ENTRIES: TaxRuleEntry[] = [
	rcmEntry('shop_rent', 'Rent of the shop (commercial property)', '997212', 18, 'rent', '2024-10-10'),
	rcmEntry('goods_transport', 'Goods transport agency', '996511', 5, 'freight_inward', '2017-07-01'),
	rcmEntry('advocate_fees', "Advocate's fees", '998212', 18, 'legal_fees', '2017-07-01'),
	rcmEntry(
		'security_services',
		'Security services by a non-company',
		'998525',
		18,
		'security_services',
		'2019-01-01',
	),
	rcmEntry('sponsorship', 'Sponsorship', '998397', 18, 'advertising', '2017-07-01', FIRMS_AND_COMPANIES),
	rcmEntry(
		'director_services',
		"A director's services to the company",
		'999799',
		18,
		'directors_remuneration',
		'2017-07-01',
		[...COMPANIES],
	),
];

/**
 * The starter templates (accounts templates T2, D4): the starting chart of every kind of business, split into what all
 * kinds share (CH-COMMON) and what is each kind's own, and the reverse-charge list (RS-RCM). Every version is marked for
 * CA review; the builder edits them from here (T4) and the five packs are authored in full in T8. A later starter
 * version (v2 here) reaches an existing library as an update, never by itself.
 */
export function starterTemplates(now: string): AccountsTemplate[] {
	const kinds = Object.keys(KIND_CHART_CODES) as BusinessKind[];
	const charts = kinds.map((kind) => ({ kind, chart: defaultChart(kind) }));
	const everywhere = <T>(sig: (x: T) => string, pick: (c: (typeof charts)[number]) => readonly T[]) => {
		const counts = new Map<string, number>();
		for (const c of charts) for (const s of new Set(pick(c).map(sig))) counts.set(s, (counts.get(s) ?? 0) + 1);
		return (x: T) => counts.get(sig(x)) === charts.length;
	};
	const sharedGroup = everywhere(groupSig, (c) => c.chart.groups);
	const sharedLedger = everywhere(ledgerSig, (c) => c.chart.ledgers);
	const version = (number: number, body: TemplateContent, source: string, validFrom = '2026-04-01') => ({
		version: number,
		validFrom,
		validTo: null,
		source,
		caReview: 'pending' as const,
		notes: '',
		content: body,
		publishedAt: now,
		publishedBy: null,
	});
	const start = 'The starting chart of accounts (general ledger F3); to be confirmed by the CA.';
	const expenses = 'Adds the expense ledgers the reverse-charge list (RS-RCM) posts to; to be confirmed by the CA.';
	const packs =
		"Adds the kind's own groups and ledgers from the accounts templates plan's matrix; to be confirmed by the CA.";
	const cash =
		'Adds the petty expense heads and the ledgers cash differences and staff claims post to (accounts brief O); to be confirmed by the CA.';
	const banks =
		"Adds where a bank's interest goes and the other side of opening balances typed in one by one (accounts brief BA2); to be confirmed by the CA.";
	const transfers =
		'Adds where a piece lost between locations goes: transit loss, or a claim on the carrier (accounts brief N6); to be confirmed by the CA.';
	const withLedgers = (body: ChartTemplateContent, more: ChartTemplateContent['ledgers']): ChartTemplateContent => ({
		...body,
		ledgers: [...body.ledgers, ...more],
	});
	const template = (
		code: string,
		kind: AccountsTemplate['kind'],
		name: string,
		appliesTo: AccountsTemplate['appliesTo'],
		versions: AccountsTemplate['versions'],
	) => ({
		id: `tpl_${code.toLowerCase().replace(/-/g, '_')}`,
		code,
		kind,
		name,
		description: '',
		appliesTo,
		versions,
		draft: null,
		createdAt: now,
		updatedAt: now,
	});
	const base = defaultChart('proprietorship');
	const common = content(base.groups.filter(sharedGroup), base.ledgers.filter(sharedLedger));
	return [
		template('CH-COMMON', 'chart', 'Shared chart', { all: true, kinds: [] }, [
			version(1, common, start),
			version(2, withLedgers(common, RCM_EXPENSE_LEDGERS), expenses),
			version(
				3,
				{
					...withLedgers(common, [...RCM_EXPENSE_LEDGERS, ...CASH_LEDGERS]),
					groups: [...common.groups, PETTY_GROUP],
				},
				cash,
				'2026-11-25',
			),
			version(
				4,
				{
					...withLedgers(common, [...RCM_EXPENSE_LEDGERS, ...CASH_LEDGERS, ...TRANSFER_LEDGERS]),
					groups: [...common.groups, PETTY_GROUP],
				},
				transfers,
				'2026-11-25',
			),
			version(
				5,
				{
					...withLedgers(common, [
						...RCM_EXPENSE_LEDGERS,
						...CASH_LEDGERS,
						...TRANSFER_LEDGERS,
						...BANK_LEDGERS,
					]),
					groups: [...common.groups, PETTY_GROUP],
				},
				banks,
				'2026-11-25',
			),
		]),
		...charts.map(({ kind, chart }) => {
			const own = content(
				chart.groups.filter((g) => !sharedGroup(g)),
				chart.ledgers.filter((l) => !sharedLedger(l)),
			);
			const before = COMPANIES.includes(kind) ? [version(2, withLedgers(own, COMPANY_LEDGERS), expenses)] : [];
			const latest = (before[0]?.content ?? own) as ChartTemplateContent;
			const pack = KIND_PACKS[kind];
			return template(KIND_CHART_CODES[kind], 'chart', KIND_NAMES[kind], { all: false, kinds: [kind] }, [
				version(1, own, start),
				...before,
				// T8: the kind's own groups and ledgers from the plan's matrix.
				version(
					before.length + 2,
					{
						...latest,
						groups: [...latest.groups, ...pack.groups],
						ledgers: [...latest.ledgers, ...pack.ledgers],
					},
					packs,
				),
			]);
		}),
		template('RS-RCM', 'taxRules', 'Reverse-charge list', { all: true, kinds: [] }, [
			version(
				1,
				{ kind: 'taxRules', list: 'reverseCharge', entries: RCM_ENTRIES },
				`${RCM_SOURCE}; to be confirmed by the CA.`,
				'2017-07-01',
			),
		]),
		template('RS-TDS', 'taxRules', 'TDS sections', { all: true, kinds: [] }, [
			version(1, TDS_SECTIONS, 'Income-tax Act 1961 and 2025; to be confirmed by the CA.', '2025-04-01'),
		]),
		template('RS-LIMITS', 'taxRules', 'Limits', { all: true, kinds: [] }, [
			version(
				1,
				LIMITS,
				'Income-tax, LLP and GST rules named on each limit; to be confirmed by the CA.',
				'2009-04-01',
			),
			version(
				2,
				LIMITS_V2,
				'Adds the transporter cash limit and the cash receipt limit (s.269ST); to be confirmed by the CA.',
				'2026-11-25',
			),
		]),
		...STARTER_REPORTS.map((starter) =>
			template(starter.code, 'report', starter.name, { all: false, kinds: starter.kinds }, [
				version(1, starter.content, starter.source),
			]),
		),
	];
}
