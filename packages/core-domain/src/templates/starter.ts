import type {
	AccountsTemplate,
	BusinessKind,
	ChartTemplateContent,
	TaxRuleEntry,
	TemplateContent,
} from '@saha-textile/contracts';

import { type ChartGroupSeed, type ChartLedgerSeed, defaultChart } from '../ledger/chart';

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
): TaxRuleEntry => ({ key, name, code, ratePercent, expenseRole, kinds, from, to: null, source: RCM_SOURCE });

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
		]),
		...charts.map(({ kind, chart }) => {
			const own = content(
				chart.groups.filter((g) => !sharedGroup(g)),
				chart.ledgers.filter((l) => !sharedLedger(l)),
			);
			return template(KIND_CHART_CODES[kind], 'chart', KIND_NAMES[kind], { all: false, kinds: [kind] }, [
				version(1, own, start),
				...(COMPANIES.includes(kind) ? [version(2, withLedgers(own, COMPANY_LEDGERS), expenses)] : []),
			]);
		}),
		template('RS-RCM', 'taxRules', 'Reverse-charge list', { all: true, kinds: [] }, [
			version(
				1,
				{ kind: 'taxRules', entries: RCM_ENTRIES },
				`${RCM_SOURCE}; to be confirmed by the CA.`,
				'2017-07-01',
			),
		]),
	];
}
