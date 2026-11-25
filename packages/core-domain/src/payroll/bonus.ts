/**
 * Statutory bonus (brief 25 BN1; approved 2026-11-25). Pure. The Payment of Bonus Act 1965 as amended in 2015: it
 * applies once the headcount reaches the rules' figure; it covers people whose basic and DA are at most ₹21,000 a
 * month; bonus wages count at most ₹7,000 a month (or the State's minimum wage, the higher, entered as the ceiling);
 * the bonus is 8.33% to 20% of them, at least ₹100 a year. Every figure is from the dated rules. Money is paise.
 */

export interface BonusRules {
	ratePct: number;
	wageCeilingPaise: number;
	eligibleUpToPaise: number;
	minimumPaise: number;
	provision: 'monthly' | 'year_end';
}

export const BONUS_2026: BonusRules = {
	ratePct: 8.33,
	wageCeilingPaise: 7_000_00,
	eligibleUpToPaise: 21_000_00,
	minimumPaise: 100_00,
	provision: 'monthly',
};

/**
 * A month's bonus wages: basic and DA earned, at most the ceiling for the days paid; nothing for someone whose full
 * month's basic and DA pass the limit.
 */
export function bonusWages(
	input: { basicDaPaise: number; fullBasicDaPaise: number; paidDays: number; daysInMonth: number },
	rules: BonusRules,
): number {
	if (input.fullBasicDaPaise > rules.eligibleUpToPaise || input.daysInMonth <= 0) return 0;
	const ceiling = (rules.wageCeilingPaise * Math.min(input.paidDays, input.daysInMonth)) / input.daysInMonth;
	return Math.round(Math.min(input.basicDaPaise, ceiling));
}

/** The bonus on some wages at the rules' rate. */
export function bonusOn(wagesPaise: number, rules: BonusRules): number {
	return Math.round((wagesPaise * rules.ratePct) / 100);
}

/** The year's bonus the Act asks for: the rate on the year's wages, at least the minimum (nothing without wages). */
export function bonusDue(yearWagesPaise: number, rules: BonusRules): number {
	return yearWagesPaise > 0 ? Math.max(bonusOn(yearWagesPaise, rules), rules.minimumPaise) : 0;
}
