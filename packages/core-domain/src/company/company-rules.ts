import type {
	BusinessKind,
	CompanyProfile,
	FeatureKey,
	GstRegistration,
	GstRegistrationTerms,
} from '@saha-textile/contracts';

/**
 * Company setup rules (accounts brief J, CT1–CT7 and G1–G2; owner-approved 2026-11-23).
 * Pure functions: the API checks a save with them, the admin shows the same problems inline.
 */

export type CompanyProblem =
	| 'proprietor_needed'
	| 'partners_two_or_more'
	| 'partner_shares_total_100'
	| 'llp_two_designated_partners'
	| 'opc_one_shareholder'
	| 'opc_nominee_needed'
	| 'company_two_directors'
	| 'company_one_director'
	| 'cin_needed'
	| 'llpin_needed'
	| 'paid_up_over_authorised';

/** The kinds of business offered (public limited is not), in the order the picker shows them; same as contracts' BUSINESS_KINDS. */
export const BUSINESS_KIND_LIST: readonly BusinessKind[] = [
	'proprietorship',
	'partnership',
	'llp',
	'private_limited_opc',
	'private_limited',
];

const twoDecimals = (value: number): number => Math.round(value * 100) / 100;

/** What a save must have for its kind of business (CT2–CT5). */
export function companyProblems(profile: CompanyProfile): CompanyProblem[] {
	const problems: CompanyProblem[] = [];
	const shares = twoDecimals(profile.partners.reduce((sum, partner) => sum + partner.profitSharePercent, 0));
	switch (profile.kind) {
		case 'proprietorship':
			if (!profile.proprietor) problems.push('proprietor_needed');
			break;
		case 'partnership':
			if (profile.partners.length < 2) problems.push('partners_two_or_more');
			if (profile.partners.length && shares !== 100) problems.push('partner_shares_total_100');
			break;
		case 'llp':
			if (profile.partners.length < 2) problems.push('partners_two_or_more');
			if (profile.partners.filter((partner) => partner.designated).length < 2)
				problems.push('llp_two_designated_partners');
			if (profile.partners.length && shares !== 100) problems.push('partner_shares_total_100');
			if (!profile.llpin) problems.push('llpin_needed');
			break;
		case 'private_limited_opc':
			if (profile.shareholders.length !== 1) problems.push('opc_one_shareholder');
			if (!profile.nomineeName) problems.push('opc_nominee_needed');
			if (profile.directors.length < 1) problems.push('company_one_director');
			if (!profile.cin) problems.push('cin_needed');
			break;
		case 'private_limited':
			if (profile.directors.length < 2) problems.push('company_two_directors');
			if (!profile.cin) problems.push('cin_needed');
			break;
	}
	if (
		(profile.kind === 'private_limited' || profile.kind === 'private_limited_opc') &&
		profile.paidUpCapitalINR > profile.authorisedCapitalINR
	)
		problems.push('paid_up_over_authorised');
	return problems;
}

/** What changes with the kind of business (CT6), as the screens and the books read it. */
export interface KindEffects {
	ownersAccounts: 'capital_and_drawings' | 'partner_capital_and_current' | 'share_capital_and_reserves';
	statements: 'non_corporate' | 'llp' | 'schedule_iii';
	depreciationBooks: readonly ('companies_act' | 'income_tax')[];
	incomeTaxReturn: 'ITR-3' | 'ITR-5' | 'ITR-6';
	companiesActAuditTrail: boolean;
	ownersPaidAs: 'drawings' | 'interest_and_remuneration' | 'salary_or_fees';
}

export function kindEffects(kind: BusinessKind): KindEffects {
	switch (kind) {
		case 'proprietorship':
			return {
				ownersAccounts: 'capital_and_drawings',
				statements: 'non_corporate',
				depreciationBooks: ['income_tax'],
				incomeTaxReturn: 'ITR-3',
				companiesActAuditTrail: false,
				ownersPaidAs: 'drawings',
			};
		case 'partnership':
			return {
				ownersAccounts: 'partner_capital_and_current',
				statements: 'non_corporate',
				depreciationBooks: ['income_tax'],
				incomeTaxReturn: 'ITR-5',
				companiesActAuditTrail: false,
				ownersPaidAs: 'interest_and_remuneration',
			};
		case 'llp':
			return {
				ownersAccounts: 'partner_capital_and_current',
				statements: 'llp',
				depreciationBooks: ['income_tax'],
				incomeTaxReturn: 'ITR-5',
				companiesActAuditTrail: false,
				ownersPaidAs: 'interest_and_remuneration',
			};
		case 'private_limited_opc':
		case 'private_limited':
			return {
				ownersAccounts: 'share_capital_and_reserves',
				statements: 'schedule_iii',
				depreciationBooks: ['companies_act', 'income_tax'],
				incomeTaxReturn: 'ITR-6',
				companiesActAuditTrail: true,
				ownersPaidAs: 'salary_or_fees',
			};
	}
}

/**
 * The most a firm may deduct as working partners' remuneration (Income Tax s.40(b)(v), as amended
 * from 2024-25): on book profit up to ₹6,00,000 (or a loss) the higher of ₹3,00,000 or 90%; on
 * the rest 60%. Book profit is taken after interest to partners. Totals all working partners.
 */
export function partnerRemunerationLimitINR(bookProfitINR: number): number {
	if (bookProfitINR <= 0) return 300_000;
	const first = Math.min(bookProfitINR, 600_000);
	const rest = Math.max(0, bookProfitINR - 600_000);
	return Math.round(Math.max(300_000, first * 0.9) + rest * 0.6);
}

/** Interest on a partner's capital that the tax rules allow (at most 12% simple). */
export const PARTNER_INTEREST_CAP_PERCENT = 12;

/** The partnership's year-end appropriation (CT7): interest, remuneration as agreed, then the rest in the ratio. */
export interface Appropriation {
	partners: { id: string; interestINR: number; remunerationINR: number; shareINR: number; toCurrentINR: number }[];
	remunerationLimitINR: number;
	remunerationDisallowedINR: number;
	interestDisallowedINR: number;
}

export function appropriate(profile: Pick<CompanyProfile, 'partners'>, profitBeforePartnersINR: number): Appropriation {
	const partners = profile.partners;
	const interest = partners.map((partner) =>
		twoDecimals((partner.capitalINR * partner.interestOnCapitalPercent) / 100),
	);
	const interestTotal = interest.reduce((sum, value) => sum + value, 0);
	const allowedInterest = partners.reduce(
		(sum, partner) =>
			sum + (partner.capitalINR * Math.min(partner.interestOnCapitalPercent, PARTNER_INTEREST_CAP_PERCENT)) / 100,
		0,
	);
	const remuneration = partners.map((partner) => (partner.working ? partner.monthlyRemunerationINR * 12 : 0));
	const remunerationTotal = remuneration.reduce((sum, value) => sum + value, 0);
	const limit = partnerRemunerationLimitINR(profitBeforePartnersINR - allowedInterest);
	const rest = twoDecimals(profitBeforePartnersINR - interestTotal - remunerationTotal);
	return {
		partners: partners.map((partner, index) => {
			const share = twoDecimals((rest * partner.profitSharePercent) / 100);
			// Both lists are `partners` mapped one for one.
			const interestINR = interest[index] as number;
			const remunerationINR = remuneration[index] as number;
			return {
				id: partner.id,
				interestINR,
				remunerationINR,
				shareINR: share,
				toCurrentINR: twoDecimals(interestINR + remunerationINR + share),
			};
		}),
		remunerationLimitINR: limit,
		remunerationDisallowedINR: Math.max(0, remunerationTotal - limit),
		interestDisallowedINR: twoDecimals(interestTotal - allowedInterest),
	};
}

/** States with the lower ₹75 lakh composition limit (special category). */
export const COMPOSITION_LOWER_LIMIT_STATES: ReadonlySet<string> = new Set([
	'12',
	'13',
	'14',
	'15',
	'16',
	'17',
	'11',
	'05',
]);

/** What last year's turnover sets for a registration (G1); the owner or the CA confirms each April. */
export function turnoverChecks(turnoverINR: number, stateCode: string) {
	const crore = 10_000_000;
	return {
		eInvoice: turnoverINR > 5 * crore,
		eInvoiceThirtyDays: turnoverINR >= 10 * crore,
		annualReturn: turnoverINR > 2 * crore,
		reconciliationStatement: turnoverINR > 5 * crore,
		hsnDigits: (turnoverINR > 5 * crore ? 6 : 4) as 4 | 6,
		qrmpAllowed: turnoverINR <= 5 * crore,
		compositionAllowed: turnoverINR <= (COMPOSITION_LOWER_LIMIT_STATES.has(stateCode) ? 7_500_000 : 15_000_000),
	};
}

export type TermsProblem =
	| 'qrmp_over_limit'
	| 'composition_over_limit'
	| 'composition_rate_needed'
	| 'isd_monthly_only'
	| 'dates_out_of_order';

export function termsProblems(terms: GstRegistrationTerms, stateCode: string): TermsProblem[] {
	const problems: TermsProblem[] = [];
	const checks = turnoverChecks(terms.lastYearTurnoverINR, stateCode);
	if (terms.scheme === 'qrmp' && !checks.qrmpAllowed) problems.push('qrmp_over_limit');
	if (terms.kind === 'composition' && !checks.compositionAllowed) problems.push('composition_over_limit');
	if (terms.kind === 'composition' && terms.compositionRatePercent === null) problems.push('composition_rate_needed');
	if (terms.kind === 'isd' && terms.scheme !== 'monthly') problems.push('isd_monthly_only');
	return problems;
}

/** The terms in force on a day: the newest version starting on or before it. */
export function termsOn(registration: Pick<GstRegistration, 'terms'>, day: string): GstRegistrationTerms | null {
	return (
		[...registration.terms].sort((a, b) => (a.from < b.from ? 1 : -1)).find((terms) => terms.from <= day) ?? null
	);
}

/** Switches that need another on first (J3). */
export const FEATURE_NEEDS: Readonly<Partial<Record<FeatureKey, readonly FeatureKey[]>>> = {
	stores: ['locations'],
	pf: ['payroll'],
	esi: ['payroll'],
	bonus: ['payroll'],
	gratuity: ['payroll'],
	lwf: ['payroll'],
};

export type SwitchRefusal =
	{ key: FeatureKey; reason: 'in_use'; count: number } | { key: FeatureKey; reason: 'needs'; needs: FeatureKey };

/** Why a change to the switches is refused: off while records use it, or on without what it needs. */
export function switchRefusals(
	next: Partial<Record<FeatureKey, boolean>>,
	current: Partial<Record<FeatureKey, boolean>>,
	inUse: Partial<Record<FeatureKey, number>>,
): SwitchRefusal[] {
	const refusals: SwitchRefusal[] = [];
	for (const [key, on] of Object.entries(next) as [FeatureKey, boolean][]) {
		const count = inUse[key] ?? 0;
		if (!on && current[key] && count > 0) refusals.push({ key, reason: 'in_use', count });
		if (on)
			for (const need of FEATURE_NEEDS[key] ?? [])
				if (!(next[need] ?? current[need])) refusals.push({ key, reason: 'needs', needs: need });
	}
	return refusals;
}
