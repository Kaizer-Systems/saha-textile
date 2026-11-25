import { Component, computed, inject, signal, type TemplateRef } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { GST_STATES } from '@saha-textile/core-domain/company';
import {
	CODE_ON_WAGES_FROM,
	CODE_WAGE_HEADS,
	HEALTH_126_2026,
	PT_YEAR_CAP_PAISE,
	RENT_CITIES_2026,
	ptStartingSetsFor,
	ptYearMost,
	WEST_BENGAL_LEAVE,
	creditSoFar,
	type LeaveRule as CoreLeaveRule,
	type PtSlab,
	type PtStartingSet,
	type WageHead,
} from '@saha-textile/core-domain/payroll-rules';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { PAYROLL_KEYS, PayrollGateway } from '@core/accounts/payroll.gateway';
import { LOCATION_KEYS, LocationsGateway } from '@core/locations/locations.gateway';
import { apiProblem, shortDate } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';

import type {
	BonusRules,
	Holiday,
	IncomeTaxRules,
	PayrollRulesVersion,
	PayrollRulesWriteInput,
	PtBasis,
	PtFrequency,
	StatePayrollRules,
	StoreShift,
} from '@saha-textile/contracts';

const inr = (paise: number) => paise / 100;
const paise = (rupees: number) => Math.round(rupees * 100);
const num = (n: number) => n.toLocaleString('en-IN');

/** A slab in the form, in rupees, with its one differing month (brief 26 PT1; null for none). */
export interface SlabForm {
	upTo: number | null;
	tax: number;
	otherMonth: number | null;
	otherTax: number;
}

/** Which slab list a slab action works on (PT1: everyone's, or the women's). */
export type SlabList = 'ptSlabs' | 'ptWomenSlabs';

/** A State's professional tax and welfare fund in the form (brief 25 ST1), money in rupees, months as "6, 12". */
/** SR4: the skill levels a State's minimum wages are set by. */
export const SKILL_LEVELS = ['unskilled', 'semi_skilled', 'skilled', 'highly_skilled'] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];

/** SR4: one set of minimum wages in the form: its date, and rupees a month per level (null: none set). */
export interface WageSetForm {
	from: string;
	levels: Record<SkillLevel, number | null>;
}

export interface StateForm {
	stateCode: string;
	ptFrequency: PtFrequency;
	ptSlabs: SlabForm[];
	/** PT1: separate slabs for women, and their list. */
	ptWomen: boolean;
	ptWomenSlabs: SlabForm[];
	/** PT2: what a half-yearly or yearly tax is worked on. */
	ptBasis: PtBasis;
	/** PT1: the age from which the tax stops (null: none), and the disability exemption. */
	ptExemptAge: number | null;
	ptExemptDisability: boolean;
	/** Brief 26 LV1: the State's leave types, as the contract holds them (edited in the leave rule editor). */
	leaveTypes: NonNullable<StatePayrollRules['leaveTypes']>;
	/** Brief 26 LV1, AT2: the State's holidays, for every store in it (null) or one. */
	holidays: Holiday[];
	/** Brief 26 SR4: the State's minimum wages a month by skill level, in rupees, each set from its notification's date. */
	minimumWages: WageSetForm[];
	ptMonths: string;
	ptDueDay: number;
	lwfEmployee: number;
	lwfEmployer: number;
	lwfMonths: string;
	lwfDueDay: number;
}

/** The State whose set an older version's company-wide figures are. */
const LEGACY_STATE = '19';

/** "6, 12" → [6, 12]; anything not a month left out. */
export function monthList(text: string): number[] {
	return text
		.split(',')
		.map((m) => Number(m.trim()))
		.filter((m) => Number.isInteger(m) && m >= 1 && m <= 12);
}

/** A version's State sets: its own, or one from the company-wide figures of an older version. */
export function statesOf(v: PayrollRulesVersion): StatePayrollRules[] {
	if (v.states?.length) return v.states;
	return [
		{
			stateCode: LEGACY_STATE,
			ptFrequency: 'monthly',
			ptSlabs: v.ptSlabs,
			ptMonths: [],
			ptDueDay: v.ptDueDay,
			lwfEmployeePaise: v.lwfEmployeePaise,
			lwfEmployerPaise: v.lwfEmployerPaise,
			lwfMonths: v.lwfMonths,
			lwfDueDay: v.lwfDueDay,
		},
	];
}

type SlabWrite = StatePayrollRules['ptSlabs'][number];

export function slabToForm(x: SlabWrite): SlabForm {
	return {
		upTo: x.upToPaise === null ? null : inr(x.upToPaise),
		tax: inr(x.taxPaise),
		otherMonth: x.otherMonth?.month ?? null,
		otherTax: x.otherMonth ? inr(x.otherMonth.taxPaise) : 0,
	};
}

/** A slab in paise; its differing month only when it has one, so a plain slab is written as before. */
export function slabToWrite(x: SlabForm): SlabWrite {
	return {
		upToPaise: x.upTo === null ? null : paise(x.upTo),
		taxPaise: paise(x.tax),
		...(x.otherMonth ? { otherMonth: { month: x.otherMonth, taxPaise: paise(x.otherTax) } } : {}),
	};
}

/** PT1: the State as typed, as the core's year's-most check reads it. */
export function yearMostOf(st: StateForm): number {
	const w = stateToWrite(st);
	const slab = (x: SlabWrite): PtSlab => ({
		upToPaise: x.upToPaise ?? null,
		taxPaise: x.taxPaise,
		otherMonth: x.otherMonth ?? null,
	});
	return ptYearMost({
		stateCode: w.stateCode,
		ptFrequency: w.ptFrequency,
		ptSlabs: w.ptSlabs.map(slab),
		ptWomenSlabs: (w.ptWomenSlabs ?? []).map(slab),
		ptMonths: [...w.ptMonths],
		ptDueDay: w.ptDueDay,
		lwfEmployeePaise: 0,
		lwfEmployerPaise: 0,
		lwfMonths: [],
		lwfDueDay: w.lwfDueDay,
	});
}

/** PT4: a State's form from a starting set, or blank (no tax until its slabs are entered). */
export function startingForm(stateCode: string, start: PtStartingSet | undefined): StateForm {
	const slab = (x: PtSlab): SlabForm => ({
		upTo: x.upToPaise === null ? null : inr(x.upToPaise),
		tax: inr(x.taxPaise),
		otherMonth: x.otherMonth?.month ?? null,
		otherTax: x.otherMonth ? inr(x.otherMonth.taxPaise) : 0,
	});
	const rules = start?.rules;
	return {
		stateCode,
		ptFrequency: rules?.ptFrequency ?? 'monthly',
		ptSlabs: rules ? rules.ptSlabs.map(slab) : [{ upTo: null, tax: 0, otherMonth: null, otherTax: 0 }],
		ptWomen: !!rules?.ptWomenSlabs?.length,
		ptWomenSlabs: (rules?.ptWomenSlabs ?? []).map(slab),
		ptBasis: rules?.ptBasis ?? 'projected',
		ptExemptAge: rules?.ptExemptFromAge ?? null,
		ptExemptDisability: rules?.ptExemptDisability ?? false,
		leaveTypes: [],
		holidays: [],
		minimumWages: [],
		ptMonths: (rules?.ptMonths ?? []).join(', '),
		ptDueDay: rules?.ptDueDay ?? 21,
		lwfEmployee: 0,
		lwfEmployer: 0,
		lwfMonths: '',
		lwfDueDay: 15,
	};
}

export function stateToForm(s: StatePayrollRules): StateForm {
	return {
		stateCode: s.stateCode,
		ptFrequency: s.ptFrequency,
		ptSlabs: s.ptSlabs.map(slabToForm),
		ptWomen: !!s.ptWomenSlabs?.length,
		ptWomenSlabs: (s.ptWomenSlabs ?? []).map(slabToForm),
		ptBasis: s.ptBasis ?? 'projected',
		ptExemptAge: s.ptExemptFromAge ?? null,
		ptExemptDisability: s.ptExemptDisability ?? false,
		leaveTypes: (s.leaveTypes ?? []).map((t) => structuredClone(t)),
		holidays: (s.holidays ?? []).map((h) => ({ ...h })),
		minimumWages: (s.minimumWages ?? []).map((w) => ({
			from: w.from,
			levels: Object.fromEntries(
				SKILL_LEVELS.map((l) => [l, w.levels[l] === undefined ? null : inr(w.levels[l] as number)]),
			) as WageSetForm['levels'],
		})),
		ptMonths: s.ptMonths.join(', '),
		ptDueDay: s.ptDueDay,
		lwfEmployee: inr(s.lwfEmployeePaise),
		lwfEmployer: inr(s.lwfEmployerPaise),
		lwfMonths: s.lwfMonths.join(', '),
		lwfDueDay: s.lwfDueDay,
	};
}

export function stateToWrite(s: StateForm): StatePayrollRules {
	return {
		stateCode: s.stateCode,
		ptFrequency: s.ptFrequency,
		ptSlabs: s.ptFrequency === 'none' ? [] : s.ptSlabs.map(slabToWrite),
		// Brief 26 PT1, PT2: written only when set, so a State without them is saved as before.
		...(s.ptFrequency !== 'none' && s.ptWomen ? { ptWomenSlabs: s.ptWomenSlabs.map(slabToWrite) } : {}),
		...(s.ptBasis === 'actual' ? { ptBasis: s.ptBasis } : {}),
		...(s.ptExemptAge ? { ptExemptFromAge: s.ptExemptAge } : {}),
		...(s.ptExemptDisability ? { ptExemptDisability: true } : {}),
		...(s.leaveTypes.length ? { leaveTypes: s.leaveTypes } : {}),
		...(s.holidays.length ? { holidays: s.holidays } : {}),
		...(s.minimumWages.length
			? {
					minimumWages: s.minimumWages.map((w) => ({
						from: w.from,
						levels: Object.fromEntries(
							SKILL_LEVELS.flatMap((l) => {
								const v = w.levels[l];
								return v === null ? [] : [[l, paise(v)]];
							}),
						),
					})),
				}
			: {}),
		ptMonths: s.ptFrequency === 'half_yearly' || s.ptFrequency === 'yearly' ? monthList(s.ptMonths) : [],
		ptDueDay: s.ptDueDay,
		lwfEmployeePaise: paise(s.lwfEmployee),
		lwfEmployerPaise: paise(s.lwfEmployer),
		lwfMonths: monthList(s.lwfMonths),
		lwfDueDay: s.lwfDueDay,
	};
}

/** A State's name from its GST code. */
export function stateName(code: string): string {
	return GST_STATES.find((s) => s.code === code)?.name ?? code;
}

export type SlabGroup = 'newSlabs' | 'oldSlabsBelow60' | 'oldSlabs60To79' | 'oldSlabs80Plus';
export type TierGroup = 'newSurcharge' | 'oldSurcharge';
export const SLAB_GROUPS: SlabGroup[] = ['newSlabs', 'oldSlabsBelow60', 'oldSlabs60To79', 'oldSlabs80Plus'];
export const TIER_GROUPS: TierGroup[] = ['newSurcharge', 'oldSurcharge'];

/** TX2: income tax in the form, money in rupees; a slab with an empty "up to" is the open top slab. */
export interface IncomeTaxForm {
	slabs: Record<SlabGroup, { upTo: number | null; rate: number }[]>;
	tiers: Record<TierGroup, { over: number; rate: number }[]>;
	newStandard: number;
	newRebateUpTo: number;
	oldStandard: number;
	oldRebateUpTo: number;
	oldRebateMax: number;
	cessPct: number;
	limit80c: number;
	limit80d: number;
	limitHomeLoan: number;
	proofFromMonth: number;
	/** Brief 26 TX4: section 126's limits in rupees, the rounding, and the cities where rent counts at 50%. */
	health: { self: number; selfSenior: number; parents: number; parentsSenior: number; checkup: number };
	/** Brief 26 TX3: whether an uninsured senior's medical bills count, in each group (the law: both). */
	seniorMedical: { self: boolean; parents: boolean };
	rounding: 'ten' | 'rupee';
	rentCities: string[];
}

/** TX4: the rounding choices, the law's first (section 516). */
export const ROUNDINGS = ['ten', 'rupee'] as const;

export function taxToForm(t: IncomeTaxRules): IncomeTaxForm {
	const slabs = (list: IncomeTaxRules['newSlabs']) =>
		list.map((x) => ({ upTo: x.upToPaise === null ? null : inr(x.upToPaise), rate: x.ratePct }));
	const tiers = (list: IncomeTaxRules['newSurcharge']) =>
		list.map((x) => ({ over: inr(x.overPaise), rate: x.ratePct }));
	// A version saved before section 126's groups starts from the built-in limits.
	const h = t.health126 ?? HEALTH_126_2026;
	return {
		slabs: {
			newSlabs: slabs(t.newSlabs),
			oldSlabsBelow60: slabs(t.oldSlabsBelow60),
			oldSlabs60To79: slabs(t.oldSlabs60To79),
			oldSlabs80Plus: slabs(t.oldSlabs80Plus),
		},
		tiers: { newSurcharge: tiers(t.newSurcharge), oldSurcharge: tiers(t.oldSurcharge) },
		newStandard: inr(t.newStandardDeductionPaise),
		newRebateUpTo: inr(t.newRebateUpToPaise),
		oldStandard: inr(t.oldStandardDeductionPaise),
		oldRebateUpTo: inr(t.oldRebateUpToPaise),
		oldRebateMax: inr(t.oldRebateMaxPaise),
		cessPct: t.cessPct,
		limit80c: inr(t.limit80cPaise),
		limit80d: inr(t.limit80dPaise),
		limitHomeLoan: inr(t.limitHomeLoanPaise),
		proofFromMonth: t.proofFromMonth,
		seniorMedical: { self: h.selfSeniorMedical !== false, parents: h.parentsSeniorMedical !== false },
		health: {
			self: inr(h.selfPaise),
			selfSenior: inr(h.selfSeniorPaise),
			parents: inr(h.parentsPaise),
			parentsSenior: inr(h.parentsSeniorPaise),
			checkup: inr(h.checkupPaise),
		},
		rounding: t.rounding ?? 'ten',
		rentCities: [...(t.rentCities ?? RENT_CITIES_2026)],
	};
}

export function taxToWrite(f: IncomeTaxForm): IncomeTaxRules {
	const slabs = (list: IncomeTaxForm['slabs']['newSlabs']) =>
		list.map((x) => ({ upToPaise: x.upTo === null ? null : paise(x.upTo), ratePct: x.rate }));
	const tiers = (list: IncomeTaxForm['tiers']['newSurcharge']) =>
		list.map((x) => ({ overPaise: paise(x.over), ratePct: x.rate }));
	return {
		newSlabs: slabs(f.slabs.newSlabs),
		newStandardDeductionPaise: paise(f.newStandard),
		newRebateUpToPaise: paise(f.newRebateUpTo),
		newSurcharge: tiers(f.tiers.newSurcharge),
		oldSlabsBelow60: slabs(f.slabs.oldSlabsBelow60),
		oldSlabs60To79: slabs(f.slabs.oldSlabs60To79),
		oldSlabs80Plus: slabs(f.slabs.oldSlabs80Plus),
		oldStandardDeductionPaise: paise(f.oldStandard),
		oldRebateUpToPaise: paise(f.oldRebateUpTo),
		oldRebateMaxPaise: paise(f.oldRebateMax),
		oldSurcharge: tiers(f.tiers.oldSurcharge),
		cessPct: f.cessPct,
		limit80cPaise: paise(f.limit80c),
		// The single 80D limit of versions before section 126 stays in step with the family's limit.
		limit80dPaise: paise(f.health.self),
		limitHomeLoanPaise: paise(f.limitHomeLoan),
		proofFromMonth: f.proofFromMonth,
		health126: {
			selfPaise: paise(f.health.self),
			selfSeniorPaise: paise(f.health.selfSenior),
			parentsPaise: paise(f.health.parents),
			parentsSeniorPaise: paise(f.health.parentsSenior),
			checkupPaise: paise(f.health.checkup),
			selfSeniorMedical: f.seniorMedical.self,
			parentsSeniorMedical: f.seniorMedical.parents,
		},
		rounding: f.rounding,
		rentCities: f.rentCities.map((c) => c.trim()).filter((c) => c.length >= 2),
	};
}

/** The version form, money in rupees; slabs with an empty "up to" are the open top slab. */
export interface RulesForm {
	from: string;
	note: string;
	pfRatePct: number;
	pfWageCap: number;
	epsRatePct: number;
	epsCap: number;
	esiEmployeePct: number;
	esiEmployerPct: number;
	esiGrossLimit: number;
	ptSlabs: { upTo: number | null; tax: number }[];
	maxDeductionPct: number;
	pfAdminPct: number;
	pfAdminMin: number;
	edliPct: number;
	pfHeadcount: number;
	esiHeadcount: number;
	bonusHeadcount: number;
	bonusWarnAt: number;
	gratuityHeadcount: number;
	gratuityDaysPerYear: number;
	gratuityMonthDays: number;
	lwfEmployee: number;
	lwfEmployer: number;
	lwfMonths: string;
	pfDueDay: number;
	esiDueDay: number;
	ptDueDay: number;
	lwfDueDay: number;
	/** ST1: each State's professional tax and welfare fund. */
	states: StateForm[];
	/** TX2: income tax on salary (null only for a version the screens got without it). */
	incomeTax: IncomeTaxForm | null;
	/** BN1: the Bonus Act's figures, money in rupees; brief 26 BN2: the law, the wage basis, the qualifying days. */
	bonus: {
		ratePct: number;
		ceiling: number;
		eligibleUpTo: number;
		minimum: number;
		provision: BonusRules['provision'];
		law: NonNullable<BonusRules['law']>;
		wageBasis: NonNullable<BonusRules['wageBasis']>;
		minDays: number;
	} | null;
	/** Brief 26 BN-D3: the heads counted as wages for everyone, and PF on them once the CA confirms. */
	wageHeads: WageHead[];
	pfUsesCodeWages: boolean;
	/** Brief 26 AT1: each store's shift and weekly offs; a store without one works the default shift. */
	shifts: StoreShift[];
}

/** Two lists of heads holding the same heads, in any order. */
export function sameHeads(a: readonly WageHead[], b: readonly WageHead[]): boolean {
	return a.length === b.length && a.every((h) => b.includes(h));
}

/** BN-D3: the heads a structure holds, in the order the chips show them. */
export const WAGE_HEAD_CHOICES: readonly WageHead[] = ['basic', 'da', 'special', 'other', 'hra', 'conveyance'];

export function toForm(v: PayrollRulesVersion, from: string): RulesForm {
	return {
		from,
		note: '',
		pfRatePct: v.pfRatePct,
		pfWageCap: inr(v.pfWageCapPaise),
		epsRatePct: v.epsRatePct,
		epsCap: inr(v.epsCapPaise),
		esiEmployeePct: v.esiEmployeePct,
		esiEmployerPct: v.esiEmployerPct,
		esiGrossLimit: inr(v.esiGrossLimitPaise),
		ptSlabs: v.ptSlabs.map((s) => ({ upTo: s.upToPaise === null ? null : inr(s.upToPaise), tax: inr(s.taxPaise) })),
		maxDeductionPct: v.maxDeductionPct,
		pfAdminPct: v.pfAdminPct,
		pfAdminMin: inr(v.pfAdminMinPaise),
		edliPct: v.edliPct,
		pfHeadcount: v.pfHeadcount,
		esiHeadcount: v.esiHeadcount,
		bonusHeadcount: v.bonusHeadcount,
		bonusWarnAt: v.bonusWarnAt,
		gratuityHeadcount: v.gratuityHeadcount,
		gratuityDaysPerYear: v.gratuityDaysPerYear,
		gratuityMonthDays: v.gratuityMonthDays,
		lwfEmployee: inr(v.lwfEmployeePaise),
		lwfEmployer: inr(v.lwfEmployerPaise),
		lwfMonths: v.lwfMonths.join(', '),
		pfDueDay: v.pfDueDay,
		esiDueDay: v.esiDueDay,
		ptDueDay: v.ptDueDay,
		lwfDueDay: v.lwfDueDay,
		states: statesOf(v).map(stateToForm),
		incomeTax: v.incomeTax ? taxToForm(v.incomeTax) : null,
		bonus: v.bonus
			? {
					ratePct: v.bonus.ratePct,
					ceiling: inr(v.bonus.wageCeilingPaise),
					eligibleUpTo: inr(v.bonus.eligibleUpToPaise),
					minimum: inr(v.bonus.minimumPaise),
					provision: v.bonus.provision,
					// BN-D2: a version without its own law follows the new version's date.
					law: v.bonus.law ?? (from >= CODE_ON_WAGES_FROM ? 'code_on_wages' : 'bonus_act'),
					wageBasis: v.bonus.wageBasis ?? (from >= CODE_ON_WAGES_FROM ? 'code' : 'basic_da'),
					minDays: v.bonus.minDays ?? 30,
				}
			: null,
		wageHeads: [...(v.wageHeads ?? CODE_WAGE_HEADS)],
		pfUsesCodeWages: v.pfUsesCodeWages ?? false,
		shifts: (v.shifts ?? []).map((sh) => ({ ...sh, weeklyOff: [...sh.weeklyOff] })),
	};
}

export function toWrite(f: RulesForm): PayrollRulesWriteInput {
	return {
		from: f.from,
		note: f.note,
		pfRatePct: f.pfRatePct,
		pfWageCapPaise: paise(f.pfWageCap),
		epsRatePct: f.epsRatePct,
		epsCapPaise: paise(f.epsCap),
		esiEmployeePct: f.esiEmployeePct,
		esiEmployerPct: f.esiEmployerPct,
		esiGrossLimitPaise: paise(f.esiGrossLimit),
		ptSlabs: f.ptSlabs.map((s) => ({ upToPaise: s.upTo === null ? null : paise(s.upTo), taxPaise: paise(s.tax) })),
		maxDeductionPct: f.maxDeductionPct,
		pfAdminPct: f.pfAdminPct,
		pfAdminMinPaise: paise(f.pfAdminMin),
		edliPct: f.edliPct,
		pfHeadcount: f.pfHeadcount,
		esiHeadcount: f.esiHeadcount,
		bonusHeadcount: f.bonusHeadcount,
		bonusWarnAt: f.bonusWarnAt,
		gratuityHeadcount: f.gratuityHeadcount,
		gratuityDaysPerYear: f.gratuityDaysPerYear,
		gratuityMonthDays: f.gratuityMonthDays,
		lwfEmployeePaise: paise(f.lwfEmployee),
		lwfEmployerPaise: paise(f.lwfEmployer),
		lwfMonths: monthList(f.lwfMonths),
		pfDueDay: f.pfDueDay,
		esiDueDay: f.esiDueDay,
		ptDueDay: f.ptDueDay,
		lwfDueDay: f.lwfDueDay,
		states: f.states.map(stateToWrite),
		...(f.shifts.length ? { shifts: f.shifts } : {}),
		...(f.incomeTax ? { incomeTax: taxToWrite(f.incomeTax) } : {}),
		...(f.bonus
			? {
					bonus: {
						ratePct: f.bonus.ratePct,
						wageCeilingPaise: paise(f.bonus.ceiling),
						eligibleUpToPaise: paise(f.bonus.eligibleUpTo),
						minimumPaise: paise(f.bonus.minimum),
						provision: f.bonus.provision,
						law: f.bonus.law,
						wageBasis: f.bonus.wageBasis,
						minDays: f.bonus.minDays,
					},
				}
			: {}),
		// BN-D3: written only when they differ from the Codes' list (what an absent list means) or PF is switched on.
		...(sameHeads(f.wageHeads, CODE_WAGE_HEADS)
			? {}
			: { wageHeads: WAGE_HEAD_CHOICES.filter((h) => f.wageHeads.includes(h)) }),
		...(f.pfUsesCodeWages ? { pfUsesCodeWages: true } : {}),
	};
}

/** The version in force on a day: the last one starting on or before it. */
export function inForce(versions: readonly PayrollRulesVersion[], day: string): PayrollRulesVersion | null {
	return versions.filter((v) => v.from <= day).at(-1) ?? versions[0] ?? null;
}

/** S1's rows for a version: each rule's words and their figures. */
export function ruleRows(
	v: PayrollRulesVersion,
): { key: string; from: string | null; values: Record<string, string> }[] {
	// ST1: professional tax and the welfare fund, a row each per State.
	const stateRows = statesOf(v).flatMap((st) => {
		const taxes = st.ptSlabs.filter((s) => s.taxPaise > 0).map((s) => `₹${num(inr(s.taxPaise))}`);
		const freeUpTo = st.ptSlabs.find((s) => s.taxPaise === 0)?.upToPaise ?? 0;
		const state = stateName(st.stateCode);
		const ptKey = { monthly: 'pt', half_yearly: 'pt_period', yearly: 'pt_period', none: 'pt_none' }[st.ptFrequency];
		return [
			{
				key: ptKey,
				from: v.from,
				values: {
					state,
					taxes: taxes.join(' / '),
					over: num(inr(freeUpTo)),
					months: st.ptMonths.join(', '),
					day: num(st.ptDueDay),
				},
			},
			{
				key: 'lwf',
				from: v.from,
				values: {
					state,
					ee: num(inr(st.lwfEmployeePaise)),
					er: num(inr(st.lwfEmployerPaise)),
					months: st.lwfMonths.join(', '),
					day: num(st.lwfDueDay),
				},
			},
		];
	});
	return [
		{ key: 'wages', from: null, values: {} },
		{
			key: 'pf',
			from: v.from,
			values: {
				rate: num(v.pfRatePct),
				eps: num(v.epsRatePct),
				cap: num(inr(v.pfWageCapPaise)),
				admin: num(v.pfAdminPct),
				adminMin: num(inr(v.pfAdminMinPaise)),
				edli: num(v.edliPct),
				n: num(v.pfHeadcount),
				day: num(v.pfDueDay),
			},
		},
		{
			key: 'esi',
			from: v.from,
			values: {
				ee: num(v.esiEmployeePct),
				er: num(v.esiEmployerPct),
				limit: num(inr(v.esiGrossLimitPaise)),
				n: num(v.esiHeadcount),
				day: num(v.esiDueDay),
			},
		},
		...stateRows,
		{ key: 'deductions', from: v.from, values: { pct: num(v.maxDeductionPct) } },
		{
			key: 'bonus',
			from: null,
			values: {
				n: num(v.bonusHeadcount),
				warn: num(v.bonusWarnAt),
				rate: num(v.bonus?.ratePct ?? 8.33),
				ceiling: num(inr(v.bonus?.wageCeilingPaise ?? 7_000_00)),
				limit: num(inr(v.bonus?.eligibleUpToPaise ?? 21_000_00)),
			},
		},
		{
			key: 'gratuity',
			from: null,
			values: {
				days: num(v.gratuityDaysPerYear),
				monthDays: num(v.gratuityMonthDays),
				n: num(v.gratuityHeadcount),
			},
		},
		v.incomeTax
			? {
					key: 'tds',
					from: v.from,
					values: {
						std: num(inr(v.incomeTax.newStandardDeductionPaise)),
						rebate: num(inr(v.incomeTax.newRebateUpToPaise)),
						oldStd: num(inr(v.incomeTax.oldStandardDeductionPaise)),
						cess: num(v.incomeTax.cessPct),
					},
				}
			: { key: 'tds', from: null, values: {} },
		{ key: 'min_wages', from: null, values: {} },
	];
}

const istToday = (): string => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/**
 * Settings › Payroll rules (accounts brief S1): each rule as a dated version, the one in force today shown in words; a
 * law change is added as a new version from the day it applies, and earlier months keep the old one.
 */
@Component({
	selector: 'app-payroll-rules-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, HasPermissionDirective],
	templateUrl: './payroll-rules-page.html',
})
export class PayrollRulesPage {
	private readonly gateway = inject(PayrollGateway);
	private readonly modals = inject(NgbModal);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);
	private readonly queries = inject(QueryClient);

	private readonly locationsGateway = inject(LocationsGateway);
	readonly locations = injectQuery(() => ({
		queryKey: LOCATION_KEYS.list,
		queryFn: () => firstValueFrom(this.locationsGateway.list()),
	}));
	/** Today in India, the date a new holiday starts on. */
	readonly today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
	readonly versions = injectQuery(() => ({
		queryKey: PAYROLL_KEYS.rules,
		queryFn: () => firstValueFrom(this.gateway.rules()),
	}));
	readonly current = computed(() => inForce(this.versions.data() ?? [], istToday()));
	readonly rows = computed(() => {
		const v = this.current();
		return v ? ruleRows(v) : [];
	});
	readonly form = signal<RulesForm | null>(null);
	readonly busy = signal(false);
	private modal: NgbModalRef | null = null;

	day(date: string | null): string {
		return shortDate(date);
	}

	open(template: TemplateRef<unknown>): void {
		const v = this.current();
		if (!v) return;
		this.form.set(toForm(v, istToday()));
		this.stateAt.set(0);
		this.modal = this.modals.open(template, { centered: true, size: 'xl', scrollable: true });
	}

	patch(fields: Partial<RulesForm>): void {
		this.form.update((f) => (f ? { ...f, ...fields } : f));
	}

	/** ST1: the State shown in the form, by its place in the list, and the State picked to add. */
	readonly stateAt = signal(0);
	readonly stateToAdd = signal('');
	readonly stateName = stateName;
	readonly stateChoices = GST_STATES.filter((s) => !s.retired);
	readonly picked = computed(() => this.form()?.states[this.stateAt()] ?? null);
	readonly frequencies: PtFrequency[] = ['monthly', 'half_yearly', 'yearly', 'none'];
	/** PT2: the actual-pay basis first, as the law reads (PT-D3). */
	readonly bases: PtBasis[] = ['actual', 'projected'];
	readonly roundings = ROUNDINGS;
	readonly healthKeys = ['self', 'selfSenior', 'parents', 'parentsSenior', 'checkup'] as const;
	readonly monthNumbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
	/** PT1: the slab lists a State shows: everyone's, and the women's when it keeps them. */
	listsOf(st: StateForm): SlabList[] {
		return st.ptWomen ? ['ptSlabs', 'ptWomenSlabs'] : ['ptSlabs'];
	}

	/** A slab list of the picked State, for the template (PT1). */
	slabsOf(st: StateForm, list: SlabList): SlabForm[] {
		return st[list];
	}
	/** PT4: the sets the State being added can start from, and the one picked ('' for blank). */
	readonly startingSets = computed<PtStartingSet[]>(() => ptStartingSetsFor(this.stateToAdd()));
	readonly startFrom = signal('');
	/** PT1: the most one person can pay in a year under the State as typed, and whether it passes ₹2,500. */
	readonly yearMost = computed(() => {
		const st = this.picked();
		return st ? yearMostOf(st) : 0;
	});
	readonly overYearCap = computed(() => this.yearMost() > PT_YEAR_CAP_PAISE);
	readonly yearMostText = computed(() => num(inr(this.yearMost())));

	/** TX2: the income-tax slab tables and surcharge tiers in the form. */
	readonly slabGroups = SLAB_GROUPS;
	readonly tierGroups = TIER_GROUPS;

	private patchTaxForm(change: (t: IncomeTaxForm) => IncomeTaxForm): void {
		this.form.update((f) => (f?.incomeTax ? { ...f, incomeTax: change(f.incomeTax) } : f));
	}

	readonly wageHeadChoices = WAGE_HEAD_CHOICES;

	/* ------------------------------------------------------------------ brief 26 LV1, LV2: leave per State */

	/** LV1: which part of the State's set is shown: professional tax and the welfare fund, or leave. */
	readonly stateSection = signal<'pt' | 'leave' | 'holidays' | 'wages'>('pt');
	readonly skillLevels = SKILL_LEVELS;

	/** SR4: a new set of minimum wages, from today until its notification's date is typed. */
	addWageSet(): void {
		const st = this.picked();
		const levels = Object.fromEntries(SKILL_LEVELS.map((l) => [l, null])) as WageSetForm['levels'];
		if (st) this.patchState({ minimumWages: [...st.minimumWages, { from: this.today, levels }] });
	}

	setWageSet(index: number, from: string | null, level: SkillLevel | null, value: unknown): void {
		const st = this.picked();
		if (!st) return;
		this.patchState({
			minimumWages: st.minimumWages.map((w, i) =>
				i !== index
					? w
					: {
							from: from || w.from,
							levels: level
								? {
										...w.levels,
										[level]:
											value === '' || value === null ? null : Math.max(0, Number(value) || 0),
									}
								: w.levels,
						},
			),
		});
	}

	removeWageSet(index: number): void {
		const st = this.picked();
		if (st) this.patchState({ minimumWages: st.minimumWages.filter((_, i) => i !== index) });
	}
	/** LV2: the leave type whose rules are open, by key ('' for none), and its rule shown. */
	readonly leaveOpen = signal('');
	readonly leaveRuleAt = signal(0);
	/** LV2's Try it: a joining date and the days worked so far. */
	readonly tryJoined = signal('2026-08-12');
	readonly tryWorked = signal(96);

	private patchLeaveTypes(change: (types: StateForm['leaveTypes']) => StateForm['leaveTypes']): void {
		const st = this.picked();
		if (st) this.patchState({ leaveTypes: change(st.leaveTypes) });
	}

	/** LV-D2: the State's starting set (West Bengal's for now), for the CA to review; other States start empty. */
	hasLeaveStart(st: StateForm): boolean {
		return st.stateCode === '19' && !st.leaveTypes.length;
	}

	startLeave(): void {
		this.patchLeaveTypes(
			() => WEST_BENGAL_LEAVE.map((t) => structuredClone(t)) as unknown as StateForm['leaveTypes'],
		);
	}

	/** LV1: a new type starts on the company's April-March year, credited nothing until its rules are set. */
	addLeaveType(): void {
		const base = structuredClone((WEST_BENGAL_LEAVE.at(-1) as (typeof WEST_BENGAL_LEAVE)[number]).rules[0]);
		this.patchLeaveTypes((types) => {
			let n = types.length + 1;
			while (types.some((t) => t.key === `T${n}`)) n++;
			const key = `T${n}`;
			this.leaveOpen.set(key);
			this.leaveRuleAt.set(0);
			return [
				...types,
				{ key, name: '', paid: 'full', active: true, rules: [base] } as StateForm['leaveTypes'][number],
			];
		});
	}

	/** A type's code is unique in its State: a code another type already has is refused, not applied. */
	setLeaveType(key: string, fields: Partial<StateForm['leaveTypes'][number]>): void {
		if (
			fields.key !== undefined &&
			fields.key !== key &&
			this.picked()?.leaveTypes.some((t) => t.key === fields.key)
		) {
			this.notifier.showError(this.transloco.translate('payroll_leave_key_taken'));
			return;
		}
		this.patchLeaveTypes((types) => types.map((t) => (t.key === key ? { ...t, ...fields } : t)));
		if (fields.key && fields.key !== key && this.leaveOpen() === key) this.leaveOpen.set(fields.key);
	}

	/** A type never used yet can be taken out; one used is switched off instead (its history stays). */
	removeLeaveType(key: string): void {
		this.patchLeaveTypes((types) => types.filter((t) => t.key !== key));
		if (this.leaveOpen() === key) this.leaveOpen.set('');
	}

	/** LV1, AT2: a holiday of the State, today's date and every store until changed. */
	addHoliday(): void {
		const st = this.picked();
		if (st) this.patchState({ holidays: [...st.holidays, { day: this.today, name: '', locationId: null }] });
	}

	setHoliday(index: number, fields: Partial<Holiday>): void {
		const st = this.picked();
		if (st) this.patchState({ holidays: st.holidays.map((h, i) => (i === index ? { ...h, ...fields } : h)) });
	}

	removeHoliday(index: number): void {
		const st = this.picked();
		if (st) this.patchState({ holidays: st.holidays.filter((_, i) => i !== index) });
	}

	/** The stores of a State, for a holiday kept to one of them. */
	storesOf(stateCode: string): { id: string; name: string }[] {
		return (this.locations.data() ?? []).filter((l) => l.stateCode === stateCode);
	}

	/** AT1: a store's shift, starting from the default (10:00-19:00, 8 hours, Sundays off). */
	addShift(): void {
		const f = this.form();
		const taken = new Set(f?.shifts.map((sh) => sh.locationId));
		const store = (this.locations.data() ?? []).find((l) => !taken.has(l.id));
		if (!f || !store) return;
		this.form.set({
			...f,
			shifts: [
				...f.shifts,
				{
					locationId: store.id,
					start: '10:00',
					end: '19:00',
					fullDayHours: 8,
					graceMinutes: 0,
					weeklyOff: [0],
				},
			],
		});
	}

	setShift(index: number, fields: Partial<StoreShift>): void {
		this.form.update((f) =>
			f ? { ...f, shifts: f.shifts.map((sh, i) => (i === index ? { ...sh, ...fields } : sh)) } : f,
		);
	}

	removeShift(index: number): void {
		this.form.update((f) => (f ? { ...f, shifts: f.shifts.filter((_, i) => i !== index) } : f));
	}

	/** The stores a shift may be for: its own, and those without a shift yet (one shift per store). */
	shiftStores(index: number): { id: string; name: string }[] {
		const taken = new Set((this.form()?.shifts ?? []).filter((_, i) => i !== index).map((sh) => sh.locationId));
		return (this.locations.data() ?? []).filter((l) => !taken.has(l.id));
	}

	/** A holiday without a name can't be saved: Save waits until each has one. */
	readonly unnamedHoliday = computed(() =>
		(this.form()?.states ?? []).some((st) => st.holidays.some((h) => !h.name.trim())),
	);

	/** A day of the week on or off for a store's shift. */
	toggleOff(index: number, weekday: number): void {
		const sh = this.form()?.shifts[index];
		if (!sh) return;
		const off = sh.weeklyOff.includes(weekday)
			? sh.weeklyOff.filter((d) => d !== weekday)
			: [...sh.weeklyOff, weekday].sort((a, b) => a - b);
		this.setShift(index, { weeklyOff: off });
	}

	readonly weekdays = [0, 1, 2, 3, 4, 5, 6] as const;

	openLeave(key: string): void {
		this.leaveOpen.set(this.leaveOpen() === key ? '' : key);
		this.leaveRuleAt.set(0);
	}

	/** LV2: the open type and its rule shown. */
	readonly openType = computed(() => this.picked()?.leaveTypes.find((t) => t.key === this.leaveOpen()) ?? null);
	readonly openRule = computed(
		() => (this.openType()?.rules[this.leaveRuleAt()] as unknown as CoreLeaveRule) ?? null,
	);

	/** LV2: change the rule shown, field by field (nested parts replaced whole). */
	setRule(fields: Partial<CoreLeaveRule>): void {
		const type = this.openType();
		if (!type) return;
		const at = this.leaveRuleAt();
		const rules = type.rules.map((r, i) =>
			i === at ? { ...r, ...fields } : r,
		) as StateForm['leaveTypes'][number]['rules'];
		this.setLeaveType(type.key, { rules });
	}

	/** LV2: a condition (a designation or department) gets its own rule, placed before the one for everyone. */
	addRuleCondition(): void {
		const type = this.openType();
		const rule = this.openRule();
		if (!type || !rule) return;
		const copy = { ...structuredClone(rule), when: { designation: '', department: '' } };
		const rules = [copy, ...type.rules] as unknown as StateForm['leaveTypes'][number]['rules'];
		this.setLeaveType(type.key, { rules });
		this.leaveRuleAt.set(0);
	}

	removeRule(index: number): void {
		const type = this.openType();
		if (!type || type.rules.length < 2) return;
		this.setLeaveType(type.key, { rules: type.rules.filter((_, i) => i !== index) });
		this.leaveRuleAt.set(0);
	}

	readonly leavePaid = ['full', 'half', 'unpaid'] as const;
	readonly validityKinds = ['year_end', 'days', 'months', 'never'] as const;
	readonly creditKinds = ['year_start', 'monthly', 'per_days_worked', 'on_request', 'none'] as const;
	readonly joinerKinds = ['months_left', 'days_left', 'none'] as const;
	readonly roundingKinds = ['half', 'whole', 'none'] as const;
	readonly dayPayKinds = ['month_days', '26', '30'] as const;
	/** LV2's ticks: how the leave is taken, and encashment on leaving. */
	readonly takingFlags = [
		{ key: 'halfDays' },
		{ key: 'countOffsBetween' },
		{ key: 'canGoNegative' },
		{ key: 'onLeaving' },
	] as const;

	/** LV-D1: the month a type's year starts (0 for "from each person's joining day"), and its length. */
	yearStartOf(r: CoreLeaveRule): number {
		return 'fromJoining' in r.year ? 0 : r.year.startMonth;
	}

	yearMonthsOf(r: CoreLeaveRule): number {
		return 'fromJoining' in r.year ? 12 : r.year.months;
	}

	setYearStart(r: CoreLeaveRule, month: number): void {
		this.setRule({ year: month ? { startMonth: month, months: this.yearMonthsOf(r) } : { fromJoining: true } });
	}

	setYearMonths(r: CoreLeaveRule, months: number): void {
		this.setRule({
			year: { startMonth: this.yearStartOf(r) || 4, months: Math.min(12, Math.max(1, months || 12)) },
		});
	}

	/** Each credit's validity; days and months start at 90 and 12 (a count is kept only while its unit stays). */
	setValidity(kind: CoreLeaveRule['validity']['kind'], r: CoreLeaveRule): void {
		const v = r.validity;
		const n = (v.kind === 'days' || v.kind === 'months') && v.kind === kind ? v.n : kind === 'days' ? 90 : 12;
		this.setRule({ validity: kind === 'days' || kind === 'months' ? { kind, n } : { kind } });
	}

	setCreditKind(kind: CoreLeaveRule['credit']['kind']): void {
		const credit: CoreLeaveRule['credit'] =
			kind === 'per_days_worked' ? { kind, every: 20, give: 1 } : kind === 'none' ? { kind } : { kind, days: 0 };
		this.setRule({ credit });
	}

	flagOn(r: CoreLeaveRule, key: (typeof this.takingFlags)[number]['key']): boolean {
		return key === 'onLeaving' ? r.encash.onLeaving : r.taking[key];
	}

	toggleFlag(r: CoreLeaveRule, key: (typeof this.takingFlags)[number]['key']): void {
		if (key === 'onLeaving') this.setRule({ encash: { ...r.encash, onLeaving: !r.encash.onLeaving } });
		else this.setRule({ taking: { ...r.taking, [key]: !r.taking[key] } });
	}

	/** LV2's Try it: what the rule shown credits a joiner so far. */
	readonly tryCredit = computed(() => {
		const rule = this.openRule();
		if (!rule || !this.tryJoined()) return 0;
		return creditSoFar(rule, { joinedOn: this.tryJoined(), asOf: istToday(), daysWorked: this.tryWorked() });
	});

	/** BN-D3: a head in or out of the wages. */
	toggleWageHead(head: WageHead): void {
		this.form.update((f) =>
			f
				? {
						...f,
						wageHeads: f.wageHeads.includes(head)
							? f.wageHeads.filter((h) => h !== head)
							: [...f.wageHeads, head],
					}
				: f,
		);
	}

	setPfUsesCodeWages(on: boolean): void {
		this.form.update((f) => (f ? { ...f, pfUsesCodeWages: on } : f));
	}

	patchBonus(fields: Partial<NonNullable<RulesForm['bonus']>>): void {
		this.form.update((f) => (f?.bonus ? { ...f, bonus: { ...f.bonus, ...fields } } : f));
	}

	patchTax(fields: Partial<Omit<IncomeTaxForm, 'slabs' | 'tiers'>>): void {
		this.patchTaxForm((t) => ({ ...t, ...fields }));
	}

	/** TX4: one of section 126's limits. */
	/** TX3: an uninsured senior's medical bills counted in a group, or not. */
	toggleSeniorMedical(group: 'self' | 'parents'): void {
		this.patchTaxForm((t) => ({ ...t, seniorMedical: { ...t.seniorMedical, [group]: !t.seniorMedical[group] } }));
	}

	setHealth(key: keyof IncomeTaxForm['health'], value: number): void {
		this.patchTaxForm((t) => ({ ...t, health: { ...t.health, [key]: value } }));
	}

	/** TX4: the city typed in "Add a city" joins the list once (any case), and the box empties. */
	readonly cityToAdd = signal('');
	addCity(): void {
		const city = this.cityToAdd().trim();
		if (city.length < 2) return;
		this.patchTaxForm((t) =>
			t.rentCities.some((c) => c.toLowerCase() === city.toLowerCase())
				? t
				: { ...t, rentCities: [...t.rentCities, city] },
		);
		this.cityToAdd.set('');
	}

	removeCity(index: number): void {
		this.patchTaxForm((t) => ({ ...t, rentCities: t.rentCities.filter((_, i) => i !== index) }));
	}

	setTaxSlab(group: SlabGroup, index: number, patch: Partial<IncomeTaxForm['slabs'][SlabGroup][number]>): void {
		this.patchTaxForm((t) => ({
			...t,
			slabs: { ...t.slabs, [group]: t.slabs[group].map((x, i) => (i === index ? { ...x, ...patch } : x)) },
		}));
	}

	addTaxSlab(group: SlabGroup): void {
		this.patchTaxForm((t) => ({
			...t,
			slabs: {
				...t.slabs,
				[group]: [...t.slabs[group].slice(0, -1), { upTo: 0, rate: 0 }, ...t.slabs[group].slice(-1)],
			},
		}));
	}

	removeTaxSlab(group: SlabGroup, index: number): void {
		this.patchTaxForm((t) => ({
			...t,
			slabs: { ...t.slabs, [group]: t.slabs[group].filter((_, i) => i !== index) },
		}));
	}

	setTier(group: TierGroup, index: number, patch: Partial<IncomeTaxForm['tiers'][TierGroup][number]>): void {
		this.patchTaxForm((t) => ({
			...t,
			tiers: { ...t.tiers, [group]: t.tiers[group].map((x, i) => (i === index ? { ...x, ...patch } : x)) },
		}));
	}

	addTier(group: TierGroup): void {
		this.patchTaxForm((t) => ({ ...t, tiers: { ...t.tiers, [group]: [...t.tiers[group], { over: 0, rate: 0 }] } }));
	}

	removeTier(group: TierGroup, index: number): void {
		this.patchTaxForm((t) => ({
			...t,
			tiers: { ...t.tiers, [group]: t.tiers[group].filter((_, i) => i !== index) },
		}));
	}

	hasState(code: string): boolean {
		return !!this.form()?.states.some((s) => s.stateCode === code);
	}

	patchState(fields: Partial<StateForm>): void {
		const at = this.stateAt();
		this.form.update((f) =>
			f ? { ...f, states: f.states.map((s, i) => (i === at ? { ...s, ...fields } : s)) } : f,
		);
	}

	setSlab(index: number, patch: Partial<SlabForm>, list: SlabList = 'ptSlabs'): void {
		const st = this.picked();
		if (st) this.patchState({ [list]: st[list].map((s, i) => (i === index ? { ...s, ...patch } : s)) });
	}

	/** PT1: separate slabs for women start as a copy of everyone's, so only the differences need typing. */
	setWomen(on: boolean): void {
		const st = this.picked();
		if (!st) return;
		const copy = on && !st.ptWomenSlabs.length ? st.ptSlabs.map((x) => ({ ...x })) : st.ptWomenSlabs;
		this.patchState({ ptWomen: on, ptWomenSlabs: copy });
	}

	/** PT4: picking the State to add picks its first starting set, if it has one. */
	pickStateToAdd(code: string): void {
		this.stateToAdd.set(code);
		this.startFrom.set(ptStartingSetsFor(code)[0]?.label ?? '');
	}

	/** A slab added below the open top slab. */
	/**
	 * A slab is added below the open top slab; a list without one (a State saved as "none", or an older version with no
	 * slabs) gets the open top slab first, so it can always be saved.
	 */
	addSlab(list: SlabList = 'ptSlabs'): void {
		const st = this.picked();
		if (!st) return;
		const slabs = st[list];
		const blank: SlabForm = { upTo: 0, tax: 0, otherMonth: null, otherTax: 0 };
		const open = slabs.at(-1)?.upTo === null;
		this.patchState({
			[list]: open ? [...slabs.slice(0, -1), blank, ...slabs.slice(-1)] : [...slabs, { ...blank, upTo: null }],
		});
	}

	removeSlab(index: number, list: SlabList = 'ptSlabs'): void {
		const st = this.picked();
		if (st) this.patchState({ [list]: st[list].filter((_, i) => i !== index) });
	}

	/**
	 * "Add a State": its set starts from the starting set picked (PT4), or empty (no tax until its slabs are entered),
	 * and is shown at once.
	 */
	addState(): void {
		const code = this.stateToAdd();
		const f = this.form();
		if (!f || !code || f.states.some((s) => s.stateCode === code)) return;
		const start = this.startingSets().find((x) => x.label === this.startFrom());
		this.form.set({ ...f, states: [...f.states, startingForm(code, start)] });
		this.stateAt.set(f.states.length);
		this.stateToAdd.set('');
		this.startFrom.set('');
	}

	removeState(index: number): void {
		this.form.update((f) => (f ? { ...f, states: f.states.filter((_, i) => i !== index) } : f));
		this.stateAt.set(0);
	}

	async save(): Promise<void> {
		const f = this.form();
		if (!f) return;
		this.busy.set(true);
		try {
			await firstValueFrom(this.gateway.addRules(toWrite(f)));
			this.notifier.showSuccess(this.transloco.translate('payroll_rules_added'));
			await this.queries.invalidateQueries({ queryKey: PAYROLL_KEYS.rules });
			this.modal?.close();
		} catch (error) {
			this.notifier.showError(this.transloco.translate(`payroll_problem_${apiProblem(error, 'failed')}`));
		} finally {
			this.busy.set(false);
		}
	}
}
