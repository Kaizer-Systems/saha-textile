import type { StateRules } from './state-rules';

// The admin's payroll rules page reads these through the `payroll-rules` subpath, with the year's-most check.
export { PT_YEAR_CAP_PAISE, ptYearMost, type PtSlab, type StateRules } from './state-rules';

/**
 * Brief 26 PT4 (approved 2026-11-25, decision PT-D1): the professional tax sets "Add a State" can start from. They are
 * starting data, copied into a payroll-rules version and edited there like anything typed; nothing reads them at run
 * time. Each names its source and what the CA still has to confirm. Money in paise.
 */
export interface PtStartingSet {
	stateCode: string;
	/** Shown in "Start from". */
	label: string;
	/** In force from, by the source. */
	from: string;
	/** What to confirm before relying on it. */
	check: string;
	rules: Omit<StateRules, 'stateCode' | 'lwfEmployeePaise' | 'lwfEmployerPaise' | 'lwfMonths' | 'lwfDueDay'>;
}

const rupees = (n: number) => n * 100;

export const PT_STARTING_SETS: readonly PtStartingSet[] = [
	{
		stateCode: '19',
		label: 'West Bengal',
		from: '2026-04-01',
		check: 'Slabs as kept since the first version; confirm with the current schedule.',
		rules: {
			ptFrequency: 'monthly',
			ptSlabs: [
				{ upToPaise: rupees(10_000), taxPaise: 0 },
				{ upToPaise: rupees(15_000), taxPaise: rupees(110) },
				{ upToPaise: rupees(25_000), taxPaise: rupees(130) },
				{ upToPaise: rupees(40_000), taxPaise: rupees(150) },
				{ upToPaise: null, taxPaise: rupees(200) },
			],
			ptMonths: [],
			ptDueDay: 21,
		},
	},
	{
		stateCode: '27',
		label: 'Maharashtra',
		from: '2025-04-01',
		check: 'The month of the ₹300 (most sources: February; one: March), and the exempt categories.',
		rules: {
			ptFrequency: 'monthly',
			ptSlabs: [
				{ upToPaise: rupees(7_500), taxPaise: 0 },
				{ upToPaise: rupees(10_000), taxPaise: rupees(175) },
				{ upToPaise: null, taxPaise: rupees(200), otherMonth: { month: 2, taxPaise: rupees(300) } },
			],
			ptWomenSlabs: [
				{ upToPaise: rupees(25_000), taxPaise: 0 },
				{ upToPaise: null, taxPaise: rupees(200), otherMonth: { month: 2, taxPaise: rupees(300) } },
			],
			ptMonths: [],
			ptDueDay: 31,
			ptExemptFromAge: 65,
			ptExemptDisability: true,
		},
	},
	{
		stateCode: '29',
		label: 'Karnataka',
		from: '2025-04-01',
		check: 'Amendment Act 2025, notified 15 Apr 2025.',
		rules: {
			ptFrequency: 'monthly',
			ptSlabs: [
				{ upToPaise: rupees(24_999.99), taxPaise: 0 },
				{ upToPaise: null, taxPaise: rupees(200), otherMonth: { month: 2, taxPaise: rupees(300) } },
			],
			ptMonths: [],
			ptDueDay: 20,
		},
	},
	{
		stateCode: '33',
		label: 'Tamil Nadu (the shape; enter the local body’s slabs)',
		from: '2025-04-01',
		check: 'Slabs differ by corporation or municipality; enter the one the location is in.',
		rules: {
			ptFrequency: 'half_yearly',
			ptBasis: 'actual',
			ptSlabs: [{ upToPaise: null, taxPaise: 0 }],
			ptMonths: [9, 3],
			ptDueDay: 30,
		},
	},
];

/** The sets a State can start from (PT4); none for a State without one, which starts blank. */
export function ptStartingSetsFor(stateCode: string): PtStartingSet[] {
	return PT_STARTING_SETS.filter((s) => s.stateCode === stateCode);
}
