import type { BusinessKind, DeedTerm, InterestBasis, ProfitChoice, ProfitChoiceOption } from '@saha-textile/contracts';

import { PARTNER_INTEREST_CAP_PERCENT, partnerRemunerationLimitINR } from '../company/company-rules';

/**
 * Where the year's profit goes at year close (brief 25 YC1–YC3, approved 2026-11-25). Pure: the choices each kind of
 * business is offered, a firm's or LLP's sharing as the deed says (interest on capital day by day, remuneration, the
 * rest in the ratio, TDS under s.194T) with the s.40(b) limit shown but never forced, and the journal lines each choice
 * posts, by ledger role. A real voucher, not a closing one: the partners' accounts, capital, reserve and TDS payable it
 * moves count in every report from then on.
 */

export const PROFIT_CHOICES: Readonly<Record<BusinessKind, readonly ProfitChoiceOption[]>> = {
	proprietorship: ['keep', 'to_capital', 'to_capital_keep_drawings'],
	partnership: ['keep', 'deed', 'ratio_only'],
	llp: ['keep', 'deed', 'ratio_only'],
	private_limited_opc: ['keep', 'to_general_reserve'],
	private_limited: ['keep', 'to_general_reserve'],
};

const choice = (option: ProfitChoiceOption): ProfitChoice => ({ option, reserveBasis: 'percent', reserveValue: 0 });

/** YC-D1: a company that closed a year before keeps today's behaviour; otherwise the kind's usual choice. */
export function defaultProfitChoice(kind: BusinessKind, closedBefore: boolean): ProfitChoice {
	if (closedBefore) return choice('keep');
	if (kind === 'proprietorship') return choice('to_capital');
	if (kind === 'partnership' || kind === 'llp') return choice('deed');
	return choice('keep');
}

/** The choice in force: the saved one when the kind offers it, else the default. */
export function profitChoiceFor(kind: BusinessKind, saved: ProfitChoice | null, closedBefore: boolean): ProfitChoice {
	return saved && PROFIT_CHOICES[kind].includes(saved.option) ? saved : defaultProfitChoice(kind, closedBefore);
}

/** s.194T (Income-tax Act 2025 s.393 table): 10% on a partner's interest and remuneration once the year's total passes ₹20,000. */
export const PARTNER_TDS_LIMIT_PAISE = 2_000_000;
/** The s.40(b)(v) limit (2025 Act s.35(e)) in paise, from the rupee rule Settings › Company already shows. */
export function remunerationLimitPaise(bookProfitPaise: number): number {
	return Math.round(partnerRemunerationLimitINR(bookProfitPaise / 100) * 100);
}

/** TDS on a partner's interest and remuneration for the year, to the nearest rupee (s.288B). */
export function partnerTdsPaise(basePaise: number): number {
	return basePaise > PARTNER_TDS_LIMIT_PAISE ? Math.round(basePaise / 1000) * 100 : 0;
}

/** The ledger role of a partner's capital (an LLP's contribution) or current account (AT3). */
export function partnerRole(what: 'capital' | 'current', partnerId: string): string {
	return `partner_${what}_${partnerId.toLowerCase().replace(/[^a-z0-9]/g, '_')}`.slice(0, 60);
}

export interface DeedRules {
	interestBasis: InterestBasis;
	lossYearCharges: boolean;
	partners: readonly DeedTerm[];
}

/** The deed in force today (from `deedFrom`) and the ones before it, as Settings › Company › Partners keeps them. */
export interface DeedBook extends DeedRules {
	deedFrom: string | null;
	earlierDeeds: readonly (DeedRules & { from: string | null; to: string })[];
}

/**
 * The deed ruling a day: an earlier one whose dates hold it, else today's from its start. Null for a day no deed
 * covers (before today's deed began with no earlier one holding it, or in a gap between deeds): on such a day the
 * partners share equally and nothing is paid as interest or remuneration (Partnership Act s.13(a), (b); s.40(b) allows
 * only what a deed authorises, for the period after it).
 */
export function deedOn(book: DeedBook, day: string): DeedRules | null {
	const earlier = book.earlierDeeds.find((deed) => (deed.from ?? '') <= day && day <= deed.to);
	if (earlier) return earlier;
	return book.deedFrom === null || day >= book.deedFrom ? book : null;
}

const nextDay = (day: string): string =>
	new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

function daysOf(from: string, to: string): string[] {
	const days: string[] = [];
	for (let day = from; day <= to; day = nextDay(day)) days.push(day);
	return days;
}

/** Split an amount in proportion to weights, to the paisa, the remainders to the largest fractions (ties: list order). */
export function splitByWeights(amountPaise: number, weights: readonly number[]): number[] {
	const total = weights.reduce((sum, w) => sum + w, 0);
	if (total <= 0) return weights.map(() => 0);
	const sign = amountPaise < 0 ? -1 : 1;
	const whole = Math.abs(amountPaise);
	const raw = weights.map((w) => (whole * w) / total);
	const parts = raw.map((r) => Math.floor(r));
	let left = whole - parts.reduce((sum, p) => sum + p, 0);
	const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
	for (const { i } of order) {
		if (left <= 0) break;
		parts[i] = (parts[i] as number) + 1;
		left -= 1;
	}
	return parts.map((p) => (p === 0 ? 0 : sign * p));
}

/** A partner's capital through the year (credit positive): before the first day, and each entry in it. */
export interface CapitalTrail {
	openingPaise: number;
	moves: readonly { day: string; paise: number }[];
}

export interface ShareInput {
	method: 'deed' | 'ratio_only';
	from: string;
	to: string;
	/** The year's profit before any sharing (a loss is negative). */
	profitPaise: number;
	book: DeedBook;
	capital: Readonly<Record<string, CapitalTrail>>;
}

export interface ShareRowResult {
	partnerId: string;
	name: string;
	sharePercent: number;
	interestPaise: number;
	interestAllowedPaise: number;
	remunerationPaise: number;
	sharePaise: number;
	totalPaise: number;
	tdsPaise: number;
}

export interface ShareResult {
	rows: ShareRowResult[];
	bookProfitPaise: number | null;
	remunerationLimitPaise: number | null;
	remunerationDisallowedPaise: number;
	interestDisallowedPaise: number;
	chargesApplied: boolean;
	problems: string[];
}

interface Running {
	id: string;
	name: string;
	weight: number;
	interest: number;
	allowed: number;
	monthly: number;
	percent: number;
}

/**
 * YC3: the year's profit shared among the partners. With the deed: interest on capital (each day's capital, or the
 * opening capital, at the rate of the deed ruling that day), remuneration to working partners (a month's fixed sum
 * under the deed ruling on the month's first day, or a % of book profit for the days a deed held), the rest in the
 * ratio, days weighted when the deed changed. A loss year pays interest and remuneration only when the deed says so;
 * "ratio only" shares the whole profit or loss in the ratio. TDS is on interest and remuneration; a share of profit is
 * exempt (s.10(2A)).
 */
export function shareProfit(input: ShareInput): ShareResult {
	const days = daysOf(input.from, input.to);
	const n = days.length;
	const problems = new Set<string>();
	const people = new Map<string, Running>();
	const person = (term: DeedTerm): Running => {
		const found = people.get(term.id);
		if (found) return found;
		const fresh = { id: term.id, name: term.name, weight: 0, interest: 0, allowed: 0, monthly: 0, percent: 0 };
		people.set(term.id, fresh);
		return fresh;
	};
	// Today's partners first, in their order; anyone only in an earlier deed after them.
	for (const term of input.book.partners) person(term);
	const capitalNow = new Map<string, number>();
	const nextMove = new Map<string, number>();
	const trail = (id: string): CapitalTrail => input.capital[id] ?? { openingPaise: 0, moves: [] };
	const sortedMoves = new Map<string, { day: string; paise: number }[]>();
	for (const day of days) {
		const ruling = deedOn(input.book, day);
		// A day no deed covers: today's partners, sharing equally, with no interest or remuneration.
		const deed = ruling ?? input.book;
		if (ruling && Math.round(deed.partners.reduce((sum, t) => sum + t.profitSharePercent, 0) * 100) !== 10_000)
			problems.add('partner_shares_total_100');
		for (const term of deed.partners) {
			const running = person(term);
			if (!sortedMoves.has(term.id))
				sortedMoves.set(
					term.id,
					[...trail(term.id).moves].sort((a, b) => a.day.localeCompare(b.day)),
				);
			const moves = sortedMoves.get(term.id) as { day: string; paise: number }[];
			// Capital at the start of the day: money brought in or taken out counts from the next day.
			let capital = capitalNow.get(term.id) ?? trail(term.id).openingPaise;
			let at = nextMove.get(term.id) ?? 0;
			while (at < moves.length && (moves[at] as { day: string }).day < day) {
				capital += (moves[at] as { paise: number }).paise;
				at += 1;
			}
			capitalNow.set(term.id, capital);
			nextMove.set(term.id, at);
			if (!ruling) {
				running.weight += 1 / deed.partners.length / n;
				continue;
			}
			const base = Math.max(deed.interestBasis === 'opening' ? trail(term.id).openingPaise : capital, 0);
			running.weight += term.profitSharePercent / 100 / n;
			running.interest += (base * term.interestOnCapitalPercent) / 100 / n;
			running.allowed += (base * Math.min(term.interestOnCapitalPercent, PARTNER_INTEREST_CAP_PERCENT)) / 100 / n;
			if (!term.working) continue;
			if (term.remunerationBasis === 'percent_of_book_profit')
				running.percent += term.remunerationPercent / 100 / n;
			else if (term.remunerationBasis === 'monthly' && day.endsWith('-01'))
				running.monthly += Math.round(term.monthlyRemunerationINR * 100);
		}
	}
	const list = [...people.values()];
	const lastDeed = deedOn(input.book, input.to) ?? input.book;
	const deedMethod = input.method === 'deed';
	const chargesApplied = deedMethod && (input.profitPaise > 0 || lastDeed.lossYearCharges);
	const interest = list.map((p) => (chargesApplied ? Math.round(p.interest) : 0));
	const allowed = list.map((p) => (chargesApplied ? Math.round(p.allowed) : 0));
	const allowedTotal = allowed.reduce((sum, a) => sum + a, 0);
	const bookProfit = input.profitPaise - allowedTotal;
	const remuneration = list.map((p) =>
		chargesApplied ? Math.round(p.monthly + p.percent * Math.max(bookProfit, 0)) : 0,
	);
	const charged = interest.reduce((sum, i) => sum + i, 0) + remuneration.reduce((sum, r) => sum + r, 0);
	const shares = splitByWeights(
		input.profitPaise - charged,
		list.map((p) => p.weight),
	);
	const weightTotal = list.reduce((sum, p) => sum + p.weight, 0);
	if (!list.length || weightTotal <= 0) problems.add('partners_missing');
	const limit = deedMethod ? remunerationLimitPaise(bookProfit) : null;
	const remunerationTotal = remuneration.reduce((sum, r) => sum + r, 0);
	return {
		rows: list.map((p, i) => {
			const own = (interest[i] as number) + (remuneration[i] as number);
			return {
				partnerId: p.id,
				name: p.name,
				sharePercent: weightTotal > 0 ? Math.round((p.weight / weightTotal) * 10_000) / 100 : 0,
				interestPaise: interest[i] as number,
				interestAllowedPaise: allowed[i] as number,
				remunerationPaise: remuneration[i] as number,
				sharePaise: shares[i] as number,
				totalPaise: own + (shares[i] as number),
				tdsPaise: partnerTdsPaise(own),
			};
		}),
		bookProfitPaise: deedMethod ? bookProfit : null,
		remunerationLimitPaise: limit,
		remunerationDisallowedPaise: limit === null ? 0 : Math.max(0, remunerationTotal - limit),
		interestDisallowedPaise: interest.reduce((sum, i, k) => sum + i - (allowed[k] as number), 0),
		chargesApplied,
		problems: [...problems],
	};
}

/** A line of the profit voucher by ledger role (debit positive in `paise` before it is split into sides). */
export interface PlannedLine {
	role: string;
	locationId: string;
	debitPaise: number;
	creditPaise: number;
	narration: string;
}

const entry = (role: string, locationId: string, paise: number, narration: string): PlannedLine[] =>
	paise === 0
		? []
		: [
				{
					role,
					locationId,
					debitPaise: paise > 0 ? paise : 0,
					creditPaise: paise < 0 ? -paise : 0,
					narration,
				},
			];

/** Names for the ledgers the profit voucher may need to make, and the group each is made in. */
export const PROFIT_LEDGERS: Readonly<Record<string, { name: string; groupKey: string }>> = {
	interest_on_partners_capital: { name: "Interest on partners' capital", groupKey: 'appropriation' },
	partners_remuneration: { name: "Partners' remuneration", groupKey: 'appropriation' },
	partners_profit_share: { name: 'Share of profit to partners', groupKey: 'appropriation' },
	tds_payable_partners: { name: 'TDS payable on partners (194T)', groupKey: 'duties_and_taxes' },
	general_reserve: { name: 'General reserve', groupKey: 'reserves_and_surplus' },
};

export interface ProfitPlanInput {
	choice: ProfitChoice;
	/** Each location's profit for the year before sharing (a loss negative). */
	profitByLocation: Readonly<Record<string, number>>;
	/** Where the owners' accounts are kept: the head office (the first location made). */
	ownersLocationId: string;
	/** Proprietorship: each location's drawings balance at the year's end (debit positive). */
	drawingsByLocation: Readonly<Record<string, number>>;
	share: ShareResult | null;
	partnersCapital: 'fixed_with_current' | 'fluctuating';
}

/**
 * The profit voucher's lines for a choice (YC1, YC3), dated the year's last day. A proprietor's profit moves from the
 * profit and loss account to capital and drawings close into capital; a company moves an amount to general reserve;
 * a firm's interest, remuneration and share go through the appropriation ledgers to each partner's current account
 * (capital account when capital is fluctuating), with TDS taken from it.
 */
export function profitPlanLines(input: ProfitPlanInput): {
	lines: PlannedLine[];
	reservePaise: number;
	drawingsPaise: number;
} {
	const owners = input.ownersLocationId;
	const profit = Object.values(input.profitByLocation).reduce((sum, p) => sum + p, 0);
	const option = input.choice.option;
	if (option === 'to_capital' || option === 'to_capital_keep_drawings') {
		const lines = Object.entries(input.profitByLocation).flatMap(([location, p]) =>
			entry('profit_and_loss', location, p, 'The year’s profit to capital'),
		);
		lines.push(...entry('capital', owners, -profit, 'The year’s profit to capital'));
		const drawings =
			option === 'to_capital' ? Object.values(input.drawingsByLocation).reduce((sum, d) => sum + d, 0) : 0;
		if (drawings) {
			for (const [location, d] of Object.entries(input.drawingsByLocation))
				lines.push(...entry('drawings', location, -d, 'Drawings closed into capital'));
			lines.push(...entry('capital', owners, drawings, 'Drawings closed into capital'));
		}
		return { lines, reservePaise: 0, drawingsPaise: drawings };
	}
	if (option === 'to_general_reserve') {
		const wanted =
			input.choice.reserveBasis === 'amount'
				? Math.round(input.choice.reserveValue * 100)
				: Math.round((profit * input.choice.reserveValue) / 100);
		const reserve = profit > 0 ? Math.min(profit, wanted) : 0;
		return {
			lines: [
				...entry('profit_and_loss', owners, reserve, 'To general reserve'),
				...entry('general_reserve', owners, -reserve, 'To general reserve'),
			],
			reservePaise: reserve,
			drawingsPaise: 0,
		};
	}
	if ((option === 'deed' || option === 'ratio_only') && input.share) {
		const lines: PlannedLine[] = [];
		const target = input.partnersCapital === 'fluctuating' ? 'capital' : 'current';
		for (const row of input.share.rows) {
			const account = partnerRole(target, row.partnerId);
			lines.push(
				...entry('interest_on_partners_capital', owners, row.interestPaise, `Interest on capital: ${row.name}`),
				...entry('partners_remuneration', owners, row.remunerationPaise, `Remuneration: ${row.name}`),
				...entry('partners_profit_share', owners, row.sharePaise, `Share of profit: ${row.name}`),
				...entry(account, owners, -row.totalPaise, `The year’s share: ${row.name}`),
				...entry(account, owners, row.tdsPaise, `TDS under s.194T: ${row.name}`),
				...entry('tds_payable_partners', owners, -row.tdsPaise, `TDS under s.194T: ${row.name}`),
			);
		}
		return { lines, reservePaise: 0, drawingsPaise: 0 };
	}
	return { lines: [], reservePaise: 0, drawingsPaise: 0 };
}

interface ChartWithKeys {
	groups: readonly { id: string; parentId: string | null; systemKey?: string | null; roles?: readonly string[] }[];
	ledgers: readonly { id: string; groupId: string }[];
}

/** Ledgers under the profit and loss appropriation group: shared profit, never part of the profit itself. */
export function appropriationLedgerIds(chart: ChartWithKeys): Set<string> {
	const groups = new Map(chart.groups.map((g) => [g.id, g]));
	const under = (groupId: string): boolean => {
		const group = groups.get(groupId);
		if (!group) return false;
		if (group.systemKey === 'appropriation' || group.roles?.includes('appropriation')) return true;
		return group.parentId ? under(group.parentId) : false;
	};
	return new Set(chart.ledgers.filter((l) => under(l.groupId)).map((l) => l.id));
}
