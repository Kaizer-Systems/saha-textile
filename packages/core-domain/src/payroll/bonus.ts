/**
 * Statutory bonus (brief 25 BN1; approved 2026-11-25). Pure. The Payment of Bonus Act 1965 as amended in 2015: it
 * applies once the headcount reaches the rules' figure; it covers people whose basic and DA are at most ₹21,000 a
 * month; bonus wages count at most ₹7,000 a month (or the State's minimum wage, the higher, entered as the ceiling);
 * the bonus is 8.33% to 20% of them, at least ₹100 a year, for someone who worked at least 30 days in the year. The
 * Code on Wages 2019 (Chapter IV) carries the same figures; the CA confirms which law a year falls under. Every figure
 * is from the dated rules. Money is paise.
 */

export interface BonusRules {
	ratePct: number;
	wageCeilingPaise: number;
	eligibleUpToPaise: number;
	minimumPaise: number;
	provision: 'monthly' | 'year_end';
	/** Brief 26 BN2: the law the version works under; set by its date when absent (`bonusRulesOn`). */
	law?: 'code_on_wages' | 'bonus_act';
	/** BN2: bonus wages as the Code defines wages (`code`), or basic and DA (the Act's reading). */
	wageBasis?: 'code' | 'basic_da';
	/** BN2: days worked in the year to qualify (30 when absent). */
	minDays?: number;
}

export const BONUS_2026: BonusRules = {
	ratePct: 8.33,
	wageCeilingPaise: 7_000_00,
	eligibleUpToPaise: 21_000_00,
	minimumPaise: 100_00,
	provision: 'monthly',
	law: 'code_on_wages',
	wageBasis: 'code',
	minDays: 30,
};

/** The day the Code on Wages 2019 replaced the Payment of Bonus Act (all four Codes in force). */
export const CODE_ON_WAGES_FROM = '2025-11-21';

/**
 * BN-D2: a version's bonus law and wage basis follow its date when it doesn't set them: the Code and its wages from
 * 21 Nov 2025, the Act and basic and DA before; qualifying days 30.
 */
export function bonusRulesOn(rules: BonusRules, from: string): BonusRules {
	const code = from >= CODE_ON_WAGES_FROM;
	return {
		...rules,
		law: rules.law ?? (code ? 'code_on_wages' : 'bonus_act'),
		wageBasis: rules.wageBasis ?? (code ? 'code' : 'basic_da'),
		minDays: rules.minDays ?? BONUS_MIN_DAYS,
	};
}

/**
 * A month's bonus wages: the wages earned (the Code's wages, or basic and DA, by the rules' basis), at most the
 * ceiling for the days paid; nothing for someone whose full month's wages pass the limit.
 */
export function bonusWages(
	input: {
		basicDaPaise: number;
		fullBasicDaPaise: number;
		paidDays: number;
		daysInMonth: number;
		/** BN2: the month's wages as the Code defines them, earned and for a full month. */
		codeWagesPaise?: number;
		fullCodeWagesPaise?: number;
	},
	rules: BonusRules,
): number {
	const code = rules.wageBasis === 'code';
	const earned = code ? (input.codeWagesPaise ?? input.basicDaPaise) : input.basicDaPaise;
	const full = code ? (input.fullCodeWagesPaise ?? input.fullBasicDaPaise) : input.fullBasicDaPaise;
	if (full > rules.eligibleUpToPaise || input.daysInMonth <= 0) return 0;
	const ceiling = (rules.wageCeilingPaise * Math.min(input.paidDays, input.daysInMonth)) / input.daysInMonth;
	return Math.round(Math.min(earned, ceiling));
}

/** The bonus on some wages at the rules' rate. */
export function bonusOn(wagesPaise: number, rules: BonusRules): number {
	return Math.round((wagesPaise * rules.ratePct) / 100);
}

/**
 * The working days in a year that earn bonus at all: s.8 of the Payment of Bonus Act (s.26(1) of the Code on Wages
 * 2019 keeps it). Counted as the days paid in the year's runs.
 */
export const BONUS_MIN_DAYS = 30;

/**
 * The year's bonus the Act asks for: the rate on the year's wages, at least the minimum; nothing without wages or for
 * someone who worked fewer than 30 days in the year.
 */
export function bonusDue(yearWagesPaise: number, rules: BonusRules, daysWorked: number): number {
	if (yearWagesPaise <= 0 || daysWorked < (rules.minDays ?? BONUS_MIN_DAYS)) return 0;
	return Math.max(bonusOn(yearWagesPaise, rules), rules.minimumPaise);
}
