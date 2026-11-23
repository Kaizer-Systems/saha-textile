import type { AccountsTemplate, BusinessKind, ChartTemplateContent } from '@saha-textile/contracts';

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
	})),
});

/**
 * The starter chart templates (accounts templates T2): the starting chart of every kind of business, split into what all
 * kinds share (CH-COMMON) and what is each kind's own. Version 1 of each, marked for CA review; the builder edits them
 * from here (T4) and the five packs are authored in full in T8.
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
	const version = (body: ChartTemplateContent) => ({
		version: 1,
		validFrom: '2026-04-01',
		validTo: null,
		source: 'The starting chart of accounts (general ledger F3); to be confirmed by the CA.',
		caReview: 'pending' as const,
		notes: '',
		content: body,
		publishedAt: now,
		publishedBy: null,
	});
	const template = (
		code: string,
		name: string,
		appliesTo: AccountsTemplate['appliesTo'],
		body: ChartTemplateContent,
	) => ({
		id: `tpl_${code.toLowerCase().replace(/-/g, '_')}`,
		code,
		kind: 'chart' as const,
		name,
		description: '',
		appliesTo,
		versions: [version(body)],
		createdAt: now,
		updatedAt: now,
	});
	const base = defaultChart('proprietorship');
	const common = template(
		'CH-COMMON',
		'Shared chart',
		{ all: true, kinds: [] },
		content(base.groups.filter(sharedGroup), base.ledgers.filter(sharedLedger)),
	);
	return [
		common,
		...charts.map(({ kind, chart }) =>
			template(
				KIND_CHART_CODES[kind],
				KIND_NAMES[kind],
				{ all: false, kinds: [kind] },
				content(
					chart.groups.filter((g) => !sharedGroup(g)),
					chart.ledgers.filter((l) => !sharedLedger(l)),
				),
			),
		),
	];
}
