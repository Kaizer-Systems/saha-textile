/**
 * Payslips edited line by line before publishing (brief 26 PE2; approved 2026-11-26). Pure. A payslip is worked out
 * from its lines: each head earned (by the rules, or typed over), lines added in any section, and the deductions
 * worked from them (PF on the PF wages, ESI on the gross, professional tax by the State, TDS and the advance as the
 * run set them) unless typed over themselves. Paise throughout.
 */

import {
	codeWages,
	CODE_WAGE_HEADS,
	BASIC_DA_HEADS,
	type PayrollRules,
	type SalaryStructure,
	type WageHead,
} from './payroll-rules';

/** PE2: what a line added to a payslip is. */
export type AddedLineKind =
	'taxable' | 'exempt' | 'reimbursement' | 'arrears' | 'after_tax' | 'before_tax' | 'tax_adjustment';

export interface AddedLine {
	id: string;
	kind: AddedLineKind;
	name: string;
	paise: number;
	/** One-off lines are never carried into the salary (PE-D3). */
	oneOff: boolean;
}

/** The deductions that can be typed over. */
export type DeductionKey = 'pf' | 'esi' | 'pt' | 'tds' | 'advance';

export interface PayslipEdits {
	heads: Partial<Record<WageHead, number>>;
	added: AddedLine[];
	deductions: Partial<Record<DeductionKey, number>>;
	/** Why each line typed over was changed, by its key (a head or a deduction). */
	reasons: Partial<Record<string, string>>;
}

export const NO_EDITS: PayslipEdits = { heads: {}, added: [], deductions: {}, reasons: {} };

const HEADS: readonly WageHead[] = ['basic', 'da', 'hra', 'conveyance', 'special', 'other'];
const EARNING_KINDS: readonly AddedLineKind[] = ['taxable', 'exempt', 'arrears'];
const rupee = (paise: number) => Math.round(paise / 100) * 100;
const rupeeUp = (paise: number) => Math.ceil(paise / 100) * 100;

export interface PayslipLines {
	heads: Record<WageHead, number>;
	grossPaise: number;
	pfWagesPaise: number;
	pfEmployeePaise: number;
	pfEmployerPaise: number;
	epsPaise: number;
	esiEmployeePaise: number;
	esiEmployerPaise: number;
	ptPaise: number;
	tdsPaise: number;
	advancePaise: number;
	/** What the law asks for PF and ESI on the pay as edited, whatever was typed. */
	lawPfPaise: number;
	lawEsiPaise: number;
	/** Added deductions (after or before tax, tax adjustments), and reimbursements paid beside the wages. */
	otherDeductionsPaise: number;
	reimbursementsPaise: number;
	netPaise: number;
}

/**
 * PE2: a payslip from its lines. The heads earned are the rules' unless typed over; added earnings join the gross
 * (reimbursements are paid beside it, outside the wages); PF, ESI and professional tax are worked from them as the run
 * works them, and TDS and the advance stay as the run set them, each unless typed over.
 */
export function payslipFromLines(input: {
	rulesHeads: Record<WageHead, number>;
	edits: PayslipEdits;
	pfOn: boolean;
	esiOn: boolean;
	rules: PayrollRules;
	ptFor: (grossPaise: number) => number;
	tdsPaise: number;
	advancePaise: number;
}): PayslipLines {
	const { edits, rules: r } = input;
	const heads = { ...input.rulesHeads };
	for (const h of HEADS) if (edits.heads[h] !== undefined) heads[h] = edits.heads[h] as number;
	const added = (kinds: readonly AddedLineKind[]) =>
		edits.added.filter((l) => kinds.includes(l.kind)).reduce((sum, l) => sum + l.paise, 0);
	const grossPaise = HEADS.reduce((sum, h) => sum + heads[h], 0) + added(EARNING_KINDS);
	const pfHeads = r.pfUsesCodeWages ? (r.wageHeads ?? CODE_WAGE_HEADS) : BASIC_DA_HEADS;
	const pfWagesPaise = codeWages(heads as SalaryStructure, pfHeads) + added(['arrears']);
	const pfBase = Math.min(pfWagesPaise, r.pfWageCapPaise);
	const ruled = {
		pf: input.pfOn ? rupee((pfBase * r.pfRatePct) / 100) : 0,
		esi:
			input.esiOn && grossPaise > 0 && grossPaise <= r.esiGrossLimitPaise
				? rupeeUp((grossPaise * r.esiEmployeePct) / 100)
				: 0,
		pt: grossPaise > 0 ? input.ptFor(grossPaise) : 0,
		tds: input.tdsPaise,
		advance: input.advancePaise,
	};
	const take = (k: DeductionKey) => edits.deductions[k] ?? ruled[k];
	const esiDue = ruled.esi > 0;
	const otherDeductionsPaise = added(['after_tax', 'before_tax', 'tax_adjustment']);
	const reimbursementsPaise = added(['reimbursement']);
	const deductions = take('pf') + take('esi') + take('pt') + take('tds') + take('advance') + otherDeductionsPaise;
	return {
		heads,
		grossPaise,
		pfWagesPaise,
		pfEmployeePaise: take('pf'),
		pfEmployerPaise: input.pfOn ? rupee((pfBase * r.pfRatePct) / 100) : 0,
		epsPaise: input.pfOn ? Math.min(rupee((pfBase * r.epsRatePct) / 100), r.epsCapPaise) : 0,
		esiEmployeePaise: take('esi'),
		esiEmployerPaise: esiDue ? rupeeUp((grossPaise * r.esiEmployerPct) / 100) : 0,
		lawPfPaise: ruled.pf,
		lawEsiPaise: ruled.esi,
		ptPaise: take('pt'),
		tdsPaise: take('tds'),
		advancePaise: take('advance'),
		otherDeductionsPaise,
		reimbursementsPaise,
		netPaise: grossPaise - deductions + reimbursementsPaise,
	};
}

/** PE-D2: a check on an edited payslip: blocking ones stop publishing, the rest warn. */
export interface PayslipCheck {
	code:
		| 'net_below_zero'
		| 'deductions_over_half'
		| 'pf_below_law'
		| 'esi_below_law'
		| 'tds_lowered_without_reason'
		| 'reason_needed'
		| 'pt_off_slab'
		| 'below_minimum_wage';
	blocking: boolean;
	/** The line it is about, when there is one. */
	line?: string;
}

/**
 * PE-D2: what blocks publishing (net below nothing; deductions above half the wages, Code on Wages s.18; PF or ESI
 * typed below what the law asks; TDS lowered without a reason) and what only warns (a line changed without a reason,
 * professional tax off the slab, pay under the State's minimum wage).
 */
export function payslipChecks(input: {
	edited: PayslipLines;
	byRules: PayslipLines;
	edits: PayslipEdits;
	ptFor: (grossPaise: number) => number;
	minimumWageShortfallPaise: number;
}): PayslipCheck[] {
	const { edited, byRules, edits } = input;
	const out: PayslipCheck[] = [];
	if (edited.netPaise < 0) out.push({ code: 'net_below_zero', blocking: true });
	const wages = edited.grossPaise;
	const deducted = edited.grossPaise + edited.reimbursementsPaise - edited.netPaise;
	if (wages > 0 && deducted * 2 > wages) out.push({ code: 'deductions_over_half', blocking: true });
	// PF or ESI typed below what the law asks on the pay as edited is refused.
	if (edited.pfEmployeePaise < edited.lawPfPaise) out.push({ code: 'pf_below_law', blocking: true, line: 'pf' });
	if (edited.esiEmployeePaise < edited.lawEsiPaise) out.push({ code: 'esi_below_law', blocking: true, line: 'esi' });
	if (edits.deductions.tds !== undefined && edits.deductions.tds < byRules.tdsPaise && !edits.reasons['tds']?.trim())
		out.push({ code: 'tds_lowered_without_reason', blocking: true, line: 'tds' });
	for (const key of [...Object.keys(edits.heads), ...Object.keys(edits.deductions)])
		if (key !== 'tds' && !edits.reasons[key]?.trim())
			out.push({ code: 'reason_needed', blocking: false, line: key });
	if (edited.ptPaise !== (edited.grossPaise > 0 ? input.ptFor(edited.grossPaise) : 0))
		out.push({ code: 'pt_off_slab', blocking: false, line: 'pt' });
	if (input.minimumWageShortfallPaise > 0) out.push({ code: 'below_minimum_wage', blocking: false });
	return out;
}
